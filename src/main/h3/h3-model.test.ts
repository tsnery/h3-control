import { describe, expect, it } from 'vitest'
import { EqTlvFormat } from './eq'
import {
  COMMUNICATION_WAY_NOTICE_REQUIRED,
  EXPECTED_VENDOR_ID,
  SUPPORTED_PRODUCT_IDS,
  eqFormatForFirmware,
  isSupportedTarget,
} from './h3-model'

const OWNER_H3 = { firmwareVersion: '0.9.1.2', vendorId: 0x1c52, productId: 0x4173 }

describe('eqFormatForFirmware', () => {
  it.each(['0.9.0.0', '0.9.1.2', '0.10.0.0', '1.0.0.0', '12.0.0.0'])(
    'uses the 7-byte format from firmware %s',
    (firmware) => {
      expect(eqFormatForFirmware(firmware)).toBe(EqTlvFormat.SevenByte)
    },
  )

  it.each(['0.8.0.7999', '0.8.9.9', '0.1.2.3', '0.0.0.0'])(
    'uses the 6-byte format below 0.9.0.0 (%s)',
    (firmware) => {
      expect(eqFormatForFirmware(firmware)).toBe(EqTlvFormat.SixByte)
    },
  )

  it('compares parts numerically, not as text', () => {
    expect(eqFormatForFirmware('0.10.0.0')).toBe(EqTlvFormat.SevenByte)
  })

  it.each([null, '', 'abc', '0.9.x.1', '0..1'])(
    'falls back to the hardware-confirmed 7-byte format for %j',
    (firmware) => {
      expect(eqFormatForFirmware(firmware)).toBe(EqTlvFormat.SevenByte)
    },
  )
})

describe('COMMUNICATION_WAY_NOTICE_REQUIRED', () => {
  it('records that the real H3 answers GetTargetInfo without the 0B 00 00 notice', () => {
    expect(COMMUNICATION_WAY_NOTICE_REQUIRED).toBe(false)
  })
})

describe('isSupportedTarget', () => {
  it('accepts the ids the owner H3 reports in GetTargetInfo', () => {
    expect(isSupportedTarget(OWNER_H3)).toBe(true)
  })

  it('accepts both H3 product ids in scope (16755 and 16760)', () => {
    expect(SUPPORTED_PRODUCT_IDS).toEqual([16755, 16760])
    expect(isSupportedTarget({ ...OWNER_H3, productId: 16760 })).toBe(true)
  })

  it('pins the vendor id the real H3 reports, not the inferred Jieli 0x05D6', () => {
    expect(EXPECTED_VENDOR_ID).toBe(7250)
    expect(isSupportedTarget({ ...OWNER_H3, vendorId: 0x05d6 })).toBe(false)
  })

  it('rejects another product from the same vendor', () => {
    expect(isSupportedTarget({ ...OWNER_H3, productId: 0x4174 })).toBe(false)
  })

  it.each([
    ['vendor id', { ...OWNER_H3, vendorId: null }],
    ['product id', { ...OWNER_H3, productId: null }],
  ])('rejects target info without a %s', (_field, info) => {
    expect(isSupportedTarget(info)).toBe(false)
  })
})
