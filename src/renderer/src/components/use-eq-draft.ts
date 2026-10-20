import { type ChangeEvent, useState } from 'react'
import { presetGainsDb } from '../../../shared/eq-presets'
import {
  CUSTOM_EQ_BAND_COUNT,
  type EqPresetId,
  type EqState,
} from '../../../shared/headset-types'
import { clampGain } from './eq-slider'

export const CUSTOM_SELECTION = 'custom'
export type EqSelection = EqPresetId | typeof CUSTOM_SELECTION

interface EqDraft {
  selection: EqSelection
  gainsDb: readonly number[]
}

export const PRESET_IDS: readonly EqPresetId[] = [1, 2, 3, 4, 5, 6]

const SELECTION_BY_VALUE: Record<string, EqSelection> = {
  ...Object.fromEntries(PRESET_IDS.map((id) => [String(id), id])),
  [CUSTOM_SELECTION]: CUSTOM_SELECTION,
}

export function sameGains(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((gain, band) => gain === b[band])
}

function headsetGains(eq: EqState | null): readonly number[] {
  if (eq?.kind === 'preset') return presetGainsDb(eq.presetId)
  const reported = eq?.kind === 'custom' ? eq.gainsDb : []
  return Array.from({ length: CUSTOM_EQ_BAND_COUNT }, (_unused, band) => reported[band] ?? 0)
}

function gainsFor(selection: EqSelection, current: readonly number[]): readonly number[] {
  if (selection === CUSTOM_SELECTION) return current.map(clampGain)
  return presetGainsDb(selection)
}

function headsetSelection(eq: EqState | null): EqSelection | null {
  if (eq?.kind === 'preset') return eq.presetId
  if (eq?.kind === 'custom') return CUSTOM_SELECTION
  return null
}

function isReportedBy(eq: EqState | null, draft: EqDraft): boolean {
  if (eq?.kind === 'preset') return eq.presetId === draft.selection
  if (eq?.kind === 'custom') {
    return draft.selection === CUSTOM_SELECTION && sameGains(eq.gainsDb, draft.gainsDb)
  }
  return false
}

export function useEqDraft(eq: EqState | null) {
  const [draft, setDraft] = useState<EqDraft | null>(null)
  // Adjusting state during render drops the draft in the same pass the snapshot reports it, so no stale draft frame is painted.
  if (draft && isReportedBy(eq, draft)) setDraft(null)
  const pending = draft && !isReportedBy(eq, draft) ? draft : null
  const gainsDb = pending?.gainsDb ?? headsetGains(eq)
  const selection = pending?.selection ?? headsetSelection(eq)

  function selectProfile(event: ChangeEvent<HTMLSelectElement>) {
    const chosen = SELECTION_BY_VALUE[event.target.value]
    if (chosen !== undefined) setDraft({ selection: chosen, gainsDb: gainsFor(chosen, gainsDb) })
  }

  function moveBand(band: number, gain: number) {
    setDraft({
      selection: CUSTOM_SELECTION,
      gainsDb: gainsDb.map((current, index) => (index === band ? gain : clampGain(current))),
    })
  }

  return { selection, gainsDb, selectProfile, moveBand, restore: () => setDraft(null) }
}
