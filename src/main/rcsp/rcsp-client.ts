import type { H3Command } from '../h3/h3-commands'
import type { ConnectedLink } from '../transport/headset-transport'
import { encodeCommandFrame, type RcspCommandFrame, type RcspResponseFrame } from './frame'
import { createFrameParser } from './frame-parser'

export class RcspTimeoutError extends Error {
  constructor(message: string = 'RCSP request timed out') {
    super(message)
    this.name = 'RcspTimeoutError'
  }
}

export class RcspStatusError extends Error {
  readonly status: number

  constructor(status: number) {
    super(`Headset answered with status ${status}`)
    this.name = 'RcspStatusError'
    this.status = status
  }
}

export class RcspClosedError extends Error {
  constructor(message: string = 'RCSP client closed') {
    super(message)
    this.name = 'RcspClosedError'
  }
}

export interface RcspClient {
  request(command: H3Command): Promise<RcspResponseFrame>
  onPush(listener: (frame: RcspCommandFrame) => void): () => void
  close(): void
}

export type RcspClientOptions = { timeoutMs?: number; maxResends?: number }

const DEFAULT_TIMEOUT_MS = 2000
const DEFAULT_MAX_RESENDS = 3
const SN_MODULUS = 256
const WRITE_DONE = 'written' as const
const WRITE_TIMED_OUT = 'timed-out' as const

type PendingRequest = {
  frame: Uint8Array
  resendsLeft: number
  timer: ReturnType<typeof setTimeout> | undefined
  resolve: (frame: RcspResponseFrame) => void
  reject: (error: Error) => void
}

const pendingKey = (opcode: number, sn: number): string => `${opcode}:${sn}`

export const createRcspClient = (link: ConnectedLink, options: RcspClientOptions = {}): RcspClient => {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const maxResends = options.maxResends ?? DEFAULT_MAX_RESENDS
  const parser = createFrameParser()
  const pending = new Map<string, PendingRequest>()
  const pushListeners = new Set<(frame: RcspCommandFrame) => void>()
  let nextSn = 0
  let closed = false
  let writeQueue: Promise<void> = Promise.resolve()

  const settle = (key: string): PendingRequest | undefined => {
    const request = pending.get(key)
    if (request === undefined) return undefined
    clearTimeout(request.timer)
    pending.delete(key)
    return request
  }

  const onTimeout = (key: string): void => {
    const request = pending.get(key)
    if (request === undefined) return
    if (request.resendsLeft === 0) {
      settle(key)?.reject(new RcspTimeoutError())
      return
    }
    request.resendsLeft -= 1
    enqueueWrite(key)
  }

  const writeWithinTimeout = async (frame: Uint8Array): Promise<typeof WRITE_DONE | typeof WRITE_TIMED_OUT> => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const expiry = new Promise<typeof WRITE_TIMED_OUT>((resolve) => {
      timer = setTimeout(() => resolve(WRITE_TIMED_OUT), timeoutMs)
    })
    const written = link.write(frame).then(() => WRITE_DONE)
    try {
      return await Promise.race([written, expiry])
    } finally {
      clearTimeout(timer)
    }
  }

  const notifyPushListeners = (frame: RcspCommandFrame): void => {
    for (const listener of pushListeners) {
      try {
        listener(frame)
      } catch {
        // A faulty listener must not drop the frames that follow in the same chunk.
      }
    }
  }

  const enqueueWrite = (key: string): void => {
    writeQueue = writeQueue.then(async () => {
      const request = pending.get(key)
      if (request === undefined) return
      try {
        const outcome = await writeWithinTimeout(request.frame)
        if (outcome === WRITE_TIMED_OUT) {
          onTimeout(key)
          return
        }
      } catch (error) {
        settle(key)?.reject(error instanceof Error ? error : new Error(String(error)))
        return
      }
      if (pending.get(key) !== request) return
      request.timer = setTimeout(() => onTimeout(key), timeoutMs)
    })
  }

  const handleFrame = (frame: ReturnType<typeof parser.push>[number]): void => {
    if (frame.kind === 'command') {
      notifyPushListeners(frame)
      return
    }
    const key = pendingKey(frame.opcode, frame.sn)
    if (!pending.has(key)) return
    const request = settle(key)
    if (frame.status !== 0) {
      request?.reject(new RcspStatusError(frame.status))
      return
    }
    request?.resolve(frame)
  }

  const closeAll = (): void => {
    if (closed) return
    closed = true
    unsubscribeNotification()
    unsubscribeDisconnect()
    for (const key of [...pending.keys()]) settle(key)?.reject(new RcspClosedError())
  }

  const unsubscribeNotification = link.onNotification((chunk) => {
    parser.push(chunk).forEach(handleFrame)
  })
  const unsubscribeDisconnect = link.onDisconnect(closeAll)

  const request = (command: H3Command): Promise<RcspResponseFrame> => {
    if (closed) return Promise.reject(new RcspClosedError())
    const sn = nextSn
    nextSn = (nextSn + 1) % SN_MODULUS
    const frame = encodeCommandFrame({ opcode: command.opcode, sn, payload: command.payload })
    const key = pendingKey(command.opcode, sn)
    return new Promise<RcspResponseFrame>((resolve, reject) => {
      pending.set(key, { frame, resendsLeft: maxResends, timer: undefined, resolve, reject })
      enqueueWrite(key)
    })
  }

  const onPush = (listener: (frame: RcspCommandFrame) => void): (() => void) => {
    pushListeners.add(listener)
    return () => {
      pushListeners.delete(listener)
    }
  }

  return { request, onPush, close: closeAll }
}
