import { EqTlvFormat } from '../src/main/h3/eq'
import { h3Commands } from '../src/main/h3/h3-commands'
import { eqFormatForFirmware } from '../src/main/h3/h3-model'
import { RcspTimeoutError, createRcspClient } from '../src/main/rcsp/rcsp-client'
import type { ConnectedLink, HeadsetTransport } from '../src/main/transport/headset-transport'
import { type ProbeContext, type ProbeStage, type ProbeStep, buildProbePlan, toHex } from './probe-plan'
import {
  type ProbeRecord,
  type PushRecord,
  type StepRecord,
  contextFromStageA,
  decodeAncFromStep,
  eqFormatFromStageA,
} from './probe-record'

const CONNECT_TIMEOUT_MS = 30_000
const NO_RESENDS = 0
const TIMEOUT_PREFIX = 'timeout'
const TRANSPARENCY_LABEL = 'SetAncTransparency'
const RESTORE_LABEL = 'RestoreAnc'
const RESTORE_ON_EXIT_LABEL = 'RestoreAncOnExit'
const EQ_NO_STAGE_A_NOTE = '# no stage a record found: stage eq only reads the EQ'
const ANC_UNKNOWN_NOTE = '# ANC setting could not be read: stage b only reads and changes nothing'

export type RunProbeOptions = {
  transport: HeadsetTransport
  stage: ProbeStage
  pauseMs: number
  eqFormat: EqTlvFormat | null
  interrupt: AbortSignal
  loadStageA: () => Promise<ProbeRecord | null>
  save: (record: ProbeRecord) => Promise<void>
  log: (line: string) => void
  requestTimeoutMs?: number
}

type CommandStep = Extract<ProbeStep, { command: unknown }>
type PauseStep = Extract<ProbeStep, { pause: string }>

type Session = {
  record: ProbeRecord
  runCommand(step: CommandStep): Promise<StepRecord>
  runPause(step: PauseStep, pauseMs: number): Promise<StepRecord>
  close(): Promise<void>
}

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error))

function sleepUnlessInterrupted(ms: number, interrupt: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (interrupt.aborted) {
      resolve()
      return
    }
    const finish = (): void => {
      clearTimeout(timer)
      interrupt.removeEventListener('abort', finish)
      resolve()
    }
    const timer = setTimeout(finish, ms)
    interrupt.addEventListener('abort', finish, { once: true })
  })
}

function createSession(
  link: ConnectedLink,
  options: RunProbeOptions,
  startedAt: Date,
): Session {
  const { log, interrupt } = options
  const record: ProbeRecord = {
    startedAt: startedAt.toISOString(),
    deviceId: link.deviceId,
    deviceName: link.deviceName,
    steps: [],
    pushes: [],
    fatalError: null,
  }
  let activeChunks: string[] | null = null
  let activeTx: string[] | null = null
  let lastChunkHex = ''
  link.onNotification((chunk) => {
    lastChunkHex = toHex(chunk)
  })
  const tappedLink: ConnectedLink = {
    ...link,
    write: async (frame) => {
      activeTx?.push(toHex(frame))
      await link.write(frame)
    },
  }
  const client = createRcspClient(tappedLink, {
    maxResends: NO_RESENDS,
    ...(options.requestTimeoutMs === undefined ? {} : { timeoutMs: options.requestTimeoutMs }),
  })
  link.onNotification((chunk) => activeChunks?.push(toHex(chunk)))
  client.onPush((frame) => {
    const push: PushRecord = {
      atMs: Date.now() - startedAt.getTime(),
      opcode: frame.opcode,
      sn: frame.sn,
      payloadHex: toHex(frame.payload),
      rawHex: lastChunkHex,
    }
    record.pushes.push(push)
    log(`push: opcode ${frame.opcode} payload ${push.payloadHex}`)
  })

  const finish = (entry: StepRecord): StepRecord => {
    record.steps.push(entry)
    log(`${entry.label}: ${entry.error ?? entry.rxFrames.map((frame) => frame.payloadHex).join(' | ')}`)
    return entry
  }

  const runCommand: Session['runCommand'] = async ({ label, command }) => {
    const chunks: string[] = []
    const sent: string[] = []
    activeChunks = chunks
    activeTx = sent
    const startedMs = Date.now()
    const entry: StepRecord = { label, txHex: '', rxChunksHex: chunks, rxFrames: [], elapsedMs: 0, error: null }
    try {
      const response = await client.request(command)
      entry.rxFrames.push({
        kind: 'response',
        opcode: response.opcode,
        sn: response.sn,
        status: response.status,
        payloadHex: toHex(response.payload),
      })
    } catch (error) {
      const prefix = error instanceof RcspTimeoutError ? `${TIMEOUT_PREFIX}: ` : ''
      entry.error = `${prefix}${errorMessage(error)}`
    } finally {
      activeChunks = null
      activeTx = null
      entry.txHex = sent.join(' | ')
      entry.elapsedMs = Date.now() - startedMs
    }
    return finish(entry)
  }

  const runPause: Session['runPause'] = async ({ label, pause }, pauseMs) => {
    log(`${label}: ${pause} (waiting ${pauseMs} ms)`)
    const startedMs = Date.now()
    await sleepUnlessInterrupted(pauseMs, interrupt)
    return finish({ label, txHex: '', rxChunksHex: [], rxFrames: [], elapsedMs: Date.now() - startedMs, error: null })
  }

  const close = async (): Promise<void> => {
    client.close()
    await link.disconnect()
  }

  return { record, runCommand, runPause, close }
}

const isTimeout = (entry: StepRecord): boolean => entry.error?.startsWith(TIMEOUT_PREFIX) === true

async function runGetTargetInfoWithFallback(session: Session): Promise<void> {
  const first = await session.runCommand({ label: 'GetTargetInfo', command: h3Commands.getTargetInfo() })
  if (!isTimeout(first)) return
  await session.runCommand({ label: 'NotifyCommunicationWayBle', command: h3Commands.notifyCommunicationWayBle() })
  await session.runCommand({ label: 'GetTargetInfoRetry', command: h3Commands.getTargetInfo() })
}

type AncGuard = { transparencySent: boolean; restoreAttempted: boolean }

async function executePlan(
  session: Session,
  plan: readonly ProbeStep[],
  options: RunProbeOptions,
  guard: AncGuard,
): Promise<void> {
  for (const step of plan) {
    if (options.interrupt.aborted) return
    if ('pause' in step) {
      await session.runPause(step, options.pauseMs)
      continue
    }
    if (step.label === 'GetTargetInfo') {
      await runGetTargetInfoWithFallback(session)
      continue
    }
    if (step.label === TRANSPARENCY_LABEL) guard.transparencySent = true
    if (step.label === RESTORE_LABEL) guard.restoreAttempted = true
    await session.runCommand(step)
  }
}

async function planEqStage(
  options: RunProbeOptions,
): Promise<{ plan: ProbeStep[]; ancBefore: ProbeContext['ancBefore'] }> {
  const stageA = await options.loadStageA()
  if (stageA === null) options.log(EQ_NO_STAGE_A_NOTE)
  const eqFormat = options.eqFormat ?? (stageA === null ? eqFormatForFirmware(null) : eqFormatFromStageA(stageA))
  const context: ProbeContext =
    stageA === null
      ? { ancBefore: null, eqBefore: null, eqFormat }
      : contextFromStageA(stageA, eqFormat)
  return { plan: buildProbePlan('eq', context), ancBefore: null }
}

async function planForStage(
  session: Session,
  options: RunProbeOptions,
): Promise<{ plan: ProbeStep[]; ancBefore: ProbeContext['ancBefore'] }> {
  if (options.stage === 'a') {
    return { plan: buildProbePlan('a', { ancBefore: null, eqBefore: null, eqFormat: EqTlvFormat.SixByte }), ancBefore: null }
  }
  if (options.stage === 'eq') return planEqStage(options)
  const preflight = await session.runCommand({ label: 'PreflightReadAnc', command: h3Commands.readAnc() })
  const ancBefore = decodeAncFromStep(preflight)
  if (ancBefore === null) options.log(ANC_UNKNOWN_NOTE)
  const stageA = await options.loadStageA()
  const fromStageA = stageA === null ? null : contextFromStageA(stageA, options.eqFormat)
  const context: ProbeContext = {
    ancBefore,
    eqBefore: fromStageA?.eqBefore ?? null,
    eqFormat: options.eqFormat ?? fromStageA?.eqFormat ?? EqTlvFormat.SixByte,
  }
  return { plan: buildProbePlan('b', context), ancBefore }
}

async function restoreAncOnExit(session: Session, ancBefore: ProbeContext['ancBefore'], guard: AncGuard): Promise<void> {
  if (ancBefore === null || !guard.transparencySent || guard.restoreAttempted) return
  guard.restoreAttempted = true
  await session.runCommand({ label: RESTORE_ON_EXIT_LABEL, command: h3Commands.setAnc(ancBefore) })
}

export async function runProbe(options: RunProbeOptions): Promise<ProbeRecord> {
  const link = await options.transport.connect({
    preferredDeviceId: null,
    signal: AbortSignal.any([AbortSignal.timeout(CONNECT_TIMEOUT_MS), options.interrupt]),
  })
  const session = createSession(link, options, new Date())
  const guard: AncGuard = { transparencySent: false, restoreAttempted: false }
  let ancBefore: ProbeContext['ancBefore'] = null
  try {
    const planned = await planForStage(session, options)
    ancBefore = planned.ancBefore
    await executePlan(session, planned.plan, options, guard)
  } catch (error) {
    session.record.fatalError = errorMessage(error)
    options.log(session.record.fatalError)
  } finally {
    await restoreAncOnExit(session, ancBefore, guard)
    try {
      await options.save(session.record)
    } finally {
      await session.close()
    }
  }
  return session.record
}
