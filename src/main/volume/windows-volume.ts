import { spawn } from 'node:child_process'
import type { Readable, Writable } from 'node:stream'
import { z } from 'zod'
import {
  MAX_VOLUME_PERCENT,
  MIN_VOLUME_PERCENT,
  type VolumeReading,
  VolumeReadingSchema,
} from '../../shared/volume-types'

export type VolumeHostProcess = {
  stdin: Writable
  stdout: Readable
  kill(): void
  onExit(listener: () => void): void
}

export interface VolumeControl {
  get(): Promise<VolumeReading | null>
  set(percent: number): Promise<void>
  dispose(): void
}

const REQUEST_TIMEOUT_MS = 3000
const VOLUME_HOST_STARTUP_TIMEOUT_MS = 10_000
const LINE_BREAK = '\n'
const POWERSHELL_ARGS = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File']

const HostResponseSchema = z.union([
  z.object({ id: z.number(), ok: z.literal(false), error: z.string() }),
  z.object({ id: z.number(), ok: z.literal(true), endpoint: z.null() }),
  VolumeReadingSchema.extend({ id: z.number(), ok: z.literal(true) }),
  z.object({ id: z.number(), ok: z.literal(true) }),
])
const ReadyLineSchema = z.object({ ready: z.literal(true) })
type HostResponse = z.infer<typeof HostResponseSchema>

type PendingRequest = {
  resolve(response: HostResponse): void
  reject(error: Error): void
  timer: ReturnType<typeof setTimeout> | undefined
}

export function spawnPowerShellVolumeHost(scriptPath: string): VolumeHostProcess {
  const child = spawn('powershell.exe', [...POWERSHELL_ARGS, scriptPath], {
    stdio: ['pipe', 'pipe', 'ignore'],
    windowsHide: true,
  })
  return {
    stdin: child.stdin,
    stdout: child.stdout,
    kill: () => {
      child.kill()
    },
    onExit: (listener) => {
      child.once('exit', listener)
      child.once('error', listener)
    },
  }
}

function clampPercent(percent: number): number {
  return Math.min(MAX_VOLUME_PERCENT, Math.max(MIN_VOLUME_PERCENT, Math.round(percent)))
}

function extractId(line: string): number | null {
  try {
    const parsed: unknown = JSON.parse(line)
    const result = z.object({ id: z.number() }).safeParse(parsed)
    return result.success ? result.data.id : null
  } catch {
    return null
  }
}

export class VolumeEndpointUnavailableError extends Error {
  constructor() {
    super('No active QCY H3 playback endpoint')
    this.name = 'VolumeEndpointUnavailableError'
  }
}

export function createWindowsVolumeControl(spawnHost: () => VolumeHostProcess): VolumeControl {
  const pending = new Map<number, PendingRequest>()
  let waitingForReady: Array<{ id: number; line: string }> = []
  let host: VolumeHostProcess | null = null
  let hostReady = false
  let startupTimer: ReturnType<typeof setTimeout> | undefined
  let nextId = 1
  let disposed = false

  function settle(id: number, action: (request: PendingRequest) => void) {
    const request = pending.get(id)
    if (!request) return
    pending.delete(id)
    clearTimeout(request.timer)
    action(request)
  }

  function rejectAll(error: Error) {
    for (const id of [...pending.keys()]) settle(id, (request) => request.reject(error))
  }

  function resetHost(error: Error) {
    const stopped = host
    host = null
    hostReady = false
    clearTimeout(startupTimer)
    waitingForReady = []
    rejectAll(error)
    stopped?.kill()
  }

  function transmit(target: VolumeHostProcess, id: number, line: string) {
    const request = pending.get(id)
    if (!request) return
    request.timer = setTimeout(() => {
      resetHost(new Error('Volume host request timed out'))
    }, REQUEST_TIMEOUT_MS)
    try {
      target.stdin.write(line)
    } catch (error) {
      resetHost(error instanceof Error ? error : new Error('Volume host unavailable'))
    }
  }

  function handleReady(target: VolumeHostProcess) {
    hostReady = true
    clearTimeout(startupTimer)
    const queued = waitingForReady
    waitingForReady = []
    for (const { id, line } of queued) transmit(target, id, line)
  }

  function handleLine(line: string, target: VolumeHostProcess) {
    const json = safeJson(line)
    if (ReadyLineSchema.safeParse(json).success) {
      handleReady(target)
      return
    }
    const parsed = HostResponseSchema.safeParse(json)
    if (parsed.success) {
      settle(parsed.data.id, (request) => request.resolve(parsed.data))
      return
    }
    const malformed = new Error(`Malformed volume host response: ${line}`)
    const id = extractId(line)
    if (id === null) {
      rejectAll(malformed)
      return
    }
    settle(id, (request) => request.reject(malformed))
  }

  function startHost(): VolumeHostProcess {
    const started = spawnHost()
    let buffered = ''
    started.stdout.setEncoding('utf8')
    started.stdout.on('data', (chunk: string) => {
      if (host !== started) return
      buffered += chunk
      const lines = buffered.split(LINE_BREAK)
      buffered = lines.pop() ?? ''
      for (const line of lines) {
        const trimmed = line.trim()
        if (trimmed) handleLine(trimmed, started)
      }
    })
    started.stdin.on('error', () => {})
    started.onExit(() => {
      if (host !== started) return
      host = null
      hostReady = false
      clearTimeout(startupTimer)
      waitingForReady = []
      rejectAll(new Error('Volume host exited'))
    })
    host = started
    hostReady = false
    startupTimer = setTimeout(() => {
      resetHost(new Error('Volume host not ready in time'))
    }, VOLUME_HOST_STARTUP_TIMEOUT_MS)
    return started
  }

  function send(command: Record<string, unknown>): Promise<HostResponse> {
    if (disposed) return Promise.reject(new Error('Volume control disposed'))
    const id = nextId++
    return new Promise<HostResponse>((resolve, reject) => {
      pending.set(id, { resolve, reject, timer: undefined })
      const line = `${JSON.stringify({ id, ...command })}${LINE_BREAK}`
      try {
        const target = host ?? startHost()
        if (hostReady) transmit(target, id, line)
        else waitingForReady.push({ id, line })
      } catch (error) {
        settle(id, (request) =>
          request.reject(error instanceof Error ? error : new Error('Volume host unavailable')),
        )
      }
    })
  }

  return {
    async get() {
      const response = await send({ op: 'get' })
      if (!response.ok) throw new Error(response.error)
      if ('endpoint' in response) return null
      if (!('percent' in response)) throw new Error('Malformed volume host response: no reading')
      return {
        percent: response.percent,
        muted: response.muted,
        endpointName: response.endpointName,
      }
    },
    async set(percent) {
      if (!Number.isFinite(percent)) throw new Error('Invalid percent')
      const response = await send({ op: 'set', percent: clampPercent(percent) })
      if (!response.ok) throw new Error(response.error)
      if ('endpoint' in response) throw new VolumeEndpointUnavailableError()
    },
    dispose() {
      disposed = true
      resetHost(new Error('Volume control disposed'))
    },
  }
}

function safeJson(line: string): unknown {
  try {
    return JSON.parse(line)
  } catch {
    return undefined
  }
}
