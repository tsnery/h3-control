import { describe, expect, it } from 'vitest'
import { DEFAULT_NOISE_CANCELLING } from '../src/shared/headset-types'
import { EqTlvFormat } from '../src/main/h3/eq'
import { Opcode } from '../src/main/rcsp/opcode'
import { createFakeH3 } from '../src/main/transport/fake-h3'
import type { HeadsetTransport } from '../src/main/transport/headset-transport'
import probeA from '../src/main/transport/fixtures/h3-probe-a.json'
import { type ProbeRecord, ProbeRecordSchema } from './probe-record'
import { runProbe } from './probe-run'

const REQUEST_TIMEOUT_MS = 20
const OPCODE_INDEX = 4
const LONG_PAUSE_MS = 60_000
const POLL_MS = 5

const framesWithOpcode = (frames: Uint8Array[], opcode: Opcode): number =>
  frames.filter((frame) => frame[OPCODE_INDEX] === opcode).length

const baseOptions = {
  pauseMs: 0,
  eqFormat: null,
  requestTimeoutMs: REQUEST_TIMEOUT_MS,
  loadStageA: async () => null,
  log: () => undefined,
}

describe('runProbe stage a when GetTargetInfo never answers', () => {
  it('writes NotifyCommunicationWay once and each GetTargetInfo once, all recorded', async () => {
    const fake = createFakeH3({ respondsToTargetInfo: false })
    const saved: ProbeRecord[] = []
    await runProbe({
      ...baseOptions,
      transport: fake.transport,
      stage: 'a',
      interrupt: new AbortController().signal,
      save: async (record) => {
        saved.push(record)
      },
    })

    const frames = fake.writtenFrames()
    expect(framesWithOpcode(frames, Opcode.GetTargetInfo)).toBe(2)
    expect(framesWithOpcode(frames, Opcode.NotifyCommunicationWay)).toBe(1)
    const labels = saved[0]?.steps.map((step) => step.label) ?? []
    expect(labels.slice(0, 3)).toEqual(['GetTargetInfo', 'NotifyCommunicationWayBle', 'GetTargetInfoRetry'])
    expect(saved[0]?.steps[1]?.txHex).toMatch(/^FE DC BA C0 0B /)
  })
})

describe('runProbe stage b', () => {
  it('restores ANC and saves before closing when interrupted after transparency', async () => {
    const fake = createFakeH3()
    const events: string[] = []
    const transport: HeadsetTransport = {
      connect: async (options) => {
        const link = await fake.transport.connect(options)
        return {
          ...link,
          disconnect: async () => {
            events.push('close')
            await link.disconnect()
          },
        }
      },
    }
    const interrupt = new AbortController()
    const saved: ProbeRecord[] = []
    const poll = setInterval(() => {
      if (fake.state().anc.mode === 'transparency') interrupt.abort()
    }, POLL_MS)
    await runProbe({
      ...baseOptions,
      pauseMs: LONG_PAUSE_MS,
      transport,
      stage: 'b',
      interrupt: interrupt.signal,
      save: async (record) => {
        events.push('save')
        saved.push(record)
      },
    })
    clearInterval(poll)

    expect(fake.state().anc).toEqual(DEFAULT_NOISE_CANCELLING)
    expect(events).toEqual(['save', 'close'])
    expect(saved[0]?.steps.map((step) => step.label)).toContain('RestoreAncOnExit')
  })

  it('does not send a second restore when the plan already restored ANC', async () => {
    const fake = createFakeH3()
    const saved: ProbeRecord[] = []
    await runProbe({
      ...baseOptions,
      transport: fake.transport,
      stage: 'b',
      interrupt: new AbortController().signal,
      save: async (record) => {
        saved.push(record)
      },
    })
    const labels = saved[0]?.steps.map((step) => step.label) ?? []
    expect(labels).toContain('RestoreAnc')
    expect(labels).not.toContain('RestoreAncOnExit')
  })
})

describe('runProbe stage eq', () => {
  const stageARecord = ProbeRecordSchema.parse(probeA)

  const runEq = async (loaded: ProbeRecord | null, eqFormat: EqTlvFormat | null = null) => {
    const fake = createFakeH3()
    const saved: ProbeRecord[] = []
    await runProbe({
      ...baseOptions,
      eqFormat,
      transport: fake.transport,
      stage: 'eq',
      interrupt: new AbortController().signal,
      loadStageA: async () => loaded,
      save: async (record) => {
        saved.push(record)
      },
    })
    return { fake, saved }
  }

  it('reads, rewrites and reads the EQ in the format of the stage a firmware, leaving ANC alone', async () => {
    const { fake, saved } = await runEq(stageARecord)

    expect(saved[0]?.steps.map((step) => step.label)).toEqual(['ReadEq', 'RewriteCurrentEq', 'ReadEq'])
    expect(saved[0]?.steps[1]?.txHex).toMatch(/^FE DC BA C0 FF 00 4C \w\w 22 49 01 DA FD /)
    expect(saved[0]?.steps.every((step) => step.error === null)).toBe(true)
    expect(fake.state().anc).toEqual(DEFAULT_NOISE_CANCELLING)
    expect(framesWithOpcode(fake.writtenFrames(), Opcode.Custom)).toBe(3)
  })

  it('only reads when there is no stage a record', async () => {
    const { saved } = await runEq(null)

    expect(saved[0]?.steps.map((step) => step.label)).toEqual(['ReadEq'])
    expect(saved[0]?.steps[0]?.txHex).toMatch(/FE 01 22 EF$/)
  })

  it('lets the eq format flag override the firmware default', async () => {
    const { saved } = await runEq(stageARecord, EqTlvFormat.SixByte)

    expect(saved[0]?.steps.map((step) => step.label)).toEqual(['ReadEq'])
    expect(saved[0]?.steps[0]?.txHex).toMatch(/FE 01 20 EF$/)
  })
})

describe('runProbe pushes', () => {
  it('records the raw bytes of a button push, including the flag byte', async () => {
    const fake = createFakeH3()
    const transport: HeadsetTransport = {
      connect: async (options) => {
        const link = await fake.transport.connect(options)
        return {
          ...link,
          write: async (frame) => {
            fake.pressAncButton({ mode: 'transparency' })
            await link.write(frame)
          },
        }
      },
    }
    const saved: ProbeRecord[] = []
    await runProbe({
      ...baseOptions,
      transport,
      stage: 'a',
      interrupt: new AbortController().signal,
      save: async (record) => {
        saved.push(record)
      },
    })

    expect(saved[0]?.pushes[0]).toMatchObject({
      payloadHex: '17 03 03 01 04',
      rawHex: 'FE DC BA C0 FF 00 06 00 17 03 03 01 04 EF',
    })
  })
})
