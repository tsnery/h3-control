import { describe, expect, it } from 'vitest'
import {
  type AncLevel,
  type AncSetting,
  DEFAULT_NOISE_CANCELLING,
} from '../../shared/headset-types'
import { decodeAncSetting, encodeAncSetting } from './anc'

const leveled = (scene: 'noisy' | 'commuting' | 'indoor', level: AncLevel): AncSetting => ({
  mode: 'noise-cancelling',
  scene,
  level,
})

const CASES: readonly (readonly [string, AncSetting, number[]])[] = [
  ['off', { mode: 'off' }, [0x17, 3, 2, 0, 0]],
  ['transparency', { mode: 'transparency' }, [0x17, 3, 3, 1, 4]],
  ['adaptive', { mode: 'noise-cancelling', scene: 'adaptive', level: null }, [0x17, 3, 1, 5, 0]],
  ['noisy low', leveled('noisy', 'low'), [0x17, 3, 1, 1, 0]],
  ['noisy medium', leveled('noisy', 'medium'), [0x17, 3, 1, 1, 1]],
  ['noisy high', leveled('noisy', 'high'), [0x17, 3, 1, 1, 2]],
  ['commuting low', leveled('commuting', 'low'), [0x17, 3, 1, 2, 0]],
  ['commuting medium', leveled('commuting', 'medium'), [0x17, 3, 1, 2, 1]],
  ['commuting high', leveled('commuting', 'high'), [0x17, 3, 1, 2, 2]],
  ['indoor low', leveled('indoor', 'low'), [0x17, 3, 1, 3, 0]],
  ['indoor medium', leveled('indoor', 'medium'), [0x17, 3, 1, 3, 1]],
  ['indoor high', leveled('indoor', 'high'), [0x17, 3, 1, 3, 2]],
  ['anti-wind', { mode: 'noise-cancelling', scene: 'anti-wind', level: null }, [0x17, 3, 1, 4, 0]],
]

describe('encodeAncSetting', () => {
  it.each(CASES)('encodes %s', (_label, setting, bytes) => {
    expect(encodeAncSetting(setting)).toEqual(Uint8Array.from(bytes))
  })

  it('defaults noise cancelling to noisy at high level', () => {
    expect(DEFAULT_NOISE_CANCELLING).toEqual(leveled('noisy', 'high'))
  })

  it('throws when a leveled scene has no level', () => {
    expect(() =>
      encodeAncSetting({ mode: 'noise-cancelling', scene: 'noisy', level: null }),
    ).toThrow(RangeError)
  })
})

describe('decodeAncSetting', () => {
  it.each(CASES)('decodes %s', (_label, setting, bytes) => {
    expect(decodeAncSetting(Uint8Array.from(bytes.slice(2)))).toEqual(setting)
  })

  it('returns null for unknown combinations', () => {
    expect(decodeAncSetting(Uint8Array.of(9, 9, 9))).toBeNull()
    expect(decodeAncSetting(Uint8Array.of(1, 1, 7))).toBeNull()
    expect(decodeAncSetting(Uint8Array.of(1))).toBeNull()
  })
})
