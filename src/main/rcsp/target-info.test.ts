import { describe, expect, it } from 'vitest'
import { decodeTargetInfo } from './target-info'

const FIRMWARE_LTV = [0x03, 0x05, 0x01, 0x23]
const IDS_LTV = [0x07, 0x0a, 0x05, 0xd6, 0x00, 0x0a, 0x00, 0x00]

describe('decodeTargetInfo', () => {
  it('extracts firmware version, vendor id and product id', () => {
    expect(decodeTargetInfo(Uint8Array.from([...FIRMWARE_LTV, ...IDS_LTV]))).toEqual({
      firmwareVersion: '0.1.2.3',
      vendorId: 0x05d6,
      productId: 0x000a,
    })
  })

  it('renders each firmware nibble high to low', () => {
    const info = decodeTargetInfo(Uint8Array.of(0x03, 0x05, 0xab, 0xcd))
    expect(info.firmwareVersion).toBe('10.11.12.13')
  })

  it('accepts ids without a uid', () => {
    const info = decodeTargetInfo(Uint8Array.of(0x05, 0x0a, 0x05, 0xd6, 0x00, 0x0a))
    expect(info).toMatchObject({ vendorId: 0x05d6, productId: 0x000a })
  })

  it('ignores unknown types', () => {
    const info = decodeTargetInfo(Uint8Array.from([0x03, 0x63, 0xff, 0xff, ...FIRMWARE_LTV]))
    expect(info.firmwareVersion).toBe('0.1.2.3')
  })

  it('returns null for absent fields', () => {
    expect(decodeTargetInfo(new Uint8Array())).toEqual({
      firmwareVersion: null,
      vendorId: null,
      productId: null,
    })
  })

  it('returns null for fields too short to decode', () => {
    const info = decodeTargetInfo(Uint8Array.of(0x02, 0x05, 0x01, 0x02, 0x0a, 0x05))
    expect(info).toEqual({ firmwareVersion: null, vendorId: null, productId: null })
  })
})
