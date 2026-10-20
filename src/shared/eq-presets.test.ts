import { describe, expect, it } from 'vitest'
import { CUSTOM_EQ_FREQUENCIES_HZ } from './headset-types'
import { CUSTOM_EQ_Q, EQ_PRESETS, presetGainsDb } from './eq-presets'

describe('EQ_PRESETS', () => {
  it('lists the six H3 presets in device id order', () => {
    expect(EQ_PRESETS.map((preset) => [preset.id, preset.name])).toEqual([
      [1, 'Default'],
      [2, 'Pop'],
      [3, 'Heavy Bass'],
      [4, 'Rock'],
      [5, 'Soft'],
      [6, 'Classic'],
    ])
  })

  it('keeps the Default curve the headset reports', () => {
    const preset = EQ_PRESETS[0]
    expect(preset?.masterGainDb).toBe(-5.5)
    expect(preset?.bands).toEqual([
      { frequencyHz: 55, gainDb: 2.5, q: 0.4 },
      { frequencyHz: 220, gainDb: -11, q: 0.8 },
      { frequencyHz: 500, gainDb: 1, q: 0.7 },
      { frequencyHz: 1800, gainDb: 2.5, q: 1.0 },
      { frequencyHz: 2800, gainDb: 3, q: 0.8 },
      { frequencyHz: 4500, gainDb: 2, q: 1.3 },
      { frequencyHz: 7500, gainDb: 2.5, q: 1.2 },
    ])
  })

  it('keeps each preset band list unpadded', () => {
    expect(EQ_PRESETS.map((preset) => preset.bands.length)).toEqual([7, 7, 7, 8, 7, 7])
  })
})

describe('CUSTOM_EQ_Q', () => {
  it('has one Q per custom band', () => {
    expect(CUSTOM_EQ_Q).toEqual([0.4, 1.2, 1.5, 1.5, 1.2, 0.8, 1.2, 1.2, 1.2, 1.2])
  })
})

describe('presetGainsDb', () => {
  it('places each preset gain on its custom band and leaves absent bands flat', () => {
    expect(presetGainsDb(2)).toEqual([-3, -12, 1, -1, 2, 3.5, 0, 3, 0, 0])
  })

  it('returns one gain per custom band for every preset', () => {
    EQ_PRESETS.forEach((preset) =>
      expect(presetGainsDb(preset.id)).toHaveLength(CUSTOM_EQ_FREQUENCIES_HZ.length),
    )
  })
})
