import { describe, expect, it, vi } from 'vitest'
import { decodeAncSetting } from '../h3/anc'
import { EqTlvFormat } from '../h3/eq'
import { type H3Command, h3Commands } from '../h3/h3-commands'
import { decodeAdvInfo } from '../rcsp/adv-info'
import { Opcode } from '../rcsp/opcode'
import { decodeTlvs } from '../rcsp/qcy-tlv'
import { RcspTimeoutError, createRcspClient } from '../rcsp/rcsp-client'
import { decodeTargetInfo } from '../rcsp/target-info'
import { type FakeH3, type FakeH3State, createFakeH3 } from './fake-h3'
import probeA from './fixtures/h3-probe-a.json'
import probeB from './fixtures/h3-probe-b.json'
import probeEq from './fixtures/h3-probe-eq.json'
import { TransportError } from './headset-transport'

const attemptConnect = (fake: FakeH3) =>
  fake.transport.connect({ preferredDeviceId: null, signal: new AbortController().signal })

const connect = async (initial?: Partial<FakeH3State>) => {
  const fake = createFakeH3(initial)
  const link = await attemptConnect(fake)
  return { fake, link, client: createRcspClient(link) }
}

describe('createFakeH3', () => {
  describe('ANC', () => {
    it('starts as noise-cancelling, noisy, high like the owner headset', async () => {
      const { client } = await connect()

      const response = await client.request(h3Commands.readAnc())

      expect([...response.payload]).toEqual([0x17, 3, 1, 1, 2])
    })

    it('answers a read of ANC with the current setting', async () => {
      const { client } = await connect({ anc: { mode: 'transparency' } })

      const response = await client.request(h3Commands.readAnc())

      const [tlv] = decodeTlvs(response.payload)
      expect(decodeAncSetting(tlv?.data ?? new Uint8Array())).toEqual({ mode: 'transparency' })
    })

    it('changes ANC when it receives setAnc', async () => {
      const { fake, client } = await connect()

      const response = await client.request(h3Commands.setAnc({ mode: 'transparency' }))

      expect(response.status).toBe(0)
      expect(response.payload).toHaveLength(0)
      expect(fake.state().anc).toEqual({ mode: 'transparency' })
    })

    it('pushes the new setting when the ANC button is pressed', async () => {
      const { fake, link, client } = await connect()
      const pushed: number[][] = []
      const rawChunks: Uint8Array[] = []
      link.onNotification((chunk) => rawChunks.push(chunk))
      client.onPush((frame) => pushed.push([frame.opcode, ...frame.payload]))

      fake.pressAncButton({ mode: 'transparency' })

      expect(pushed).toEqual([[Opcode.Custom, 0x17, 3, 3, 1, 4]])
      expect([...(rawChunks[0] ?? []).slice(0, 5)]).toEqual([0xfe, 0xdc, 0xba, 0xc0, 0xff])
      expect(fake.state().anc).toEqual({ mode: 'transparency' })
    })
  })

  describe('target info', () => {
    it('reports firmware and vendor id', async () => {
      const { client } = await connect()

      const response = await client.request(h3Commands.getTargetInfo())

      expect(decodeTargetInfo(response.payload)).toEqual({
        firmwareVersion: '0.9.1.2',
        vendorId: 7250,
        productId: 16755,
      })
    })

    it('stays silent when configured not to answer', async () => {
      vi.useFakeTimers()
      try {
        const { client } = await connect({ respondsToTargetInfo: false })

        const outcome = expect(client.request(h3Commands.getTargetInfo())).rejects.toBeInstanceOf(RcspTimeoutError)
        await vi.advanceTimersByTimeAsync(10_000)

        await outcome
      } finally {
        vi.useRealTimers()
      }
    })
    it('answers target info only after the BLE communication notice when it needs one', async () => {
      vi.useFakeTimers()
      try {
        const { client } = await connect({ needsCommunicationWayNotice: true })

        const silent = expect(client.request(h3Commands.getTargetInfo())).rejects.toBeInstanceOf(RcspTimeoutError)
        await vi.advanceTimersByTimeAsync(10_000)
        await silent
        await client.request(h3Commands.notifyCommunicationWayBle())
        const response = await client.request(h3Commands.getTargetInfo())

        expect(decodeTargetInfo(response.payload).firmwareVersion).toBe('0.9.1.2')
      } finally {
        vi.useRealTimers()
      }
    })
  })

  describe('adv info', () => {
    it('answers battery and name reads', async () => {
      const { client } = await connect()

      const battery = decodeAdvInfo((await client.request(h3Commands.readBattery())).payload)
      const name = decodeAdvInfo((await client.request(h3Commands.readName())).payload)

      expect([...(battery.get(0) ?? [])]).toEqual([50, 0, 0])
      expect(new TextDecoder().decode(name.get(1))).toBe('QCY H3')
    })

    it('renames the headset', async () => {
      const { fake, client } = await connect()

      await client.request(h3Commands.rename('Meu fone'))

      expect(fake.state().name).toBe('Meu fone')
    })

    it('accepts time sync and the BLE communication notice', async () => {
      const { client } = await connect()

      const time = await client.request(h3Commands.syncTime(new Date(0)))
      const way = await client.request(h3Commands.notifyCommunicationWayBle())

      expect([...time.payload]).toEqual([0])
      expect(way.payload).toHaveLength(0)
    })
  })

  describe('EQ', () => {
    it('stores a written EQ and answers reads with it', async () => {
      const { fake, client } = await connect()

      await client.request(h3Commands.applyEqPreset(3, EqTlvFormat.SevenByte))
      const response = await client.request(h3Commands.readEq(EqTlvFormat.SevenByte))

      expect(fake.state().eqIndex).toBe(3)
      expect(decodeTlvs(response.payload)[0]?.data[0]).toBe(3)
    })

    it('stays silent when TLV 0x20 is read, like the real H3', async () => {
      vi.useFakeTimers()
      try {
        const { client } = await connect()

        const read = expect(client.request(h3Commands.readEq(EqTlvFormat.SixByte))).rejects.toBeInstanceOf(
          RcspTimeoutError,
        )
        await vi.advanceTimersByTimeAsync(10_000)

        await read
      } finally {
        vi.useRealTimers()
      }
    })
  })

  describe('unknown commands', () => {
    it('answers status 2 for an opcode it does not know', async () => {
      const { client } = await connect()
      const unknown: H3Command = { opcode: Opcode.UpdateSysInfo, payload: new Uint8Array() }

      await expect(client.request(unknown)).rejects.toMatchObject({ status: 2 })
    })

    it('answers status 2 for an unknown custom TLV', async () => {
      const { client } = await connect()
      const unknown: H3Command = { opcode: Opcode.Custom, payload: Uint8Array.of(0x30, 1, 0) }

      await expect(client.request(unknown)).rejects.toMatchObject({ status: 2 })
    })
  })

  describe('captured session', () => {
    const toBytes = (hex: string): Uint8Array =>
      Uint8Array.from(hex.split(' '), (token) => Number.parseInt(token, 16))
    const toHex = (bytes: Uint8Array): string =>
      [...bytes].map((byte) => byte.toString(16).toUpperCase().padStart(2, '0')).join(' ')
    const SETTLE_MS = 5

    it.each([
      ['stage a', probeA],
      ['stage b', probeB],
      ['stage eq', probeEq],
    ])('replays the captured probe session byte for byte (%s)', async (_stage, record) => {
      const fake = createFakeH3()
      const link = await attemptConnect(fake)
      let received: string[] = []
      link.onNotification((chunk) => received.push(toHex(chunk)))

      for (const step of record.steps) {
        received = []
        if (step.txHex === '') {
          const [push] = record.pushes
          if (push === undefined) continue
          const pushedAnc = decodeAncSetting(decodeTlvs(toBytes(push.payloadHex))[0]?.data ?? new Uint8Array())
          if (pushedAnc === null) throw new Error('Captured push is not an ANC TLV')
          fake.pressAncButton(pushedAnc)
          expect(received.join(' '), step.label).toMatch(new RegExp(`${push.payloadHex} EF$`))
          continue
        }
        for (const frame of step.txHex.split(' | ')) await link.write(toBytes(frame))
        await new Promise((resolve) => setTimeout(resolve, SETTLE_MS))

        expect(received, step.label).toEqual(step.rxChunksHex)
      }
    })
  })

  describe('connection', () => {
    it('records every written frame in order', async () => {
      const { fake, client } = await connect()

      await client.request(h3Commands.readName())
      await client.request(h3Commands.readAnc())

      expect(fake.writtenFrames()).toHaveLength(2)
    })

    it('goes silent without a disconnect event when it powers off silently', async () => {
      vi.useFakeTimers()
      try {
        const { fake, link, client } = await connect()
        const onDisconnect = vi.fn()
        link.onDisconnect(onDisconnect)

        fake.powerOffSilently()
        const read = expect(client.request(h3Commands.readAnc())).rejects.toBeInstanceOf(RcspTimeoutError)
        await vi.advanceTimersByTimeAsync(10_000)

        await read
        expect(onDisconnect).not.toHaveBeenCalled()
        await expect(attemptConnect(fake)).rejects.toMatchObject({ code: 'device-not-found' })
      } finally {
        vi.useRealTimers()
      }
    })

    it('rejects connect with adapter-unavailable when the adapter is off', async () => {
      const fake = createFakeH3()
      fake.setAdapterAvailable(false)

      await expect(attemptConnect(fake)).rejects.toMatchObject({ code: 'adapter-unavailable' })
    })

    it('disconnects the live link when the adapter goes off', async () => {
      const { fake, link } = await connect()
      const onDisconnect = vi.fn()
      link.onDisconnect(onDisconnect)

      fake.setAdapterAvailable(false)

      expect(onDisconnect).toHaveBeenCalledTimes(1)
    })

    it('disconnects and refuses connections with device-not-found until powered on', async () => {
      const { fake, link } = await connect()
      const onDisconnect = vi.fn()
      link.onDisconnect(onDisconnect)

      fake.powerOff()
      expect(onDisconnect).toHaveBeenCalledTimes(1)
      const failure = await attemptConnect(fake).catch((error: unknown) => error)
      expect(failure).toBeInstanceOf(TransportError)
      expect(failure).toMatchObject({ code: 'device-not-found' })

      fake.powerOn()
      await expect(attemptConnect(fake)).resolves.toBeDefined()
    })
  })
})
