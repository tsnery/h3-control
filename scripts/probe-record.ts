import { z } from 'zod'
import { decodeAncSetting, ANC_CMD_ID } from '../src/main/h3/anc'
import { EqTlvFormat, decodeEqTlv, toEqState } from '../src/main/h3/eq'
import { eqFormatForFirmware } from '../src/main/h3/h3-model'
import { decodeTargetInfo } from '../src/main/rcsp/target-info'
import { decodeTlvs } from '../src/main/rcsp/qcy-tlv'
import type { EqState } from '../src/shared/headset-types'
import type { ProbeContext } from './probe-plan'

const RxFrameSchema = z.object({
  kind: z.enum(['command', 'response']),
  opcode: z.number(),
  sn: z.number(),
  status: z.number().nullable(),
  payloadHex: z.string(),
})
export type RxFrameRecord = z.infer<typeof RxFrameSchema>

const StepRecordSchema = z.object({
  label: z.string(),
  txHex: z.string(),
  rxChunksHex: z.array(z.string()),
  rxFrames: z.array(RxFrameSchema),
  elapsedMs: z.number(),
  error: z.string().nullable(),
})
export type StepRecord = z.infer<typeof StepRecordSchema>

const PushRecordSchema = z.object({
  atMs: z.number(),
  opcode: z.number(),
  sn: z.number(),
  payloadHex: z.string(),
  rawHex: z.string().optional(),
})
export type PushRecord = z.infer<typeof PushRecordSchema>

export const ProbeRecordSchema = z.object({
  startedAt: z.string(),
  deviceId: z.string(),
  deviceName: z.string(),
  steps: z.array(StepRecordSchema),
  pushes: z.array(PushRecordSchema),
  fatalError: z.string().nullable(),
})
export type ProbeRecord = z.infer<typeof ProbeRecordSchema>

const HEX_RADIX = 16

export function hexToBytes(hex: string): Uint8Array {
  const tokens = hex.split(/\s+/).filter((token) => token.length > 0)
  return Uint8Array.from(tokens, (token) => Number.parseInt(token, HEX_RADIX))
}

function responseTlvData(step: StepRecord | undefined, cmdId: number): Uint8Array | null {
  const response = step?.rxFrames.find((frame) => frame.kind === 'response' && frame.status === 0)
  if (response === undefined) return null
  return decodeTlvs(hexToBytes(response.payloadHex)).find((tlv) => tlv.cmdId === cmdId)?.data ?? null
}

export function decodeAncFromStep(step: StepRecord | undefined): ProbeContext['ancBefore'] {
  const data = responseTlvData(step, ANC_CMD_ID)
  return data === null ? null : decodeAncSetting(data)
}

function decodeEqFromStep(step: StepRecord | undefined, format: EqTlvFormat): EqState | null {
  const data = responseTlvData(step, format)
  if (data === null) return null
  const decoded = decodeEqTlv(format, data)
  return decoded === null ? null : toEqState(decoded)
}

const EQ_READ_LABELS: Record<EqTlvFormat, string> = {
  [EqTlvFormat.SixByte]: 'ReadEq20',
  [EqTlvFormat.SevenByte]: 'ReadEq22',
}
const EQ_FORMAT_PREFERENCE = [EqTlvFormat.SixByte, EqTlvFormat.SevenByte] as const

export function eqFormatFromStageA(record: ProbeRecord): EqTlvFormat {
  const response = record.steps
    .filter((step) => step.label.startsWith('GetTargetInfo'))
    .flatMap((step) => step.rxFrames)
    .find((frame) => frame.kind === 'response' && frame.status === 0)
  if (response === undefined) return eqFormatForFirmware(null)
  return eqFormatForFirmware(decodeTargetInfo(hexToBytes(response.payloadHex)).firmwareVersion)
}

export function contextFromStageA(record: ProbeRecord, forcedFormat: EqTlvFormat | null): ProbeContext {
  const stepNamed = (label: string): StepRecord | undefined => record.steps.find((step) => step.label === label)
  const decodedByFormat = EQ_FORMAT_PREFERENCE.map((format) => ({
    format,
    eq: decodeEqFromStep(stepNamed(EQ_READ_LABELS[format]), format),
  }))
  const eqFormat =
    forcedFormat ?? decodedByFormat.find(({ eq }) => eq !== null)?.format ?? EqTlvFormat.SixByte
  const eqBefore = decodedByFormat.find(({ format }) => format === eqFormat)?.eq ?? null
  return { ancBefore: decodeAncFromStep(stepNamed('ReadAnc')), eqBefore, eqFormat }
}
