import { describe, expect, it } from 'vitest'
import { EqTlvFormat } from '../src/main/h3/eq'
import { h3Commands } from '../src/main/h3/h3-commands'
import {
  buildProbePlan,
  formatConditionalFrames,
  formatDryRun,
  type ProbeContext,
  type ProbeStep,
} from './probe-plan'

const NOW = new Date('2026-10-19T12:00:00Z')
const stageAContext = { ancBefore: null, eqBefore: null, eqFormat: EqTlvFormat.SixByte }

const labels = (plan: ProbeStep[]): string[] => plan.map((step) => step.label)

describe('buildProbePlan stage a', () => {
  it('lists the seven read-only steps in order', () => {
    expect(labels(buildProbePlan('a', stageAContext, NOW))).toEqual([
      'GetTargetInfo',
      'SyncTime',
      'ReadBattery',
      'ReadName',
      'ReadAnc',
      'ReadEq20',
      'ReadEq22',
    ])
  })

  it('contains no pause and no state-changing command', () => {
    const plan = buildProbePlan('a', stageAContext, NOW)
    const forbidden = [h3Commands.setAnc({ mode: 'off' }), h3Commands.applyEqPreset(1, EqTlvFormat.SixByte)]
    const commands = plan.flatMap((step) => ('command' in step ? [step.command] : []))
    expect(commands).toHaveLength(7)
    for (const { payload } of forbidden) {
      expect(commands.some((command) => command.payload.toString() === payload.toString())).toBe(false)
    }
  })
})

describe('buildProbePlan stage b', () => {
  const ancBefore = { mode: 'off' } as const

  it('toggles ANC, waits for the physical button, restores ANC and rewrites the current EQ', () => {
    const plan = buildProbePlan('b', {
      ancBefore,
      eqBefore: { kind: 'preset', presetId: 2 },
      eqFormat: EqTlvFormat.SixByte,
    })
    expect(labels(plan)).toEqual([
      'ReadAnc',
      'SetAncTransparency',
      'ManualAncButton',
      'ReadAnc',
      'RestoreAnc',
      'ReadAnc',
      'RewriteCurrentEq',
    ])
    expect(plan[2]).toEqual({
      label: 'ManualAncButton',
      pause: 'Confira o som e aperte o botão de ANC do fone',
    })
  })

  it('restores the ANC setting read before the stage', () => {
    const plan = buildProbePlan('b', { ancBefore, eqBefore: null, eqFormat: EqTlvFormat.SixByte })
    const restore = plan.find((step) => step.label === 'RestoreAnc')
    expect(restore).toEqual({ label: 'RestoreAnc', command: h3Commands.setAnc(ancBefore) })
  })

  it('rewrites a preset EQ through the preset builder with the chosen format', () => {
    const plan = buildProbePlan('b', {
      ancBefore,
      eqBefore: { kind: 'preset', presetId: 3 },
      eqFormat: EqTlvFormat.SevenByte,
    })
    expect(plan.at(-1)).toEqual({
      label: 'RewriteCurrentEq',
      command: h3Commands.applyEqPreset(3, EqTlvFormat.SevenByte),
    })
  })

  it('rewrites a custom EQ through the custom builder without the first-write flag', () => {
    const gainsDb = [1, 0, -1, 2, 0, 0, 3, 0, 0, -2]
    const plan = buildProbePlan('b', {
      ancBefore,
      eqBefore: { kind: 'custom', gainsDb },
      eqFormat: EqTlvFormat.SixByte,
    })
    expect(plan.at(-1)).toEqual({
      label: 'RewriteCurrentEq',
      command: h3Commands.applyCustomEq(gainsDb, EqTlvFormat.SixByte, false),
    })
  })

  it('only reads when ANC before is unknown, never changing ANC or EQ', () => {
    const plan = buildProbePlan('b', {
      ancBefore: null,
      eqBefore: { kind: 'preset', presetId: 2 },
      eqFormat: EqTlvFormat.SixByte,
    })
    expect(labels(plan)).toEqual(['ReadAnc'])
  })

  it.each([null, { kind: 'unknown' } as const])('omits the EQ rewrite when eqBefore is %j', (eqBefore) => {
    const plan = buildProbePlan('b', { ancBefore, eqBefore, eqFormat: EqTlvFormat.SixByte })
    expect(labels(plan)).not.toContain('RewriteCurrentEq')
    expect(plan).toHaveLength(6)
  })
})

describe('buildProbePlan stage eq', () => {
  const eqContext = (eqBefore: ProbeContext['eqBefore']): ProbeContext => ({
    ancBefore: { mode: 'off' },
    eqBefore,
    eqFormat: EqTlvFormat.SevenByte,
  })

  it('reads the EQ, rewrites the current EQ and reads it again', () => {
    const plan = buildProbePlan('eq', eqContext({ kind: 'preset', presetId: 1 }))
    expect(labels(plan)).toEqual(['ReadEq', 'RewriteCurrentEq', 'ReadEq'])
    expect(plan[0]).toEqual({ label: 'ReadEq', command: h3Commands.readEq(EqTlvFormat.SevenByte) })
    expect(plan[1]).toEqual({
      label: 'RewriteCurrentEq',
      command: h3Commands.applyEqPreset(1, EqTlvFormat.SevenByte),
    })
  })

  it('never touches ANC', () => {
    const plan = buildProbePlan('eq', eqContext({ kind: 'preset', presetId: 1 }))
    const ancWrite = h3Commands.setAnc({ mode: 'transparency' }).payload.toString()
    const sent = plan.flatMap((step) => ('command' in step ? [step.command.payload.toString()] : []))
    expect(sent).not.toContain(ancWrite)
    expect(labels(plan).some((label) => label.includes('Anc'))).toBe(false)
  })

  it.each([null, { kind: 'unknown' } as const])('only reads once when eqBefore is %j', (eqBefore) => {
    expect(labels(buildProbePlan('eq', eqContext(eqBefore)))).toEqual(['ReadEq'])
  })

  it('prints the 10-band rewrite frame in the dry run', () => {
    const lines = formatDryRun(buildProbePlan('eq', eqContext({ kind: 'preset', presetId: 1 })))
    expect(lines[1]).toMatch(/^RewriteCurrentEq: FE DC BA C0 FF 00 4C 00 22 49 01 DA FD /)
  })

  it('has no conditional frames', () => {
    expect(formatConditionalFrames('eq', eqContext(null))).toEqual([])
  })
})

describe('formatDryRun', () => {
  it('prints one line per stage a step with the frame in hex and sn 00', () => {
    const lines = formatDryRun(buildProbePlan('a', stageAContext, NOW))
    expect(lines).toHaveLength(7)
    expect(lines[0]).toBe('GetTargetInfo: FE DC BA C0 03 00 06 00 FF FF FF FF 00 EF')
    expect(lines[1]).toMatch(/^SyncTime: FE DC BA C0 C0 00 07 00 05 07 [0-9A-F ]+ EF$/)
  })

  it('prints pauses with their message', () => {
    const lines = formatDryRun([{ label: 'ManualAncButton', pause: 'Aperte o botão' }])
    expect(lines).toEqual(['ManualAncButton: PAUSE Aperte o botão'])
  })
})

describe('formatConditionalFrames', () => {
  it('shows the stage a fallback frames as notes', () => {
    expect(formatConditionalFrames('a', stageAContext)).toEqual([
      '# if GetTargetInfo does not answer: NotifyCommunicationWayBle: FE DC BA C0 0B 00 03 00 00 00 EF',
      '# then GetTargetInfoRetry: FE DC BA C0 03 00 06 00 FF FF FF FF 00 EF',
    ])
  })

  it('shows the stage b preflight read and the restore sent on interruption', () => {
    const lines = formatConditionalFrames('b', {
      ancBefore: { mode: 'off' },
      eqBefore: null,
      eqFormat: EqTlvFormat.SixByte,
    })
    expect(lines).toEqual([
      '# first: PreflightReadAnc: FE DC BA C0 FF 00 04 00 FE 01 17 EF',
      '# on interrupt after SetAncTransparency: RestoreAncOnExit: FE DC BA C0 FF 00 06 00 17 03 02 00 00 EF',
    ])
  })

  it('shows only the preflight when ANC before is unknown', () => {
    const lines = formatConditionalFrames('b', { ancBefore: null, eqBefore: null, eqFormat: EqTlvFormat.SixByte })
    expect(lines).toEqual(['# first: PreflightReadAnc: FE DC BA C0 FF 00 04 00 FE 01 17 EF'])
  })
})
