import { useId } from 'react'
import { EQ_GAIN_LIMIT_DB } from '../../../shared/headset-types'

const HZ_PER_KHZ = 1000
const MINUS_SIGN = '−'
const PT_BR = 'pt-BR'

export function clampGain(db: number): number {
  return Math.min(EQ_GAIN_LIMIT_DB, Math.max(-EQ_GAIN_LIMIT_DB, Math.round(db)))
}

export function formatFrequency(hz: number): string {
  if (hz < HZ_PER_KHZ) return `${hz} Hz`
  return `${(hz / HZ_PER_KHZ).toLocaleString(PT_BR)} kHz`
}

export function formatGain(db: number): string {
  if (db > 0) return `+${db.toLocaleString(PT_BR)} dB`
  if (db < 0) return `${MINUS_SIGN}${Math.abs(db).toLocaleString(PT_BR)} dB`
  return '0 dB'
}

interface EqSliderProps {
  frequencyHz: number
  gainDb: number
  disabled: boolean
  onChange: (gainDb: number) => void
}

export function EqSlider({ frequencyHz, gainDb, disabled, onChange }: EqSliderProps) {
  const id = useId()
  return (
    <div className="eq-band">
      <span aria-hidden="true">{formatGain(gainDb)}</span>
      <input
        id={id}
        className="eq-slider"
        type="range"
        min={-EQ_GAIN_LIMIT_DB}
        max={EQ_GAIN_LIMIT_DB}
        step={1}
        aria-orientation="vertical"
        value={clampGain(gainDb)}
        disabled={disabled}
        aria-valuetext={formatGain(gainDb)}
        onChange={(event) => onChange(clampGain(event.target.valueAsNumber))}
      />
      <label htmlFor={id}>{formatFrequency(frequencyHz)}</label>
    </div>
  )
}
