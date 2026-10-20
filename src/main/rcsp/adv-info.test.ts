import { describe, expect, it } from 'vitest'
import { AdvType, decodeAdvInfo, decodeBattery, encodeAdvGetMask, encodeAdvSet } from './adv-info'

describe('encodeAdvSet', () => {
  it('writes length including the type, then type and value', () => {
    expect(encodeAdvSet(AdvType.Name, Uint8Array.of(0x41, 0x42))).toEqual(
      Uint8Array.of(3, AdvType.Name, 0x41, 0x42),
    )
  })
})

describe('encodeAdvGetMask', () => {
  it('sets one bit per requested type as u32 big-endian', () => {
    expect(encodeAdvGetMask([0, 5, 8, 10, 11])).toEqual(Uint8Array.of(0x00, 0x00, 0x0d, 0x21))
    expect(encodeAdvGetMask([1])).toEqual(Uint8Array.of(0x00, 0x00, 0x00, 0x02))
  })
})

describe('decodeAdvInfo', () => {
  it('maps each type to its value', () => {
    const info = decodeAdvInfo(Uint8Array.of(0x02, 0x00, 0x1e, 0x02, 0x05, 0x01))
    expect(info.get(0)).toEqual(Uint8Array.of(0x1e))
    expect(info.get(5)).toEqual(Uint8Array.of(0x01))
    expect(info.size).toBe(2)
  })

  it('keeps the LTVs decoded before a truncated one', () => {
    const info = decodeAdvInfo(Uint8Array.of(0x02, 0x00, 0x1e, 0x05, 0x05, 0x01))
    expect([...info.keys()]).toEqual([0])
  })

  it('stops at a zero-length LTV', () => {
    expect(decodeAdvInfo(Uint8Array.of(0x00, 0x02, 0x00, 0x1e)).size).toBe(0)
  })
})

describe('decodeBattery', () => {
  it('reads percent from the first byte', () => {
    expect(decodeBattery(Uint8Array.of(0x1e))).toEqual({ percent: 30, charging: false })
  })

  it('reads the charging flag from bit 7', () => {
    expect(decodeBattery(Uint8Array.of(0x9e))).toEqual({ percent: 30, charging: true })
  })

  it('ignores the right and case slots', () => {
    expect(decodeBattery(Uint8Array.of(0x1e, 0x00, 0x64))).toEqual({ percent: 30, charging: false })
  })

  it('returns null for zero percent', () => {
    expect(decodeBattery(Uint8Array.of(0x00))).toBeNull()
  })

  it('returns null above 100 percent', () => {
    expect(decodeBattery(Uint8Array.of(0x65))).toBeNull()
  })

  it('returns null for an empty value', () => {
    expect(decodeBattery(new Uint8Array())).toBeNull()
  })
})
