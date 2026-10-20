import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { EqTlvFormat } from '../src/main/h3/eq'
import { eqFormatForFirmware } from '../src/main/h3/h3-model'
import { createWebBluetoothTransport } from '../src/main/transport/web-bluetooth-transport'
import { runProbe } from './probe-run'
import {
  type ProbeContext,
  type ProbeStage,
  buildProbePlan,
  formatConditionalFrames,
  formatDryRun,
} from './probe-plan'
import {
  type ProbeRecord,
  ProbeRecordSchema,
  contextFromStageA,
  eqFormatFromStageA,
} from './probe-record'

const OUTPUT_DIR = 'probe-output'
const DEFAULT_PAUSE_MS = 20_000
const STAGE_A_FILE_PATTERN = /^a-.*\.json$/
const FAILURE_EXIT_CODE = 1
const DEFAULT_CONTEXT: ProbeContext = {
  ancBefore: { mode: 'off' },
  eqBefore: null,
  eqFormat: EqTlvFormat.SixByte,
}
const EQ_FORMAT_FLAGS: Record<string, EqTlvFormat> = {
  '20': EqTlvFormat.SixByte,
  '22': EqTlvFormat.SevenByte,
}

const PNPM_SEPARATOR = '--'
const USAGE = 'Usage: pnpm probe -- --stage a|b|eq [--dry-run] [--pause-ms <n>] [--eq-format 20|22]'

type CliOptions = { stage: ProbeStage; dryRun: boolean; pauseMs: number; eqFormat: EqTlvFormat | null }

function parseCli(): CliOptions {
  const args = process.argv.slice(2).filter((arg) => arg !== PNPM_SEPARATOR)
  const { values } = parseArgs({
    args,
    options: {
      stage: { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
      'pause-ms': { type: 'string' },
      'eq-format': { type: 'string' },
    },
  })
  const { stage } = values
  if (stage !== 'a' && stage !== 'b' && stage !== 'eq') throw new Error(USAGE)
  const pauseMs = values['pause-ms'] === undefined ? DEFAULT_PAUSE_MS : Number(values['pause-ms'])
  if (!Number.isFinite(pauseMs) || pauseMs < 0) throw new Error(USAGE)
  const eqFlag = values['eq-format']
  const eqFormat = eqFlag === undefined ? null : (EQ_FORMAT_FLAGS[eqFlag] ?? null)
  if (eqFlag !== undefined && eqFormat === null) throw new Error(USAGE)
  return { stage, dryRun: values['dry-run'], pauseMs, eqFormat }
}

async function loadLatestStageA(): Promise<ProbeRecord | null> {
  const names = await readdir(OUTPUT_DIR).catch(() => [])
  const latest = names.filter((name) => STAGE_A_FILE_PATTERN.test(name)).sort().at(-1)
  if (latest === undefined) return null
  const parsed = ProbeRecordSchema.safeParse(JSON.parse(await readFile(join(OUTPUT_DIR, latest), 'utf8')))
  return parsed.success ? parsed.data : null
}

async function resolveDryRunContext(
  stage: ProbeStage,
  eqFormat: EqTlvFormat | null,
): Promise<{ context: ProbeContext; note: string }> {
  const record = await loadLatestStageA()
  if (record === null) {
    const defaultFormat = stage === 'eq' ? eqFormatForFirmware(null) : DEFAULT_CONTEXT.eqFormat
    const context = { ...DEFAULT_CONTEXT, eqFormat: eqFormat ?? defaultFormat }
    return { context, note: 'no probe-output/a-*.json found: using ANC off, no EQ rewrite, default EQ format' }
  }
  const format = stage === 'eq' ? (eqFormat ?? eqFormatFromStageA(record)) : eqFormat
  return { context: contextFromStageA(record, format), note: 'context decoded from the latest probe-output/a-*.json' }
}

async function runDryRun(options: CliOptions): Promise<void> {
  if (options.stage === 'a') {
    formatDryRun(buildProbePlan('a', DEFAULT_CONTEXT)).forEach((line) => console.log(line))
    formatConditionalFrames('a', DEFAULT_CONTEXT).forEach((line) => console.log(line))
    return
  }
  const { context, note } = await resolveDryRunContext(options.stage, options.eqFormat)
  console.log(`# ${note}`)
  if (options.stage === 'b' && context.ancBefore === null) {
    console.log('# ANC setting unknown in the stage a record: stage b only reads')
  }
  formatDryRun(buildProbePlan(options.stage, context)).forEach((line) => console.log(line))
  formatConditionalFrames(options.stage, context).forEach((line) => console.log(line))
}

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error))

async function saveRecord(stage: ProbeStage, record: ProbeRecord): Promise<void> {
  await mkdir(OUTPUT_DIR, { recursive: true })
  const stamp = record.startedAt.replaceAll(':', '-')
  const path = join(OUTPUT_DIR, `${stage}-${stamp}.json`)
  await writeFile(path, JSON.stringify(record, null, 2))
  console.log(`saved ${path}`)
}

async function runLive(options: CliOptions): Promise<void> {
  const interrupt = new AbortController()
  process.once('SIGINT', () => interrupt.abort())
  const record = await runProbe({
    transport: createWebBluetoothTransport(),
    stage: options.stage,
    pauseMs: options.pauseMs,
    eqFormat: options.eqFormat,
    interrupt: interrupt.signal,
    loadStageA: loadLatestStageA,
    save: (probeRecord) => saveRecord(options.stage, probeRecord),
    log: (line) => console.log(line),
  })
  if (record.fatalError !== null) process.exitCode = FAILURE_EXIT_CODE
}

async function main(): Promise<void> {
  const options = parseCli()
  if (options.dryRun) return runDryRun(options)
  await runLive(options)
}

main()
  .catch((error: unknown) => {
    console.error(errorMessage(error))
    process.exitCode = FAILURE_EXIT_CODE
  })
  .finally(() => process.exit())
