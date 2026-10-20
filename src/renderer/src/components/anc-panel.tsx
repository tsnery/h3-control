import { useHeadsetSnapshot, useSetAnc } from '../api/headset-queries'
import { COPY } from '../copy/pt-br'
import {
  ANC_LEVELLESS_SCENES,
  type AncLevel,
  type AncScene,
  type AncSetting,
  DEFAULT_NOISE_CANCELLING,
} from '../../../shared/headset-types'
import { errorText } from './error-text'
import { useResetWhenApplied } from './use-reset-when-applied'

type AncMode = AncSetting['mode']
type NoiseCancelling = Extract<AncSetting, { mode: 'noise-cancelling' }>

const MODES: readonly AncMode[] = ['off', 'transparency', 'noise-cancelling']
const SCENES: readonly AncScene[] = ['adaptive', 'noisy', 'commuting', 'indoor', 'anti-wind']
const LEVELS: readonly AncLevel[] = ['low', 'medium', 'high']
const FALLBACK_LEVEL: AncLevel = 'high'

const MODE_SETTINGS: Record<AncMode, AncSetting> = {
  off: { mode: 'off' },
  transparency: { mode: 'transparency' },
  'noise-cancelling': DEFAULT_NOISE_CANCELLING,
}

function noiseCancellingOf(anc: AncSetting | null): NoiseCancelling | null {
  return anc?.mode === 'noise-cancelling' ? anc : null
}

function settingForScene(anc: AncSetting | null, scene: AncScene): AncSetting {
  if (ANC_LEVELLESS_SCENES.has(scene)) return { mode: 'noise-cancelling', scene, level: null }
  const level = noiseCancellingOf(anc)?.level ?? FALLBACK_LEVEL
  return { mode: 'noise-cancelling', scene, level }
}

function settingForLevel(current: NoiseCancelling, level: AncLevel): AncSetting {
  return { ...current, level }
}

function isSameSetting(a: AncSetting | null, b: AncSetting | undefined): boolean {
  if (!a || !b) return false
  if (a.mode !== 'noise-cancelling' || b.mode !== 'noise-cancelling') return a.mode === b.mode
  return a.scene === b.scene && a.level === b.level
}

interface AncRadioProps {
  group: string
  label: string
  checked: boolean
  disabled: boolean
  onSelect: () => void
}

function AncRadio({ group, label, checked, disabled, onSelect }: AncRadioProps) {
  return (
    <label className="option">
      <input type="radio" name={group} checked={checked} disabled={disabled} onChange={onSelect} />
      {label}
    </label>
  )
}

export function AncPanel() {
  const snapshot = useHeadsetSnapshot()
  const mutation = useSetAnc()
  const { mutate, error, variables } = mutation
  useResetWhenApplied(mutation.isError && isSameSetting(snapshot.anc, variables), mutation.reset)
  const disabled = snapshot.status !== 'connected' || snapshot.readOnly !== null
  const noiseCancelling = noiseCancellingOf(snapshot.anc)
  const levelled = noiseCancelling !== null && noiseCancelling.level !== null

  return (
    <section aria-label={COPY.anc.modeGroup} className="anc-panel">
      <fieldset className="choice-group choice-group--modes">
        <legend>{COPY.anc.modeGroup}</legend>
        {MODES.map((mode) => (
          <AncRadio
            key={mode}
            group="anc-mode"
            label={COPY.anc.modes[mode]}
            checked={snapshot.anc?.mode === mode}
            disabled={disabled}
            onSelect={() => mutate(MODE_SETTINGS[mode])}
          />
        ))}
      </fieldset>
      {noiseCancelling ? (
        <fieldset className="choice-group choice-group--row">
          <legend>{COPY.anc.sceneGroup}</legend>
          {SCENES.map((scene) => (
            <AncRadio
              key={scene}
              group="anc-scene"
              label={COPY.anc.scenes[scene]}
              checked={noiseCancelling.scene === scene}
              disabled={disabled}
              onSelect={() => mutate(settingForScene(snapshot.anc, scene))}
            />
          ))}
        </fieldset>
      ) : null}
      {levelled ? (
        <fieldset className="choice-group choice-group--row">
          <legend>{COPY.anc.levelGroup}</legend>
          {LEVELS.map((level) => (
            <AncRadio
              key={level}
              group="anc-level"
              label={COPY.anc.levels[level]}
              checked={noiseCancelling.level === level}
              disabled={disabled}
              onSelect={() => mutate(settingForLevel(noiseCancelling, level))}
            />
          ))}
        </fieldset>
      ) : null}
      {error && variables ? (
        <div role="alert">
          <p>{errorText(error)}</p>
          <button type="button" disabled={disabled} onClick={() => mutate(variables)}>
            {COPY.retry}
          </button>
        </div>
      ) : null}
    </section>
  )
}
