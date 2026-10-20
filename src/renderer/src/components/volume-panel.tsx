import { useVolume } from '../api/headset-queries'
import { MAX_VOLUME_PERCENT, MIN_VOLUME_PERCENT } from '../../../shared/volume-types'
import { COPY } from '../copy/pt-br'
import { errorText } from './error-text'
import { useVolumeSlider } from './use-volume-slider'

interface VolumeSliderProps {
  reportedPercent: number
}

function VolumeSlider({ reportedPercent }: VolumeSliderProps) {
  const slider = useVolumeSlider(reportedPercent)
  const text = COPY.volume.percent(slider.percent)

  return (
    <>
      <label>
        {COPY.volume.title}
        <input
          type="range"
          min={MIN_VOLUME_PERCENT}
          max={MAX_VOLUME_PERCENT}
          step={1}
          value={slider.percent}
          aria-valuetext={text}
          onChange={slider.onChange}
        />
      </label>
      <output aria-live="off">{text}</output>
      {slider.error ? (
        <div role="alert">
          <p>{errorText(slider.error)}</p>
          <button type="button" onClick={slider.retry}>
            {COPY.retry}
          </button>
        </div>
      ) : null}
    </>
  )
}

export function VolumePanel() {
  const reading = useVolume()

  return (
    <section aria-label={COPY.volume.title} className="volume-panel">
      {reading ? <VolumeSlider reportedPercent={reading.percent} /> : null}
      <p role="status">{reading ? '' : COPY.errors['output-unavailable']}</p>
    </section>
  )
}
