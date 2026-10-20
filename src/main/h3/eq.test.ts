import { describe, expect, it } from 'vitest'
import { CUSTOM_EQ_FREQUENCIES_HZ, type EqPresetId } from '../../shared/headset-types'
import { type EqBand, EQ_PRESETS } from '../../shared/eq-presets'
import {
  CUSTOM_EQ_INDEX,
  EqTlvFormat,
  FIRST_CUSTOM_EQ_INDEX,
  customMasterGainDb,
  decodeEqTlv,
  encodeCustomEq,
  encodeEqTlv,
  encodeEqPreset,
  toEqState,
} from './eq'

const hex = (bytes: Uint8Array) => [...bytes].map((byte) => byte.toString(16).padStart(2, '0'))

const BAND_COUNT = 10

const withTenBands = (leading: readonly EqBand[]): EqBand[] => [
  ...leading,
  ...Array.from({ length: BAND_COUNT - leading.length }, () => ({ frequencyHz: 1000, gainDb: 0, q: 0.7 })),
]

describe('encodeEqTlv', () => {
  it('encodes the Default preset as TLV 0x20 with ten bands', () => {
    const tlv = encodeEqPreset(1, EqTlvFormat.SixByte)
    expect(tlv.length).toBe(2 + BAND_COUNT * 6 + 3)
    expect(hex(tlv.slice(0, 11))).toEqual(
      ['20', '3f', '01', 'da', 'fd', '37', '00', 'fa', '00', '28', '00'],
    )
  })

  it('encodes TLV 0x22 with ten bands and filter type 2 per band', () => {
    const tlv = encodeEqPreset(1, EqTlvFormat.SevenByte)
    expect(tlv[0]).toBe(0x22)
    expect(tlv[1]).toBe(0x49)
    expect(tlv.length).toBe(2 + BAND_COUNT * 7 + 3)
    for (let band = 0; band < BAND_COUNT; band++) {
      expect(tlv[5 + band * 7 + 6]).toBe(2)
    }
  })

  it('throws RangeError for a format outside 0x20 and 0x22', () => {
    const invalid: number = 0x21
    expect(() => encodeEqTlv(invalid, 1, -5.5, withTenBands([]))).toThrow(RangeError)
  })

  it('encodes negative gains as signed little-endian centi-dB', () => {
    const tlv = encodeEqTlv(
      EqTlvFormat.SixByte,
      1,
      -5.5,
      withTenBands([{ frequencyHz: 220, gainDb: -11, q: 0.8 }]),
    )
    expect(hex(tlv.slice(5, 11))).toEqual(['dc', '00', 'b4', 'fb', '50', '00'])
  })

  describe.each([EqTlvFormat.SixByte, EqTlvFormat.SevenByte])('band count for format %s', (format) => {
    it.each([0, 7, 9, 11])('throws RangeError for %s bands so a short frame is never sent', (count) => {
      const bands = Array.from({ length: count }, () => ({ frequencyHz: 1000, gainDb: 0, q: 0.7 }))
      expect(() => encodeEqTlv(format, 1, -5.5, bands)).toThrow(RangeError)
    })
  })
})

describe('encodeEqPreset padding', () => {
  const presetIds = EQ_PRESETS.map((preset) => preset.id)

  it.each(presetIds)('encodes preset %s with ten bands as 22 49', (id) => {
    const tlv = encodeEqPreset(id, EqTlvFormat.SevenByte)
    expect(hex(tlv.slice(0, 2))).toEqual(['22', '49'])
  })

  it.each(presetIds)('keeps preset %s bands first and pads with flat bands', (id) => {
    const preset = EQ_PRESETS.find((candidate) => candidate.id === id)!
    const decoded = decodeEqTlv(EqTlvFormat.SevenByte, encodeEqPreset(id, EqTlvFormat.SevenByte).slice(2))
    expect(decoded?.bands.slice(0, preset.bands.length)).toEqual(preset.bands)
    for (const padding of decoded?.bands.slice(preset.bands.length) ?? []) {
      expect(padding.gainDb).toBe(0)
      expect(padding.q).toBe(0.7)
    }
  })

  it('pads Default with the layout frequencies it lacks, in layout order', () => {
    const decoded = decodeEqTlv(EqTlvFormat.SevenByte, encodeEqPreset(1, EqTlvFormat.SevenByte).slice(2))
    expect(decoded?.bands.map((band) => band.frequencyHz)).toEqual([
      55, 220, 500, 1800, 2800, 4500, 7500, 1000, 10000, 22000,
    ])
  })
})

describe('customMasterGainDb', () => {
  it('lowers master gain by the largest boost', () => {
    expect(customMasterGainDb([0, 3, -2, 1, 0, 0, 0, 0, 0, 0])).toBe(-8.5)
  })

  it('stays at -5.5 when nothing is boosted', () => {
    expect(customMasterGainDb([0, -3, -8, 0, 0, 0, 0, 0, 0, 0])).toBe(-5.5)
  })
})

describe('encodeCustomEq', () => {
  const flat = Array.from({ length: 10 }, () => 0)

  it('writes ten bands at the custom frequencies with the layout Q', () => {
    const tlv = encodeCustomEq([8, -8, 0, 0, 0, 0, 0, 0, 0, 0], EqTlvFormat.SixByte, false)
    expect(tlv[1]).toBe(63)
    expect(tlv[2]).toBe(CUSTOM_EQ_INDEX)
    expect(hex(tlv.slice(3, 5))).toEqual(['ba', 'fa'])
    expect(hex(tlv.slice(5, 11))).toEqual(['37', '00', '20', '03', '28', '00'])
  })

  it('uses index 0xFF on the first custom write', () => {
    expect(encodeCustomEq(flat, EqTlvFormat.SixByte, true)[2]).toBe(FIRST_CUSTOM_EQ_INDEX)
  })

  it.each([
    ['nine values', flat.slice(0, 9)],
    ['a value above the limit', [9, ...flat.slice(1)]],
    ['a value below the limit', [-9, ...flat.slice(1)]],
    ['a fractional value', [2.5, ...flat.slice(1)]],
    ['NaN', [Number.NaN, ...flat.slice(1)]],
  ])('throws RangeError for %s', (_label, gains) => {
    expect(() => encodeCustomEq(gains, EqTlvFormat.SixByte, false)).toThrow(RangeError)
  })
})

describe('decodeEqTlv', () => {
  const tenBands = withTenBands([
    { frequencyHz: 55, gainDb: 2.5, q: 0.4 },
    { frequencyHz: 220, gainDb: -11, q: 0.8 },
  ])

  it.each([EqTlvFormat.SixByte, EqTlvFormat.SevenByte])('inverts encodeEqTlv for format %s', (format) => {
    const tlv = encodeEqTlv(format, 3, -5.5, tenBands)
    expect(decodeEqTlv(format, tlv.slice(2))).toEqual({ index: 3, masterGainDb: -5.5, bands: tenBands })
  })

  it('returns null when the length does not fit whole bands', () => {
    expect(decodeEqTlv(EqTlvFormat.SixByte, Uint8Array.of(1, 0, 0, 1, 2, 3, 4))).toBeNull()
  })

  it('returns null for data shorter than the header', () => {
    expect(decodeEqTlv(EqTlvFormat.SixByte, Uint8Array.of(1, 0))).toBeNull()
  })
})

describe('toEqState', () => {
  const customBands = (gains: readonly number[]): EqBand[] =>
    CUSTOM_EQ_FREQUENCIES_HZ.map((frequencyHz, band) => ({
      frequencyHz,
      gainDb: gains[band] ?? 0,
      q: 1,
    }))

  it.each([1, 2, 3, 4, 5, 6] as const)('maps index %s to that preset', (presetId: EqPresetId) => {
    expect(toEqState({ index: presetId, masterGainDb: -5.5, bands: [] })).toEqual({
      kind: 'preset',
      presetId,
    })
  })

  it.each([CUSTOM_EQ_INDEX, FIRST_CUSTOM_EQ_INDEX])('maps index 0x%s with custom frequencies to custom', (index) => {
    const gains = [1, -2, 3, 0, 0, 0, 0, 0, 8, -8]
    expect(toEqState({ index, masterGainDb: -8.5, bands: customBands(gains) })).toEqual({
      kind: 'custom',
      gainsDb: gains,
    })
  })

  it('rounds custom gains to integers', () => {
    const state = toEqState({
      index: CUSTOM_EQ_INDEX,
      masterGainDb: -5.5,
      bands: customBands([1.4, -1.6, 0, 0, 0, 0, 0, 0, 0, 0]),
    })
    expect(state).toEqual({ kind: 'custom', gainsDb: [1, -2, 0, 0, 0, 0, 0, 0, 0, 0] })
  })

  it('returns unknown for a custom index with other frequencies', () => {
    expect(
      toEqState({ index: CUSTOM_EQ_INDEX, masterGainDb: -5.5, bands: [{ frequencyHz: 30, gainDb: 0, q: 1 }] }),
    ).toEqual({ kind: 'unknown' })
  })

  it('returns unknown for other indices', () => {
    expect(toEqState({ index: 0x90, masterGainDb: 0, bands: [] })).toEqual({ kind: 'unknown' })
    expect(toEqState({ index: 0, masterGainDb: 0, bands: [] })).toEqual({ kind: 'unknown' })
  })
})
