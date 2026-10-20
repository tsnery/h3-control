import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { h3Commands } from '../h3/h3-commands'
import type { ConnectedLink } from '../transport/headset-transport'
import { createRcspClient, RcspClosedError, RcspStatusError, RcspTimeoutError } from './rcsp-client'
import { Opcode } from './opcode'

const RESPONSE_FLAG = 0x00
const COMMAND_FLAG = 0xc0

const frameOf = (flag: number, opcode: number, body: number[]): Uint8Array =>
  Uint8Array.of(0xfe, 0xdc, 0xba, flag, opcode, 0, body.length, ...body, 0xef)

const responseFrame = (opcode: number, sn: number, status = 0, payload: number[] = []): Uint8Array =>
  frameOf(RESPONSE_FLAG, opcode, [status, sn, ...payload])

const snOf = (frame: Uint8Array): number => frame[7] ?? -1

const createLink = (write: (frame: Uint8Array) => Promise<void> = async () => undefined) => {
  const notificationListeners = new Set<(chunk: Uint8Array) => void>()
  const disconnectListeners = new Set<() => void>()
  const writes: Uint8Array[] = []
  const link: ConnectedLink = {
    deviceId: 'test',
    deviceName: 'QCY H3-APP',
    write: async (frame) => {
      writes.push(frame)
      await write(frame)
    },
    onNotification: (listener) => {
      notificationListeners.add(listener)
      return () => notificationListeners.delete(listener)
    },
    onDisconnect: (listener) => {
      disconnectListeners.add(listener)
      return () => disconnectListeners.delete(listener)
    },
    disconnect: async () => undefined,
  }
  return {
    link,
    writes,
    notify: (chunk: Uint8Array) => notificationListeners.forEach((listener) => listener(chunk)),
    disconnect: () => disconnectListeners.forEach((listener) => listener()),
  }
}

describe('createRcspClient', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  describe('sequence numbers', () => {
    it('numbers commands from 0 and wraps after 255', async () => {
      const { link, writes, notify } = createLink(async (frame) => {
        notify(responseFrame(frame[4] ?? 0, snOf(frame)))
      })
      const client = createRcspClient(link)

      for (let count = 0; count < 258; count += 1) {
        await client.request(h3Commands.readName())
      }

      const sns = writes.map(snOf)
      expect(sns.slice(0, 3)).toEqual([0, 1, 2])
      expect(sns[255]).toBe(255)
      expect(sns.slice(256)).toEqual([0, 1])
    })
  })

  describe('matching', () => {
    it('resolves the response that matches opcode and sn', async () => {
      const { link, notify } = createLink()
      const client = createRcspClient(link)

      const pending = client.request(h3Commands.readName())
      await vi.advanceTimersByTimeAsync(0)
      notify(responseFrame(Opcode.GetAdvInfo, 9, 0, [0xaa]))
      notify(responseFrame(Opcode.GetAdvInfo, 0, 0, [0x01]))

      const response = await pending
      expect(response.sn).toBe(0)
      expect([...response.payload]).toEqual([0x01])
    })

    it('rejects with the device status when it is not zero', async () => {
      const { link, notify } = createLink()
      const client = createRcspClient(link)

      const pending = client.request(h3Commands.readName())
      const outcome = expect(pending).rejects.toMatchObject({ status: 2 })
      await vi.advanceTimersByTimeAsync(0)
      notify(responseFrame(Opcode.GetAdvInfo, 0, 2))

      await outcome
      await expect(pending).rejects.toBeInstanceOf(RcspStatusError)
    })
  })

  describe('timeouts', () => {
    it('resends the same frame after 2000 ms and fails after three resends', async () => {
      const { link, writes } = createLink()
      const client = createRcspClient(link)

      const pending = client.request(h3Commands.readName())
      const outcome = expect(pending).rejects.toBeInstanceOf(RcspTimeoutError)
      await vi.advanceTimersByTimeAsync(1999)
      expect(writes).toHaveLength(1)
      await vi.advanceTimersByTimeAsync(1)
      expect(writes).toHaveLength(2)
      await vi.advanceTimersByTimeAsync(4000)
      expect(writes).toHaveLength(4)
      let settled = false
      void pending.catch(() => {
        settled = true
      })
      await vi.advanceTimersByTimeAsync(1999)
      expect(settled).toBe(false)
      await vi.advanceTimersByTimeAsync(1)

      await outcome
      expect(writes).toHaveLength(4)
      writes.forEach((frame) => expect(frame).toEqual(writes[0]))
    })

    it('times out a write that never settles without stalling later requests', async () => {
      const { link, writes } = createLink((frame) => (snOf(frame) === 0 ? new Promise<void>(() => undefined) : Promise.resolve()))
      const client = createRcspClient(link, { maxResends: 0 })

      const stuck = client.request(h3Commands.readName())
      const stuckOutcome = expect(stuck).rejects.toBeInstanceOf(RcspTimeoutError)
      const next = client.request(h3Commands.readBattery())
      const nextOutcome = expect(next).rejects.toBeInstanceOf(RcspTimeoutError)
      await vi.advanceTimersByTimeAsync(2000)
      await stuckOutcome
      expect(writes.map(snOf)).toEqual([0, 1])
      await vi.advanceTimersByTimeAsync(2000)

      await nextOutcome
    })
  })

  describe('write ordering', () => {
    it('writes one frame at a time in call order', async () => {
      let releaseFirst: () => void = () => undefined
      const firstWrite = new Promise<void>((resolve) => {
        releaseFirst = resolve
      })
      const { link, writes } = createLink((frame) => (snOf(frame) === 0 ? firstWrite : Promise.resolve()))
      const client = createRcspClient(link)

      void client.request(h3Commands.readName()).catch(() => undefined)
      void client.request(h3Commands.readBattery()).catch(() => undefined)
      await vi.advanceTimersByTimeAsync(0)
      expect(writes.map(snOf)).toEqual([0])

      releaseFirst()
      await vi.advanceTimersByTimeAsync(0)
      expect(writes.map(snOf)).toEqual([0, 1])
      client.close()
    })
  })

  describe('device pushes', () => {
    it('delivers device-pushed command frames to push listeners', () => {
      const { link, notify } = createLink()
      const client = createRcspClient(link)
      const received: number[][] = []
      client.onPush((frame) => received.push([frame.opcode, frame.sn, ...frame.payload]))

      notify(frameOf(COMMAND_FLAG, Opcode.Custom, [7, 0x17, 3, 1, 2, 3]))

      expect(received).toEqual([[Opcode.Custom, 7, 0x17, 3, 1, 2, 3]])
    })
  })

  describe('push listener failures', () => {
    it('keeps resolving responses when a push listener throws', async () => {
      const { link, notify } = createLink()
      const client = createRcspClient(link)
      const healthy = vi.fn()
      client.onPush(() => {
        throw new Error('listener failed')
      })
      client.onPush(healthy)

      const pending = client.request(h3Commands.readName())
      await vi.advanceTimersByTimeAsync(0)
      const push = frameOf(COMMAND_FLAG, Opcode.Custom, [7, 0x17, 3, 1, 2, 3])
      const response = responseFrame(Opcode.GetAdvInfo, 0, 0, [0x01])
      notify(Uint8Array.of(...push, ...response))

      await expect(pending).resolves.toMatchObject({ sn: 0 })
      expect(healthy).toHaveBeenCalledTimes(1)
    })
  })

  describe('closing', () => {
    it('rejects pending requests when the link disconnects', async () => {
      const { link, disconnect } = createLink()
      const client = createRcspClient(link)

      const pending = client.request(h3Commands.readName())
      const outcome = expect(pending).rejects.toBeInstanceOf(RcspClosedError)
      await vi.advanceTimersByTimeAsync(0)
      disconnect()

      await outcome
      expect(vi.getTimerCount()).toBe(0)
    })

    it('rejects pending requests and stops timers on close', async () => {
      const { link, writes } = createLink()
      const client = createRcspClient(link)

      const pending = client.request(h3Commands.readName())
      const outcome = expect(pending).rejects.toBeInstanceOf(RcspClosedError)
      await vi.advanceTimersByTimeAsync(0)
      client.close()
      await vi.advanceTimersByTimeAsync(10_000)

      await outcome
      expect(writes).toHaveLength(1)
      await expect(client.request(h3Commands.readName())).rejects.toBeInstanceOf(RcspClosedError)
    })
  })
})
