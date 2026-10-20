import { describe, expect, it } from 'vitest'
import { QCY_READ_PREFIX, decodeTlvs, encodeTlv, encodeTlvRead } from './qcy-tlv'

describe('encodeTlv', () => {
  it('prefixes data with command id and length', () => {
    expect(encodeTlv(0x22, Uint8Array.of(1, 2, 3))).toEqual(Uint8Array.of(0x22, 3, 1, 2, 3))
  })

  it('encodes an empty value with zero length', () => {
    expect(encodeTlv(0x17, new Uint8Array())).toEqual(Uint8Array.of(0x17, 0))
  })
})

describe('encodeTlvRead', () => {
  it('builds a read request for the command id', () => {
    expect(QCY_READ_PREFIX).toBe(0xfe)
    expect(encodeTlvRead(0x20)).toEqual(Uint8Array.of(0xfe, 0x01, 0x20))
  })
})

describe('decodeTlvs', () => {
  it('splits a read response into its TLV', () => {
    expect(decodeTlvs(Uint8Array.of(0x17, 0x03, 0x01, 0x05, 0x00))).toEqual([
      { cmdId: 0x17, data: Uint8Array.of(0x01, 0x05, 0x00) },
    ])
  })

  it('splits consecutive TLVs', () => {
    expect(decodeTlvs(Uint8Array.of(0x17, 0x01, 0xaa, 0x20, 0x00))).toEqual([
      { cmdId: 0x17, data: Uint8Array.of(0xaa) },
      { cmdId: 0x20, data: new Uint8Array() },
    ])
  })

  it('stops at a TLV whose length overruns the payload', () => {
    expect(decodeTlvs(Uint8Array.of(0x17, 0x01, 0xaa, 0x20, 0x05, 0x01))).toEqual([
      { cmdId: 0x17, data: Uint8Array.of(0xaa) },
    ])
  })

  it('stops at a dangling command id without length', () => {
    expect(decodeTlvs(Uint8Array.of(0x17))).toEqual([])
  })

  it('returns nothing for an empty payload', () => {
    expect(decodeTlvs(new Uint8Array())).toEqual([])
  })
})
