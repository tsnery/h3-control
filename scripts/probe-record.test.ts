import { describe, expect, it } from 'vitest'
import { EqTlvFormat } from '../src/main/h3/eq'
import probeA from '../src/main/transport/fixtures/h3-probe-a.json'
import {
  ProbeRecordSchema,
  contextFromStageA,
  eqFormatFromStageA,
  type ProbeRecord,
  type StepRecord,
} from './probe-record'

const step = (label: string, payloadHex: string): StepRecord => ({
  label,
  txHex: '',
  rxChunksHex: [],
  rxFrames: [{ kind: 'response', opcode: 0xff, sn: 0, status: 0, payloadHex }],
  elapsedMs: 1,
  error: null,
})

const record = (steps: StepRecord[]): ProbeRecord => ({
  startedAt: '2026-10-19T12:00:00.000Z',
  deviceId: 'aa',
  deviceName: 'QCY H3-APP',
  steps,
  pushes: [],
  fatalError: null,
})

describe('contextFromStageA', () => {
  it('decodes the ANC setting from the ReadAnc response', () => {
    const context = contextFromStageA(record([step('ReadAnc', '17 03 03 01 04')]), null)
    expect(context.ancBefore).toEqual({ mode: 'transparency' })
  })

  it('falls back to null when nothing decodes', () => {
    const context = contextFromStageA(record([]), null)
    expect(context).toEqual({ ancBefore: null, eqBefore: null, eqFormat: EqTlvFormat.SixByte })
  })

  it('honours a forced EQ format', () => {
    const context = contextFromStageA(record([]), EqTlvFormat.SevenByte)
    expect(context.eqFormat).toBe(EqTlvFormat.SevenByte)
  })
})

describe('ProbeRecordSchema', () => {
  it('accepts the captured stage a record', () => {
    expect(ProbeRecordSchema.safeParse(probeA).success).toBe(true)
  })

  it('accepts a push with and without rawHex', () => {
    const push = { atMs: 1, opcode: 255, sn: 4, payloadHex: '17 03 01 01 02' }
    const withRaw = { ...record([]), pushes: [{ ...push, rawHex: 'FE DC BA C0 FF 00 06 04 17 03 01 01 02 EF' }] }
    const withoutRaw = { ...record([]), pushes: [push] }
    expect(ProbeRecordSchema.safeParse(withRaw).success).toBe(true)
    expect(ProbeRecordSchema.safeParse(withoutRaw).success).toBe(true)
  })
})

describe('eqFormatFromStageA', () => {
  it('picks the 7-byte format for the captured firmware 0.9.1.2', () => {
    expect(eqFormatFromStageA(ProbeRecordSchema.parse(probeA))).toBe(EqTlvFormat.SevenByte)
  })

  it('picks the 7-byte format when no firmware was recorded', () => {
    expect(eqFormatFromStageA(record([]))).toBe(EqTlvFormat.SevenByte)
  })

  it('picks the 6-byte format for firmware below 0.9.0.0', () => {
    const targetInfo = step('GetTargetInfo', '03 05 08 00')
    expect(eqFormatFromStageA(record([targetInfo]))).toBe(EqTlvFormat.SixByte)
  })
})
