import {
  CUSTOM_EQ_BAND_COUNT,
  CUSTOM_EQ_FREQUENCIES_HZ,
  EQ_GAIN_LIMIT_DB,
  type EqPresetId,
  type EqState,
} from '../../shared/headset-types'
import { encodeTlv } from '../rcsp/qcy-tlv'
import { CUSTOM_EQ_Q, EQ_PRESETS, type EqBand } from '../../shared/eq-presets'

export enum EqTlvFormat {
  SixByte = 0x20,
  SevenByte = 0x22,
}

export function isEqTlvFormat(value: number): value is EqTlvFormat {
  return value === EqTlvFormat.SixByte || value === EqTlvFormat.SevenByte
}

export function assertEqTlvFormat(value: number): asserts value is EqTlvFormat {
  if (!isEqTlvFormat(value)) throw new RangeError(`Unsupported EQ TLV format ${value}`)
}

export const CUSTOM_EQ_INDEX = 0x80
export const FIRST_CUSTOM_EQ_INDEX = 0xff

export type DecodedEq = { index: number; masterGainDb: number; bands: EqBand[] }

const CUSTOM_BASE_MASTER_GAIN_DB = -5.5
const PEAKING_FILTER_TYPE = 2
const PADDING_BAND_Q = 0.7
const CENTI = 100
const HEADER_LENGTH = 3
const BAND_LENGTHS: Record<EqTlvFormat, number> = {
  [EqTlvFormat.SixByte]: 6,
  [EqTlvFormat.SevenByte]: 7,
}
const PRESET_INDEX_RANGE = { min: 1, max: 6 } as const

function toCenti(value: number): number {
  return Math.round(value * CENTI)
}

function encodeBand(format: EqTlvFormat, band: EqBand): number[] {
  const view = new DataView(new ArrayBuffer(BAND_LENGTHS[format]))
  view.setUint16(0, band.frequencyHz, true)
  view.setInt16(2, toCenti(band.gainDb), true)
  view.setUint16(4, toCenti(band.q), true)
  if (format === EqTlvFormat.SevenByte) view.setUint8(6, PEAKING_FILTER_TYPE)
  return [...new Uint8Array(view.buffer)]
}

export function encodeEqTlv(
  format: EqTlvFormat,
  index: number,
  masterGainDb: number,
  bands: readonly EqBand[],
): Uint8Array {
  assertEqTlvFormat(format)
  if (bands.length !== CUSTOM_EQ_BAND_COUNT) {
    throw new RangeError(`EQ TLV needs exactly ${CUSTOM_EQ_BAND_COUNT} bands, got ${bands.length}`)
  }
  const header = new DataView(new ArrayBuffer(HEADER_LENGTH))
  header.setUint8(0, index)
  header.setInt16(1, toCenti(masterGainDb), true)
  const value = Uint8Array.of(
    ...new Uint8Array(header.buffer),
    ...bands.flatMap((band) => encodeBand(format, band)),
  )
  return encodeTlv(format, value)
}

export function decodeEqTlv(format: EqTlvFormat, data: Uint8Array): DecodedEq | null {
  const bandLength = BAND_LENGTHS[format]
  const bandsLength = data.length - HEADER_LENGTH
  if (bandsLength < 0 || bandsLength % bandLength !== 0) return null
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const bands: EqBand[] = []
  for (let offset = HEADER_LENGTH; offset < data.length; offset += bandLength) {
    bands.push({
      frequencyHz: view.getUint16(offset, true),
      gainDb: view.getInt16(offset + 2, true) / CENTI,
      q: view.getUint16(offset + 4, true) / CENTI,
    })
  }
  return { index: view.getUint8(0), masterGainDb: view.getInt16(1, true) / CENTI, bands }
}

export function customMasterGainDb(gainsDb: readonly number[]): number {
  return CUSTOM_BASE_MASTER_GAIN_DB - Math.max(0, ...gainsDb)
}

function padToLayoutBands(bands: readonly EqBand[]): EqBand[] {
  const present = new Set(bands.map((band) => band.frequencyHz))
  const padding = CUSTOM_EQ_FREQUENCIES_HZ.filter((frequencyHz) => !present.has(frequencyHz)).map(
    (frequencyHz) => ({ frequencyHz, gainDb: 0, q: PADDING_BAND_Q }),
  )
  return [...bands, ...padding]
}

export function encodeEqPreset(id: EqPresetId, format: EqTlvFormat): Uint8Array {
  const preset = EQ_PRESETS.find((candidate) => candidate.id === id)
  if (preset === undefined) throw new RangeError(`Unknown EQ preset ${id}`)
  return encodeEqTlv(format, preset.id, preset.masterGainDb, padToLayoutBands(preset.bands))
}

function assertCustomGains(gainsDb: readonly number[]): void {
  if (gainsDb.length !== CUSTOM_EQ_BAND_COUNT) {
    throw new RangeError(`Custom EQ needs exactly ${CUSTOM_EQ_BAND_COUNT} gains`)
  }
  const invalid = gainsDb.some(
    (gain) => !Number.isInteger(gain) || Math.abs(gain) > EQ_GAIN_LIMIT_DB,
  )
  if (invalid) {
    throw new RangeError(`Custom EQ gains must be integers within ±${EQ_GAIN_LIMIT_DB} dB`)
  }
}

export function encodeCustomEq(
  gainsDb: readonly number[],
  format: EqTlvFormat,
  isFirstCustomWrite: boolean,
): Uint8Array {
  assertCustomGains(gainsDb)
  const bands = CUSTOM_EQ_FREQUENCIES_HZ.map((frequencyHz, band) => ({
    frequencyHz,
    gainDb: gainsDb[band] ?? 0,
    q: CUSTOM_EQ_Q[band] ?? 0,
  }))
  const index = isFirstCustomWrite ? FIRST_CUSTOM_EQ_INDEX : CUSTOM_EQ_INDEX
  return encodeEqTlv(format, index, customMasterGainDb(gainsDb), bands)
}

function isEqPresetId(index: number): index is EqPresetId {
  return Number.isInteger(index) && index >= PRESET_INDEX_RANGE.min && index <= PRESET_INDEX_RANGE.max
}

function hasCustomFrequencies(bands: readonly EqBand[]): boolean {
  return (
    bands.length === CUSTOM_EQ_FREQUENCIES_HZ.length &&
    bands.every((band, position) => band.frequencyHz === CUSTOM_EQ_FREQUENCIES_HZ[position])
  )
}

export function toEqState(decoded: DecodedEq): EqState {
  const { index, bands } = decoded
  if (isEqPresetId(index)) return { kind: 'preset', presetId: index }
  const isCustomIndex = index === CUSTOM_EQ_INDEX || index === FIRST_CUSTOM_EQ_INDEX
  if (!isCustomIndex || !hasCustomFrequencies(bands)) return { kind: 'unknown' }
  return { kind: 'custom', gainsDb: bands.map((band) => Math.round(band.gainDb)) }
}
