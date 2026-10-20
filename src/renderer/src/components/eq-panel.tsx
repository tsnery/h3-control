import { useHeadsetSnapshot } from '../api/headset-queries'
import { COPY } from '../copy/pt-br'
import { CUSTOM_EQ_FREQUENCIES_HZ } from '../../../shared/headset-types'
import { EqSlider } from './eq-slider'
import { errorText } from './error-text'
import { useEqApply } from './use-eq-apply'
import { CUSTOM_SELECTION, PRESET_IDS, useEqDraft } from './use-eq-draft'

export function EqPanel() {
  const snapshot = useHeadsetSnapshot()
  const { selection, gainsDb, selectProfile, moveBand, restore: restoreDraft } = useEqDraft(snapshot.eq)
  const { apply, retry, restore, pending, error } = useEqApply(
    snapshot.eq,
    selection,
    gainsDb,
    restoreDraft,
  )
  const disabled = snapshot.status !== 'connected' || snapshot.readOnly !== null

  return (
    <section aria-labelledby="eq-title" className="eq-panel">
      <h2 id="eq-title">{COPY.eq.title}</h2>
      <label htmlFor="eq-preset">{COPY.eq.presetLabel}</label>
      <select
        id="eq-preset"
        value={selection === null ? '' : String(selection)}
        disabled={disabled}
        onChange={selectProfile}
      >
        {selection === null ? (
          <option value="" disabled>
            {COPY.eq.chooseProfile}
          </option>
        ) : null}
        {PRESET_IDS.map((id) => (
          <option key={id} value={id}>
            {COPY.eq.presets[id]}
          </option>
        ))}
        <option value={CUSTOM_SELECTION}>{COPY.eq.custom}</option>
      </select>
      <fieldset className="eq-bands">
        <legend>{COPY.eq.bandsGroup}</legend>
        {CUSTOM_EQ_FREQUENCIES_HZ.map((frequencyHz, band) => (
          <EqSlider
            key={frequencyHz}
            frequencyHz={frequencyHz}
            gainDb={gainsDb[band] ?? 0}
            disabled={disabled}
            onChange={(gain) => moveBand(band, gain)}
          />
        ))}
      </fieldset>
      <div className="eq-actions">
        <button
          type="button"
          className="button-primary"
          disabled={disabled || pending || selection === null}
          onClick={apply}
        >
          {COPY.eq.apply}
        </button>
        <button type="button" disabled={disabled} onClick={restore}>
          {COPY.eq.restore}
        </button>
      </div>
      {error ? (
        <div role="alert">
          <p>{errorText(error)}</p>
          <button type="button" disabled={disabled} onClick={retry}>
            {COPY.retry}
          </button>
        </div>
      ) : null}
    </section>
  )
}
