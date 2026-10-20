import type { AncSetting, EqState } from '../src/shared/headset-types'
import { EqTlvFormat } from '../src/main/h3/eq'
import { type H3Command, h3Commands } from '../src/main/h3/h3-commands'
import { encodeCommandFrame } from '../src/main/rcsp/frame'

export type ProbeStage = 'a' | 'b' | 'eq'

export type ProbeStep = { label: string; command: H3Command } | { label: string; pause: string }

export type ProbeContext = {
  ancBefore: AncSetting | null
  eqBefore: EqState | null
  eqFormat: EqTlvFormat
}

export const ANC_BUTTON_PAUSE_MESSAGE = 'Confira o som e aperte o botão de ANC do fone'

const DRY_RUN_SN = 0
const HEX_RADIX = 16

export function toHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(HEX_RADIX).toUpperCase().padStart(2, '0')).join(' ')
}

function stageA(now: Date): ProbeStep[] {
  return [
    { label: 'GetTargetInfo', command: h3Commands.getTargetInfo() },
    { label: 'SyncTime', command: h3Commands.syncTime(now) },
    { label: 'ReadBattery', command: h3Commands.readBattery() },
    { label: 'ReadName', command: h3Commands.readName() },
    { label: 'ReadAnc', command: h3Commands.readAnc() },
    { label: 'ReadEq20', command: h3Commands.readEq(EqTlvFormat.SixByte) },
    { label: 'ReadEq22', command: h3Commands.readEq(EqTlvFormat.SevenByte) },
  ]
}

function rewriteEq(eqBefore: EqState | null, format: EqTlvFormat): ProbeStep[] {
  if (eqBefore === null || eqBefore.kind === 'unknown') return []
  const command =
    eqBefore.kind === 'preset'
      ? h3Commands.applyEqPreset(eqBefore.presetId, format)
      : h3Commands.applyCustomEq(eqBefore.gainsDb, format, false)
  return [{ label: 'RewriteCurrentEq', command }]
}

function stageEq({ eqBefore, eqFormat }: ProbeContext): ProbeStep[] {
  const read: ProbeStep = { label: 'ReadEq', command: h3Commands.readEq(eqFormat) }
  const rewrite = rewriteEq(eqBefore, eqFormat)
  return rewrite.length === 0 ? [read] : [read, ...rewrite, read]
}

function stageB({ ancBefore, eqBefore, eqFormat }: ProbeContext): ProbeStep[] {
  if (ancBefore === null) return [{ label: 'ReadAnc', command: h3Commands.readAnc() }]
  return [
    { label: 'ReadAnc', command: h3Commands.readAnc() },
    { label: 'SetAncTransparency', command: h3Commands.setAnc({ mode: 'transparency' }) },
    { label: 'ManualAncButton', pause: ANC_BUTTON_PAUSE_MESSAGE },
    { label: 'ReadAnc', command: h3Commands.readAnc() },
    { label: 'RestoreAnc', command: h3Commands.setAnc(ancBefore) },
    { label: 'ReadAnc', command: h3Commands.readAnc() },
    ...rewriteEq(eqBefore, eqFormat),
  ]
}

export function buildProbePlan(stage: ProbeStage, context: ProbeContext, now: Date = new Date()): ProbeStep[] {
  if (stage === 'a') return stageA(now)
  return stage === 'b' ? stageB(context) : stageEq(context)
}

function formatFrame(label: string, { opcode, payload }: H3Command): string {
  return `${label}: ${toHex(encodeCommandFrame({ opcode, sn: DRY_RUN_SN, payload }))}`
}

export function formatDryRun(plan: readonly ProbeStep[]): string[] {
  return plan.map((step) =>
    'pause' in step ? `${step.label}: PAUSE ${step.pause}` : formatFrame(step.label, step.command),
  )
}

export function formatConditionalFrames(stage: ProbeStage, context: ProbeContext): string[] {
  if (stage === 'a') {
    return [
      `# if GetTargetInfo does not answer: ${formatFrame('NotifyCommunicationWayBle', h3Commands.notifyCommunicationWayBle())}`,
      `# then ${formatFrame('GetTargetInfoRetry', h3Commands.getTargetInfo())}`,
    ]
  }
  if (stage === 'eq') return []
  const preflight = `# first: ${formatFrame('PreflightReadAnc', h3Commands.readAnc())}`
  if (context.ancBefore === null) return [preflight]
  const restore = formatFrame('RestoreAncOnExit', h3Commands.setAnc(context.ancBefore))
  return [preflight, `# on interrupt after SetAncTransparency: ${restore}`]
}
