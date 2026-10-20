import { describe, expect, it, vi } from 'vitest'
import type { EqBand } from '../../shared/eq-presets'

vi.mock('../../shared/eq-presets', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../shared/eq-presets')>()
  const bands: EqBand[] = Array.from({ length: 11 }, (_, band) => ({
    frequencyHz: 100 + band,
    gainDb: 0,
    q: 1,
  }))
  return { ...original, EQ_PRESETS: [{ id: 1, name: 'Oversized', masterGainDb: -5.5, bands }] }
})

describe('encodeEqPreset with an oversized preset', () => {
  it('throws RangeError instead of truncating to ten bands', async () => {
    const { EqTlvFormat, encodeEqPreset } = await import('./eq')
    expect(() => encodeEqPreset(1, EqTlvFormat.SevenByte)).toThrow(RangeError)
  })
})
