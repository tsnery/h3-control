import { CUSTOM_EQ_FREQUENCIES_HZ, type EqPresetId } from './headset-types'

export type EqBand = { frequencyHz: number; gainDb: number; q: number }
export type EqPreset = { id: EqPresetId; name: string; masterGainDb: number; bands: readonly EqBand[] }

type BandTuple = readonly [frequencyHz: number, gainDb: number, q: number]

function toBands(tuples: readonly BandTuple[]): EqBand[] {
  return tuples.map(([frequencyHz, gainDb, q]) => ({ frequencyHz, gainDb, q }))
}

export const EQ_PRESETS: readonly EqPreset[] = [
  {
    id: 1,
    name: 'Default',
    masterGainDb: -5.5,
    bands: toBands([
      [55, 2.5, 0.4],
      [220, -11, 0.8],
      [500, 1, 0.7],
      [1800, 2.5, 1.0],
      [2800, 3, 0.8],
      [4500, 2, 1.3],
      [7500, 2.5, 1.2],
    ]),
  },
  {
    id: 2,
    name: 'Pop',
    masterGainDb: -5.5,
    bands: toBands([
      [55, -3, 0.4],
      [220, -12, 1.2],
      [500, 1, 1.5],
      [1000, -1, 1.5],
      [1800, 2, 1.2],
      [2800, 3.5, 0.8],
      [7500, 3, 1.2],
    ]),
  },
  {
    id: 3,
    name: 'Heavy Bass',
    masterGainDb: -5,
    bands: toBands([
      [55, 6, 0.4],
      [220, -9, 1.2],
      [500, 1, 1.5],
      [1000, -1, 1.5],
      [1800, -3.5, 0.9],
      [2800, 0, 0.7],
      [7500, -4, 0.5],
    ]),
  },
  {
    id: 4,
    name: 'Rock',
    masterGainDb: -5.5,
    bands: toBands([
      [55, 5.5, 0.4],
      [220, -10, 0.7],
      [500, 0, 0.7],
      [1000, -1, 1.5],
      [1800, 1.5, 0.7],
      [2800, 4, 0.8],
      [4500, 3, 0.7],
      [7500, 3, 0.7],
    ]),
  },
  {
    id: 5,
    name: 'Soft',
    masterGainDb: -5.5,
    bands: toBands([
      [55, -1, 0.7],
      [220, -12, 1.2],
      [500, 1, 1.5],
      [1000, -1, 1.5],
      [1800, 2, 1.2],
      [2800, 2, 0.8],
      [7500, 2, 1.2],
    ]),
  },
  {
    id: 6,
    name: 'Classic',
    masterGainDb: -5.5,
    bands: toBands([
      [55, 4, 0.4],
      [220, -5, 1.5],
      [500, 1, 1.5],
      [1000, 2, 0.7],
      [1800, 2, 1.2],
      [2800, 2, 0.8],
      [7500, 3, 1.2],
    ]),
  },
]

export const CUSTOM_EQ_Q: readonly number[] = [0.4, 1.2, 1.5, 1.5, 1.2, 0.8, 1.2, 1.2, 1.2, 1.2]

export function presetGainsDb(id: EqPresetId): number[] {
  const preset = EQ_PRESETS.find((candidate) => candidate.id === id)
  const gainByFrequency = new Map(preset?.bands.map((band) => [band.frequencyHz, band.gainDb]))
  return CUSTOM_EQ_FREQUENCIES_HZ.map((frequencyHz) => gainByFrequency.get(frequencyHz) ?? 0)
}
