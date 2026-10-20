import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  type AncSetting,
  DEFAULT_NOISE_CANCELLING,
  type HeadsetSnapshot,
} from '../../shared/headset-types'
import { ANC_CMD_ID, encodeAncSetting } from '../h3/anc'
import { EqTlvFormat } from '../h3/eq'
import { type H3Command, h3Commands } from '../h3/h3-commands'
import { AdvType } from '../rcsp/adv-info'
import { encodeCommandFrame } from '../rcsp/frame'
import { createFrameParser } from '../rcsp/frame-parser'
import { Opcode } from '../rcsp/opcode'
import { type KeyValueStore, createMemorySettingsStore } from '../settings-store'
import { type FakeH3, type FakeH3State, createFakeH3 } from '../transport/fake-h3'
import type { ConnectedLink, HeadsetTransport } from '../transport/headset-transport'
import {
  ANC_ECHO_SUPPRESSION_MS,
  type HeadsetService,
  NotConnectedError,
  POLL_INTERVAL_MS,
  RECONNECT_BACKOFF_MS,
  ReadOnlyError,
  createHeadsetService,
} from './headset-service'

const REQUEST_GIVE_UP_MS = 2000 * 4
const CUSTOM_GAINS = [3, 2, 1, 0, -1, -2, -3, 4, 5, 6]
const FIRST_CUSTOM_INDEX = 0xff
const LATER_CUSTOM_INDEX = 0x80
const EQ_INDEX_OFFSET = 2
const UNEXPECTED_VENDOR_ID = 0x05d6
const OLD_FIRMWARE = '0.8.1.2'
const TRANSPARENCY: AncSetting = { mode: 'transparency' }
const OFF: AncSetting = { mode: 'off' }
const REQUEST_ATTEMPTS = 4
const UNKNOWN_READ_PAYLOAD = Uint8Array.of(0xfe, 1, 0x30)
const LONG_WAIT_MS = 60_000

const READ_COMMANDS: ReadonlyArray<[string, H3Command]> = [
  ['GetTargetInfo', h3Commands.getTargetInfo()],
  ['NotifyCommunicationWay', h3Commands.notifyCommunicationWayBle()],
  ['ReadBattery', h3Commands.readBattery()],
  ['ReadName', h3Commands.readName()],
  ['ReadAnc', h3Commands.readAnc()],
  ['ReadEq', h3Commands.readEq(EqTlvFormat.SevenByte)],
  ['ReadEq20', h3Commands.readEq(EqTlvFormat.SixByte)],
]

type SentCommand = { label: string; sn: number; payload: Uint8Array }

const sameBytes = (left: Uint8Array, right: Uint8Array): boolean =>
  left.length === right.length && left.every((byte, index) => byte === right[index])

const writeLabel = (opcode: number, payload: Uint8Array): string => {
  if (opcode === Opcode.SetAdvInfo) return payload[1] === AdvType.Time ? 'SyncTime' : 'Rename'
  if (opcode === Opcode.Custom) return payload[0] === ANC_CMD_ID ? 'SetAnc' : 'WriteEq'
  return `opcode ${opcode}`
}

const decodeSent = (frame: Uint8Array): SentCommand => {
  const [parsed] = createFrameParser().push(frame)
  if (parsed === undefined || parsed.kind !== 'command') throw new Error('Service wrote an unparsable frame')
  const read = READ_COMMANDS.find(
    ([, command]) => command.opcode === parsed.opcode && sameBytes(command.payload, parsed.payload),
  )
  return { label: read?.[0] ?? writeLabel(parsed.opcode, parsed.payload), sn: parsed.sn, payload: parsed.payload }
}

type WriteInterceptor = (command: SentCommand, frame: Uint8Array) => Uint8Array | null

type HarnessOptions = {
  settings?: KeyValueStore
  interceptWrite?: WriteInterceptor
}

type Harness = {
  fake: FakeH3
  service: HeadsetService
  settings: KeyValueStore
  onError: ReturnType<typeof vi.fn<(error: unknown, context: string) => void>>
  connect: ReturnType<typeof vi.fn<HeadsetTransport['connect']>>
  snapshots: HeadsetSnapshot[]
  sent: () => SentCommand[]
  labels: () => string[]
}

const running: HeadsetService[] = []

const interceptWrites = (link: ConnectedLink, interceptWrite: WriteInterceptor | undefined): ConnectedLink => {
  if (interceptWrite === undefined) return link
  return {
    ...link,
    write: async (frame) => {
      const replacement = interceptWrite(decodeSent(frame), frame)
      if (replacement !== null) await link.write(replacement)
    },
  }
}

const createHarness = (initial: Partial<FakeH3State> = {}, options: HarnessOptions = {}): Harness => {
  const fake = createFakeH3(initial)
  const settings = options.settings ?? createMemorySettingsStore()
  const onError = vi.fn<(error: unknown, context: string) => void>()
  const connect = vi.fn<HeadsetTransport['connect']>(async (connectOptions) =>
    interceptWrites(await fake.transport.connect(connectOptions), options.interceptWrite),
  )
  const service = createHeadsetService({ transport: { connect }, settings, onError })
  const snapshots: HeadsetSnapshot[] = []
  service.onSnapshot((snapshot) => snapshots.push(snapshot))
  running.push(service)
  const sent = () => fake.writtenFrames().map(decodeSent)
  return { fake, service, settings, onError, connect, snapshots, sent, labels: () => sent().map(({ label }) => label) }
}

const createUnwritableSettings = (): KeyValueStore => {
  const store = createMemorySettingsStore()
  return {
    get: (key) => store.get(key),
    set: () => {
      throw Object.assign(new Error('EPERM: operation not permitted, rename'), { code: 'EPERM' })
    },
  }
}

const advance = (ms: number) => vi.advanceTimersByTimeAsync(ms)
const settle = () => advance(0)

const startConnected = async (harness: Harness): Promise<void> => {
  harness.service.start()
  await settle()
  expect(harness.service.getSnapshot().status).toBe('connected')
}

const expectAttemptsAfterBackoff = async (harness: Harness, delays: readonly number[]): Promise<void> => {
  for (const delay of delays) {
    const before = harness.connect.mock.calls.length
    await advance(delay - 1)
    expect(harness.connect).toHaveBeenCalledTimes(before)
    await advance(1)
    expect(harness.connect).toHaveBeenCalledTimes(before + 1)
  }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(async () => {
  await Promise.all(running.splice(0).map((service) => service.stop()))
  vi.useRealTimers()
})

describe('createHeadsetService', () => {
  describe('session', () => {
    it('starts searching with an empty snapshot', () => {
      const { service } = createHarness()

      expect(service.getSnapshot()).toEqual({
        status: 'searching',
        readOnly: null,
        name: null,
        firmwareVersion: null,
        battery: null,
        gameMode: null,
        anc: null,
        eq: null,
      })
    })

    it('runs the official session sequence after connecting', async () => {
      const harness = createHarness()

      await startConnected(harness)

      expect(harness.labels()).toEqual(['GetTargetInfo', 'SyncTime', 'ReadBattery', 'ReadName', 'ReadAnc', 'ReadEq'])
      expect(harness.service.getSnapshot()).toEqual({
        status: 'connected',
        readOnly: null,
        name: 'QCY H3',
        firmwareVersion: '0.9.1.2',
        battery: { percent: 50, charging: false },
        gameMode: false,
        anc: DEFAULT_NOISE_CANCELLING,
        eq: { kind: 'preset', presetId: 1 },
      })
    })

    it('publishes every snapshot change to listeners', async () => {
      const harness = createHarness()

      await startConnected(harness)

      expect(harness.snapshots.map(({ status }) => status)).toContain('connecting')
      expect(harness.snapshots.at(-1)).toEqual(harness.service.getSnapshot())
    })

    it('remembers the connected device as preferred', async () => {
      const harness = createHarness()

      await startConnected(harness)
      harness.fake.powerOff()
      harness.fake.powerOn()
      await advance(RECONNECT_BACKOFF_MS[0] ?? 0)

      expect(harness.settings.get('preferredDeviceId')).toBe('fake-h3')
      expect(harness.connect.mock.calls[0]?.[0].preferredDeviceId).toBeNull()
      expect(harness.connect.mock.calls[1]?.[0].preferredDeviceId).toBe('fake-h3')
    })

    it('reads EQ with the TLV its firmware uses', async () => {
      const harness = createHarness({ firmwareVersion: OLD_FIRMWARE })

      harness.service.start()
      await advance(REQUEST_GIVE_UP_MS)

      expect(harness.labels()).toContain('ReadEq20')
      expect(harness.labels()).not.toContain('ReadEq')
      expect(harness.service.getSnapshot()).toMatchObject({ status: 'connected', eq: null })
    })

    it('falls back to notify-communication-way when target info does not answer', async () => {
      const harness = createHarness({ needsCommunicationWayNotice: true })

      harness.service.start()
      await advance(REQUEST_GIVE_UP_MS)

      const labels = harness.labels()
      const notice = labels.indexOf('NotifyCommunicationWay')
      expect(notice).toBeGreaterThan(0)
      expect(labels.slice(0, notice).every((label) => label === 'GetTargetInfo')).toBe(true)
      expect(labels.slice(notice + 1, notice + 3)).toEqual(['GetTargetInfo', 'SyncTime'])
      expect(harness.service.getSnapshot().status).toBe('connected')
    })

    it('retries target info once even when the 0B notice gets no answer', async () => {
      let droppedTargetInfo = 0
      const harness = createHarness(
        {},
        {
          interceptWrite: (command, frame) => {
            if (command.label === 'NotifyCommunicationWay') return null
            if (command.label !== 'GetTargetInfo' || droppedTargetInfo === REQUEST_ATTEMPTS) return frame
            droppedTargetInfo += 1
            return null
          },
        },
      )

      harness.service.start()
      await advance(REQUEST_GIVE_UP_MS * 2)

      expect(harness.labels().slice(0, 2)).toEqual(['GetTargetInfo', 'SyncTime'])
      expect(harness.service.getSnapshot().status).toBe('connected')
    })

    it('drops the link and retries when target info never answers', async () => {
      const harness = createHarness({ respondsToTargetInfo: false })

      harness.service.start()
      await advance(REQUEST_GIVE_UP_MS * 2)

      expect(harness.labels().filter((label) => label === 'NotifyCommunicationWay')).toHaveLength(1)
      expect(harness.service.getSnapshot().status).toBe('searching')
      await expectAttemptsAfterBackoff(harness, [RECONNECT_BACKOFF_MS[0] ?? 0])
    })
  })

  describe('read-only mode', () => {
    it('enters read-only mode when the target ids are not a supported H3', async () => {
      const harness = createHarness({ vendorId: UNEXPECTED_VENDOR_ID })

      await startConnected(harness)
      const framesBefore = harness.fake.writtenFrames().length

      expect(harness.service.getSnapshot().readOnly).toBe('unexpected-vendor')
      await expect(harness.service.setAnc(OFF)).rejects.toBeInstanceOf(ReadOnlyError)
      await expect(harness.service.applyEqPreset(2)).rejects.toBeInstanceOf(ReadOnlyError)
      await expect(harness.service.applyCustomEq(CUSTOM_GAINS)).rejects.toBeInstanceOf(ReadOnlyError)
      await expect(harness.service.rename('Outro')).rejects.toBeInstanceOf(ReadOnlyError)
      await settle()
      expect(harness.fake.writtenFrames()).toHaveLength(framesBefore)
    })

    it('only reads from an unsupported headset and does not remember it', async () => {
      const harness = createHarness({ vendorId: UNEXPECTED_VENDOR_ID })

      await startConnected(harness)

      expect(harness.labels()).toEqual(['GetTargetInfo', 'ReadBattery', 'ReadName', 'ReadAnc', 'ReadEq'])
      expect(harness.settings.get('preferredDeviceId')).toBeNull()
    })
  })

  describe('polling', () => {
    it('polls battery and ANC every 3 seconds', async () => {
      const harness = createHarness()
      await startConnected(harness)
      const setupFrames = harness.labels().length

      await advance(POLL_INTERVAL_MS - 1)
      expect(harness.labels()).toHaveLength(setupFrames)
      await advance(1)
      expect(harness.labels().slice(setupFrames)).toEqual(['ReadBattery', 'ReadAnc'])
      await advance(POLL_INTERVAL_MS)
      expect(harness.labels().slice(setupFrames)).toEqual(['ReadBattery', 'ReadAnc', 'ReadBattery', 'ReadAnc'])
    })

    it('picks up game mode switched on the headset at the next poll', async () => {
      const harness = createHarness()
      await startConnected(harness)

      harness.fake.pressGameModeButton(true)
      await advance(POLL_INTERVAL_MS)

      expect(harness.service.getSnapshot().gameMode).toBe(true)
    })

    it('applies an ANC change pushed by the physical button', async () => {
      const harness = createHarness()
      await startConnected(harness)

      harness.fake.pressAncButton(TRANSPARENCY)
      await settle()

      expect(harness.service.getSnapshot().anc).toEqual(TRANSPARENCY)
    })

    it('ignores an ANC push within 1 second of its own change', async () => {
      const harness = createHarness()
      await startConnected(harness)
      await harness.service.setAnc(OFF)

      harness.fake.pressAncButton(TRANSPARENCY)
      await settle()
      expect(harness.service.getSnapshot().anc).toEqual(OFF)

      await advance(ANC_ECHO_SUPPRESSION_MS)
      harness.fake.pressAncButton(TRANSPARENCY)
      await settle()
      expect(harness.service.getSnapshot().anc).toEqual(TRANSPARENCY)
    })

    it('keeps the last chosen ANC when clicks race with polling', async () => {
      const harness = createHarness()
      await startConnected(harness)
      const setupFrames = harness.labels().length

      vi.advanceTimersByTime(POLL_INTERVAL_MS)
      const emittedBeforeClicks = harness.snapshots.length
      const clicks = Promise.all([harness.service.setAnc(TRANSPARENCY), harness.service.setAnc(OFF)])
      await settle()
      await clicks

      const sent = harness.sent().slice(setupFrames)
      expect(sent.map(({ label }) => label)).toEqual(['ReadBattery', 'ReadAnc', 'SetAnc', 'SetAnc'])
      expect([...(sent[2]?.payload ?? [])]).toEqual([...encodeAncSetting(TRANSPARENCY)])
      expect([...(sent[3]?.payload ?? [])]).toEqual([...encodeAncSetting(OFF)])
      expect(harness.snapshots.slice(emittedBeforeClicks).map(({ anc }) => anc)).toEqual([TRANSPARENCY, OFF])
      expect(harness.service.getSnapshot().anc).toEqual(OFF)
      expect(harness.fake.state().anc).toEqual(OFF)
    })

    it('does not count a status reply between two timeouts as link loss', async () => {
      let faulty = false
      const harness = createHarness(
        {},
        {
          interceptWrite: (command, frame) => {
            if (!faulty) return frame
            if (command.label === 'ReadBattery') return null
            if (command.label !== 'ReadAnc') return frame
            return encodeCommandFrame({ opcode: Opcode.Custom, sn: command.sn, payload: UNKNOWN_READ_PAYLOAD })
          },
        },
      )
      await startConnected(harness)

      faulty = true
      await advance((POLL_INTERVAL_MS + REQUEST_GIVE_UP_MS) * 2)

      expect(harness.service.getSnapshot().status).toBe('connected')
      const refusedReads = harness.sent().filter(({ payload }) => sameBytes(payload, UNKNOWN_READ_PAYLOAD))
      expect(refusedReads).toHaveLength(2)
    })

    it('treats two consecutive poll timeouts as link loss', async () => {
      const harness = createHarness()
      await startConnected(harness)

      harness.fake.powerOffSilently()
      await advance(POLL_INTERVAL_MS + REQUEST_GIVE_UP_MS)
      expect(harness.service.getSnapshot().status).toBe('connected')
      await advance(REQUEST_GIVE_UP_MS)
      expect(harness.service.getSnapshot().status).toBe('reconnecting')

      harness.fake.powerOn()
      await advance(RECONNECT_BACKOFF_MS[0] ?? 0)
      expect(harness.service.getSnapshot().status).toBe('connected')
    })
  })

  describe('disconnection', () => {
    it('rejects commands while disconnected and keeps reconnecting', async () => {
      const harness = createHarness()
      await startConnected(harness)

      harness.fake.powerOff()
      await settle()

      expect(harness.service.getSnapshot()).toMatchObject({
        status: 'reconnecting',
        name: 'QCY H3',
        battery: null,
        gameMode: null,
        anc: null,
        eq: null,
      })
      await expect(harness.service.setAnc(OFF)).rejects.toBeInstanceOf(NotConnectedError)
      await expectAttemptsAfterBackoff(harness, RECONNECT_BACKOFF_MS.slice(0, 3))
      expect(harness.service.getSnapshot().status).toBe('reconnecting')

      harness.fake.powerOn()
      await advance(RECONNECT_BACKOFF_MS[3] ?? 0)
      expect(harness.service.getSnapshot().status).toBe('connected')
    })

    it('fails a command in flight when the headset drops', async () => {
      const harness = createHarness()
      await startConnected(harness)

      harness.fake.powerOffSilently()
      const command = harness.service.setAnc(OFF)
      const outcome = expect(command).rejects.toBeInstanceOf(NotConnectedError)
      await settle()
      expect(harness.labels().at(-1)).toBe('SetAnc')
      harness.fake.powerOff()

      await outcome
      expect(harness.service.getSnapshot()).toMatchObject({ status: 'reconnecting', anc: null })
    })

    it('reports bluetooth-off and recovers when the adapter returns', async () => {
      const harness = createHarness()
      await startConnected(harness)

      harness.fake.setAdapterAvailable(false)
      await expectAttemptsAfterBackoff(harness, RECONNECT_BACKOFF_MS.slice(0, 4))

      expect(harness.service.getSnapshot().status).toBe('bluetooth-off')
      expect(harness.snapshots.filter(({ status }) => status === 'bluetooth-off')).toHaveLength(1)
      harness.fake.setAdapterAvailable(true)
      await advance(RECONNECT_BACKOFF_MS[4] ?? 0)
      expect(harness.service.getSnapshot().status).toBe('connected')
    })

    describe('restarted while a stopped connect is still pending', () => {
      type LateOutcome = 'rejects' | 'resolves'

      const runRestartRace = async (outcome: LateOutcome) => {
        const fake = createFakeH3()
        const links: { disconnected: boolean }[] = []
        const track = (link: ConnectedLink): ConnectedLink => {
          const entry = { disconnected: false }
          links.push(entry)
          return {
            ...link,
            disconnect: async () => {
              entry.disconnected = true
              await link.disconnect()
            },
          }
        }
        let finishFirst = (): void => undefined
        const connect = vi
          .fn<HeadsetTransport['connect']>()
          .mockImplementationOnce(
            () =>
              new Promise<ConnectedLink>((resolve, reject) => {
                finishFirst = () => {
                  if (outcome === 'rejects') return reject(new Error('Connection aborted'))
                  const ignoringAbort = { preferredDeviceId: null, signal: new AbortController().signal }
                  resolve(fake.transport.connect(ignoringAbort).then(track))
                }
              }),
          )
          .mockImplementation(async (options) => track(await fake.transport.connect(options)))
        const service = createHeadsetService({ transport: { connect }, settings: createMemorySettingsStore() })
        running.push(service)

        service.start()
        await settle()
        await service.stop()
        service.start()
        await settle()
        finishFirst()
        await advance(LONG_WAIT_MS)

        return { fake, links, connect, service }
      }

      it.each<LateOutcome>(['rejects', 'resolves'])(
        'keeps exactly one session and one live link when the old connect %s late',
        async (outcome) => {
          const { fake, links, connect, service } = await runRestartRace(outcome)

          expect(service.getSnapshot().status).toBe('connected')
          expect(connect).toHaveBeenCalledTimes(2)
          expect(links.filter(({ disconnected }) => !disconnected)).toHaveLength(1)
          const targetInfoReads = fake.writtenFrames().map(decodeSent).filter(({ label }) => label === 'GetTargetInfo')
          expect(targetInfoReads).toHaveLength(1)
        },
      )
    })

    it('stops polling and reconnecting once stopped', async () => {
      const harness = createHarness()
      await startConnected(harness)
      const framesBefore = harness.fake.writtenFrames().length

      await harness.service.stop()
      await advance(POLL_INTERVAL_MS * 10)

      expect(harness.fake.writtenFrames()).toHaveLength(framesBefore)
      expect(harness.connect).toHaveBeenCalledTimes(1)
      await expect(harness.service.setAnc(OFF)).rejects.toBeInstanceOf(NotConnectedError)
    })
  })

  describe('settings and error reporting', () => {
    it('connects even when the preferred device cannot be saved', async () => {
      const harness = createHarness({}, { settings: createUnwritableSettings() })

      await startConnected(harness)

      expect(harness.service.getSnapshot()).toMatchObject({ status: 'connected', name: 'QCY H3' })
      expect(harness.onError).toHaveBeenCalledWith(expect.any(Error), 'saving setting preferredDeviceId')
    })

    it('applies a custom EQ even when its first-write flag cannot be saved', async () => {
      const harness = createHarness({}, { settings: createUnwritableSettings() })
      await startConnected(harness)

      await harness.service.applyCustomEq(CUSTOM_GAINS)

      expect(harness.service.getSnapshot().eq).toEqual({ kind: 'custom', gainsDb: CUSTOM_GAINS })
      expect(harness.onError).toHaveBeenCalledWith(expect.any(Error), 'saving setting hasWrittenCustomEq')
    })

    it('saves a setting only when its value changes', async () => {
      const settings = createMemorySettingsStore()
      const set = vi.spyOn(settings, 'set')
      const harness = createHarness({}, { settings })
      await startConnected(harness)

      harness.fake.powerOff()
      harness.fake.powerOn()
      await advance(RECONNECT_BACKOFF_MS[0] ?? 0)

      expect(harness.service.getSnapshot().status).toBe('connected')
      expect(set).toHaveBeenCalledTimes(1)
    })

    it('reports a failing snapshot listener and still notifies the others', async () => {
      const harness = createHarness()
      const failure = new Error('listener bug')
      harness.service.onSnapshot(() => {
        throw failure
      })
      const after = vi.fn()
      harness.service.onSnapshot(after)

      await startConnected(harness)

      expect(after).toHaveBeenCalled()
      expect(harness.onError).toHaveBeenCalledWith(failure, 'snapshot listener')
    })
  })

  describe('EQ', () => {
    const eqIndexes = (harness: Harness): number[] =>
      harness
        .sent()
        .filter(({ label }) => label === 'WriteEq')
        .map(({ payload }) => payload[EQ_INDEX_OFFSET] ?? -1)

    it('uses index 0xFF for the first custom EQ and 0x80 afterwards', async () => {
      const settings = createMemorySettingsStore()
      const harness = createHarness({}, { settings })
      await startConnected(harness)

      await harness.service.applyCustomEq(CUSTOM_GAINS)
      await harness.service.applyCustomEq(CUSTOM_GAINS)

      expect(eqIndexes(harness)).toEqual([FIRST_CUSTOM_INDEX, LATER_CUSTOM_INDEX])
      expect(settings.get('hasWrittenCustomEq')).toBe(true)
      expect(harness.service.getSnapshot().eq).toEqual({ kind: 'custom', gainsDb: CUSTOM_GAINS })

      const nextRun = createHarness({}, { settings })
      await startConnected(nextRun)
      await nextRun.service.applyCustomEq(CUSTOM_GAINS)
      expect(eqIndexes(nextRun)).toEqual([LATER_CUSTOM_INDEX])
    })

    it('updates the snapshot to the applied preset', async () => {
      const harness = createHarness()
      await startConnected(harness)

      await harness.service.applyEqPreset(4)

      const [write] = harness.sent().filter(({ label }) => label === 'WriteEq')
      expect([...(write?.payload ?? [])]).toEqual([...h3Commands.applyEqPreset(4, EqTlvFormat.SevenByte).payload])
      expect(harness.service.getSnapshot().eq).toEqual({ kind: 'preset', presetId: 4 })
      expect(harness.fake.state().eqIndex).toBe(4)
    })

    it('rejects out-of-range custom gains without sending a frame', async () => {
      const harness = createHarness()
      await startConnected(harness)
      const framesBefore = harness.fake.writtenFrames().length

      await expect(harness.service.applyCustomEq([9, 0, 0, 0, 0, 0, 0, 0, 0, 0])).rejects.toBeInstanceOf(RangeError)

      expect(harness.fake.writtenFrames()).toHaveLength(framesBefore)
      expect(harness.settings.get('hasWrittenCustomEq')).toBe(false)
    })
  })

  describe('name', () => {
    it('renames and reads the new name back', async () => {
      const harness = createHarness()
      await startConnected(harness)
      const setupFrames = harness.labels().length

      await harness.service.rename('Meu H3')

      expect(harness.labels().slice(setupFrames)).toEqual(['Rename', 'ReadName'])
      expect(harness.fake.state().name).toBe('Meu H3')
      expect(harness.service.getSnapshot().name).toBe('Meu H3')
    })

    it.each([
      ['blank', '   '],
      ['longer than 31 bytes', 'á'.repeat(16)],
    ])('rejects an invalid name without sending a frame (%s)', async (_case, name) => {
      const harness = createHarness()
      await startConnected(harness)
      const framesBefore = harness.fake.writtenFrames().length

      await expect(harness.service.rename(name)).rejects.toBeInstanceOf(RangeError)

      expect(harness.fake.writtenFrames()).toHaveLength(framesBefore)
    })
  })
})
