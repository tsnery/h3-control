import { useApplyCustomEq, useApplyEqPreset } from '../api/headset-queries'
import type { EqState } from '../../../shared/headset-types'
import { CUSTOM_SELECTION, type EqSelection, sameGains } from './use-eq-draft'
import { useResetWhenApplied } from './use-reset-when-applied'

export function useEqApply(
  eq: EqState | null,
  selection: EqSelection | null,
  gainsDb: readonly number[],
  restoreDraft: () => void,
) {
  const preset = useApplyEqPreset()
  const custom = useApplyCustomEq()
  const presetApplied =
    preset.isError && eq?.kind === 'preset' && eq.presetId === preset.variables?.presetId
  const customApplied =
    custom.isError &&
    eq?.kind === 'custom' &&
    custom.variables !== undefined &&
    sameGains(eq.gainsDb, custom.variables.gainsDb)
  useResetWhenApplied(presetApplied, preset.reset)
  useResetWhenApplied(customApplied, custom.reset)

  function apply() {
    if (selection === null) return
    if (selection === CUSTOM_SELECTION) {
      preset.reset()
      custom.mutate({ gainsDb: [...gainsDb] })
      return
    }
    custom.reset()
    preset.mutate({ presetId: selection })
  }

  function retry() {
    if (preset.isError && preset.variables) preset.mutate(preset.variables)
    if (custom.isError && custom.variables) custom.mutate(custom.variables)
  }

  function restore() {
    preset.reset()
    custom.reset()
    restoreDraft()
  }

  return {
    apply,
    retry,
    restore,
    pending: preset.isPending || custom.isPending,
    error: preset.error ?? custom.error,
  }
}
