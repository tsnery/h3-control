import { PassThrough } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  type VolumeHostProcess,
  VolumeEndpointUnavailableError,
  createWindowsVolumeControl,
} from './windows-volume'

type FakeHost = VolumeHostProcess & {
  commands: Array<Record<string, unknown>>
  reply(line: string): void
  write(raw: string): void
  exit(): void
  killed: boolean
}

const READY_LINE = JSON.stringify({ ready: true })

function createFakeHost(
  onCommand?: (command: Record<string, unknown>, host: FakeHost) => void,
  options: { announceReady: boolean } = { announceReady: true },
): FakeHost {
  const stdin = new PassThrough()
  const stdout = new PassThrough()
  const exitListeners: Array<() => void> = []
  const host: FakeHost = {
    stdin,
    stdout,
    commands: [],
    killed: false,
    kill() {
      host.killed = true
    },
    onExit(listener) {
      exitListeners.push(listener)
    },
    write(raw) {
      stdout.write(raw)
    },
    reply(line) {
      stdout.write(`${line}\n`)
    },
    exit() {
      for (const listener of exitListeners) listener()
    },
  }
  if (options.announceReady) host.reply(READY_LINE)
  let buffered = ''
  stdin.on('data', (chunk: Buffer) => {
    buffered += chunk.toString('utf8')
    const lines = buffered.split('\n')
    buffered = lines.pop() ?? ''
    for (const line of lines.filter(Boolean)) {
      const command: Record<string, unknown> = JSON.parse(line)
      host.commands.push(command)
      onCommand?.(command, host)
    }
  })
  return host
}

const H3_ENDPOINT = { percent: 40, muted: false, endpointName: 'Fones de ouvido (QCY H3)' }

function answerWith(body: Record<string, unknown>) {
  return (command: Record<string, unknown>, host: FakeHost) =>
    host.reply(JSON.stringify({ id: command.id, ok: true, ...body }))
}

describe('windows volume control', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  describe('get', () => {
    it('reads the H3 endpoint volume', async () => {
      const host = createFakeHost(answerWith(H3_ENDPOINT))
      const control = createWindowsVolumeControl(() => host)

      await expect(control.get()).resolves.toEqual(H3_ENDPOINT)
      expect(host.commands).toEqual([{ id: expect.any(Number), op: 'get' }])
    })

    it('returns null when the H3 is not an active output', async () => {
      const host = createFakeHost(answerWith({ endpoint: null }))
      const control = createWindowsVolumeControl(() => host)

      await expect(control.get()).resolves.toBeNull()
    })

    it('rejects when the host reports an error', async () => {
      const host = createFakeHost((command, h) =>
        h.reply(JSON.stringify({ id: command.id, ok: false, error: 'boom' })),
      )
      const control = createWindowsVolumeControl(() => host)

      await expect(control.get()).rejects.toThrow('boom')
    })

    it('rejects the pending request when the host answers with a malformed line', async () => {
      const host = createFakeHost((_command, h) => h.reply('not json'))
      const control = createWindowsVolumeControl(() => host)

      await expect(control.get()).rejects.toThrow(/malformed/i)
    })

    it('rejects when the reading violates the schema', async () => {
      const host = createFakeHost(answerWith({ percent: 140, muted: false, endpointName: 'x' }))
      const control = createWindowsVolumeControl(() => host)

      await expect(control.get()).rejects.toThrow(/malformed/i)
    })

    it('matches responses to requests by id when they arrive out of order', async () => {
      const pending: Array<Record<string, unknown>> = []
      const host = createFakeHost((command) => pending.push(command))
      const control = createWindowsVolumeControl(() => host)

      const first = control.get()
      const second = control.get()
      await vi.advanceTimersByTimeAsync(0)
      const [firstCommand, secondCommand] = pending
      host.reply(JSON.stringify({ id: secondCommand?.id, ok: true, endpoint: null }))
      host.reply(JSON.stringify({ id: firstCommand?.id, ok: true, ...H3_ENDPOINT }))

      await expect(first).resolves.toEqual(H3_ENDPOINT)
      await expect(second).resolves.toBeNull()
    })
  })

  describe('set', () => {
    it.each([
      [30, 30],
      [33.6, 34],
      [-12, 0],
      [250, 100],
    ])('sends set commands with integer percent clamped to 0..100 (%s -> %s)', async (input, sent) => {
      const host = createFakeHost(answerWith({}))
      const control = createWindowsVolumeControl(() => host)

      await control.set(input)

      expect(host.commands).toEqual([{ id: expect.any(Number), op: 'set', percent: sent }])
    })

    it('rejects a percent that is not a number', async () => {
      const host = createFakeHost(answerWith({}))
      const control = createWindowsVolumeControl(() => host)

      await expect(control.set(Number.NaN)).rejects.toThrow(/percent/i)
      expect(host.commands).toEqual([])
    })
  })

  describe('host lifecycle', () => {
    it('rejects a request the host does not answer within 3 seconds', async () => {
      const host = createFakeHost()
      const control = createWindowsVolumeControl(() => host)

      const outcome = expect(control.get()).rejects.toThrow(/timed out/i)
      await vi.advanceTimersByTimeAsync(3000)
      await outcome
    })

    it('restarts the host after it exits and serves the next request', async () => {
      const first = createFakeHost(answerWith(H3_ENDPOINT))
      const second = createFakeHost(answerWith({ ...H3_ENDPOINT, percent: 55 }))
      const hosts = [first, second]
      const spawnHost = vi.fn(() => {
        const next = hosts.shift()
        if (!next) throw new Error('no more hosts')
        return next
      })
      const control = createWindowsVolumeControl(spawnHost)

      await control.get()
      first.exit()

      await expect(control.get()).resolves.toMatchObject({ percent: 55 })
      expect(spawnHost).toHaveBeenCalledTimes(2)
    })

    it('rejects in-flight requests when the host exits', async () => {
      const host = createFakeHost()
      const control = createWindowsVolumeControl(() => host)

      const outcome = expect(control.get()).rejects.toThrow(/exited/i)
      await vi.advanceTimersByTimeAsync(0)
      host.exit()
      await outcome
    })

    it('kills the host and rejects later requests after dispose', async () => {
      const host = createFakeHost(answerWith(H3_ENDPOINT))
      const control = createWindowsVolumeControl(() => host)
      await control.get()

      control.dispose()

      expect(host.killed).toBe(true)
      await expect(control.get()).rejects.toThrow(/disposed/i)
    })
  })

  describe('set when the H3 is not an active output', () => {
    it('rejects with VolumeEndpointUnavailableError', async () => {
      const host = createFakeHost(answerWith({ endpoint: null }))
      const control = createWindowsVolumeControl(() => host)

      await expect(control.set(30)).rejects.toBeInstanceOf(VolumeEndpointUnavailableError)
    })
  })

  describe('host startup', () => {
    it('waits for the ready line before the request timer starts', async () => {
      const host = createFakeHost(answerWith(H3_ENDPOINT), { announceReady: false })
      const control = createWindowsVolumeControl(() => host)

      const reading = control.get()
      await vi.advanceTimersByTimeAsync(8000)
      expect(host.commands).toEqual([])
      host.reply(READY_LINE)

      await expect(reading).resolves.toEqual(H3_ENDPOINT)
    })

    it('rejects waiting requests and kills the host when it is not ready within 10 seconds', async () => {
      const host = createFakeHost(answerWith(H3_ENDPOINT), { announceReady: false })
      const control = createWindowsVolumeControl(() => host)

      const outcome = expect(control.get()).rejects.toThrow(/not ready/i)
      await vi.advanceTimersByTimeAsync(10_000)
      await outcome

      expect(host.killed).toBe(true)
      expect(vi.getTimerCount()).toBe(0)
    })
  })

  describe('hung host', () => {
    it('kills the hung host and respawns it for the next request', async () => {
      const hung = createFakeHost()
      const healthy = createFakeHost(answerWith(H3_ENDPOINT))
      const hosts = [hung, healthy]
      const spawnHost = vi.fn(() => hosts.shift() ?? healthy)
      const control = createWindowsVolumeControl(spawnHost)

      const outcome = expect(control.get()).rejects.toThrow(/timed out/i)
      await vi.advanceTimersByTimeAsync(3000)
      await outcome
      expect(hung.killed).toBe(true)

      await expect(control.get()).resolves.toEqual(H3_ENDPOINT)
      expect(spawnHost).toHaveBeenCalledTimes(2)
    })
  })

  describe('response stream parsing', () => {
    it('reassembles a response line split across two chunks', async () => {
      const host = createFakeHost((command, h) => {
        const line = JSON.stringify({ id: command.id, ok: true, ...H3_ENDPOINT })
        h.write(line.slice(0, 15))
        h.write(`${line.slice(15)}\n`)
      })
      const control = createWindowsVolumeControl(() => host)

      await expect(control.get()).resolves.toEqual(H3_ENDPOINT)
    })

    it('serves several responses delivered in one chunk', async () => {
      const commands: Array<Record<string, unknown>> = []
      const host = createFakeHost((command) => commands.push(command))
      const control = createWindowsVolumeControl(() => host)

      const first = control.get()
      const second = control.get()
      await vi.advanceTimersByTimeAsync(0)
      host.write(
        `${JSON.stringify({ id: commands[0]?.id, ok: true, ...H3_ENDPOINT })}\n${JSON.stringify({ id: commands[1]?.id, ok: true, endpoint: null })}\n`,
      )

      await expect(first).resolves.toEqual(H3_ENDPOINT)
      await expect(second).resolves.toBeNull()
    })

    it('ignores responses with an unknown id', async () => {
      const host = createFakeHost((command, h) => {
        h.reply(JSON.stringify({ id: 9999, ok: true, endpoint: null }))
        h.reply(JSON.stringify({ id: command.id, ok: true, ...H3_ENDPOINT }))
      })
      const control = createWindowsVolumeControl(() => host)

      await expect(control.get()).resolves.toEqual(H3_ENDPOINT)
    })

    it('ignores a late response to a request that already timed out', async () => {
      const first = createFakeHost()
      const second = createFakeHost(answerWith({ ...H3_ENDPOINT, percent: 70 }))
      const hosts = [first, second]
      const control = createWindowsVolumeControl(() => hosts.shift() ?? second)

      const timedOut = expect(control.get()).rejects.toThrow(/timed out/i)
      await vi.advanceTimersByTimeAsync(3000)
      await timedOut
      first.reply(JSON.stringify({ id: first.commands[0]?.id, ok: true, ...H3_ENDPOINT }))

      await expect(control.get()).resolves.toMatchObject({ percent: 70 })
    })
  })

  describe('host exit without requests', () => {
    it('respawns on the next request without errors', async () => {
      const first = createFakeHost(answerWith(H3_ENDPOINT))
      const second = createFakeHost(answerWith(H3_ENDPOINT))
      const hosts = [first, second]
      const control = createWindowsVolumeControl(() => hosts.shift() ?? second)
      await control.get()

      expect(() => first.exit()).not.toThrow()

      await expect(control.get()).resolves.toEqual(H3_ENDPOINT)
    })
  })

  describe('dispose', () => {
    it('leaves no timer behind', async () => {
      const host = createFakeHost()
      const control = createWindowsVolumeControl(() => host)

      const outcome = expect(control.get()).rejects.toThrow(/disposed/i)
      await vi.advanceTimersByTimeAsync(0)
      control.dispose()
      await outcome

      expect(vi.getTimerCount()).toBe(0)
    })
  })
})
