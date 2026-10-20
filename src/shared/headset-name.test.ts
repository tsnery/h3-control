import { describe, expect, it } from 'vitest'
import { utf8ByteLength, validateHeadsetName } from './headset-name'

const encode = (text: string) => new TextEncoder().encode(text)

describe('utf8ByteLength', () => {
  it.each([
    ['', 0],
    ['abc', 3],
    ['é', 2],
    ['🎧', 4],
  ])('counts %j as %i bytes', (text, bytes) => {
    expect(utf8ByteLength(text)).toBe(bytes)
  })
})

describe('validateHeadsetName', () => {
  it('trims surrounding whitespace and returns UTF-8 bytes', () => {
    expect(validateHeadsetName('  Meu H3  ')).toEqual({ ok: true, bytes: encode('Meu H3') })
  })

  it('rejects a blank name', () => {
    expect(validateHeadsetName('   ')).toEqual({ ok: false, reason: 'empty' })
  })

  it('accepts exactly 31 bytes', () => {
    expect(validateHeadsetName('a'.repeat(31)).ok).toBe(true)
  })

  it('rejects 32 bytes', () => {
    expect(validateHeadsetName('a'.repeat(32))).toEqual({ ok: false, reason: 'too-long' })
  })

  it('measures bytes, not characters', () => {
    const name = 'Fone 🎧🎧🎧🎧🎧🎧🎧'
    expect([...name].length).toBeLessThanOrEqual(31)
    expect(validateHeadsetName(name)).toEqual({ ok: false, reason: 'too-long' })
  })
})
