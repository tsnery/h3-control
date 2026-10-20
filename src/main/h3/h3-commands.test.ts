import { describe, expect, it } from 'vitest'
import type { AncSetting, EqPresetId } from '../../shared/headset-types'
import { Opcode } from '../rcsp/opcode'
import { EqTlvFormat } from './eq'
import { type H3Command, h3Commands } from './h3-commands'

const ALLOWED_OPCODES: readonly number[] = [
  Opcode.GetTargetInfo,
  Opcode.NotifyCommunicationWay,
  Opcode.SetAdvInfo,
  Opcode.GetAdvInfo,
  Opcode.Custom,
]
const ALLOWED_ADV_SET_TYPES = [1, 7]
const ALLOWED_TLV_IDS = [0x17, 0x20, 0x22]
const QCY_READ_PREFIX = 0xfe

const FORMATS = [EqTlvFormat.SixByte, EqTlvFormat.SevenByte] as const
const PRESET_IDS: readonly EqPresetId[] = [1, 2, 3, 4, 5, 6]
const LEVELS = ['low', 'medium', 'high'] as const
const ANC_SETTINGS: AncSetting[] = [
  { mode: 'off' },
  { mode: 'transparency' },
  { mode: 'noise-cancelling', scene: 'adaptive', level: null },
  { mode: 'noise-cancelling', scene: 'anti-wind', level: null },
  ...(['noisy', 'commuting', 'indoor'] as const).flatMap((scene) =>
    LEVELS.map((level): AncSetting => ({ mode: 'noise-cancelling', scene, level })),
  ),
]
const EXTREME_GAINS = [
  Array.from({ length: 10 }, () => 8),
  Array.from({ length: 10 }, () => -8),
  Array.from({ length: 10 }, () => 0),
]

function everyCommand(): H3Command[] {
  return [
    h3Commands.getTargetInfo(),
    h3Commands.notifyCommunicationWayBle(),
    h3Commands.syncTime(new Date(0)),
    h3Commands.syncTime(new Date(1_760_000_000_000)),
    h3Commands.readBattery(),
    h3Commands.readName(),
    h3Commands.readAnc(),
    ...FORMATS.map((format) => h3Commands.readEq(format)),
    ...ANC_SETTINGS.map((setting) => h3Commands.setAnc(setting)),
    ...FORMATS.flatMap((format) => PRESET_IDS.map((id) => h3Commands.applyEqPreset(id, format))),
    ...FORMATS.flatMap((format) =>
      EXTREME_GAINS.flatMap((gains) => [
        h3Commands.applyCustomEq(gains, format, true),
        h3Commands.applyCustomEq(gains, format, false),
      ]),
    ),
    h3Commands.rename('H3'),
    h3Commands.rename('Fone 🎧'),
    h3Commands.rename('a'.repeat(31)),
  ]
}

describe('h3Commands', () => {
  it('exposes only the allowlisted builders', () => {
    expect(Object.keys(h3Commands).sort()).toEqual(
      [
        'applyCustomEq',
        'applyEqPreset',
        'getTargetInfo',
        'notifyCommunicationWayBle',
        'readAnc',
        'readBattery',
        'readEq',
        'readName',
        'rename',
        'setAnc',
        'syncTime',
      ].sort(),
    )
  })

  it('is frozen', () => {
    expect(Object.isFrozen(h3Commands)).toBe(true)
  })

  it('never builds a frame outside the allowlist', () => {
    for (const { opcode, payload } of everyCommand()) {
      expect(ALLOWED_OPCODES).toContain(opcode)
      if (opcode === Opcode.NotifyCommunicationWay) expect([...payload]).toEqual([0, 0])
      if (opcode === Opcode.SetAdvInfo) expect(ALLOWED_ADV_SET_TYPES).toContain(payload[1])
      if (opcode !== Opcode.Custom) continue
      expect([...ALLOWED_TLV_IDS, QCY_READ_PREFIX]).toContain(payload[0])
      if (payload[0] === QCY_READ_PREFIX) expect(ALLOWED_TLV_IDS).toContain(payload[2])
    }
  })

  describe('payload bytes', () => {
    it('builds GetTargetInfo', () => {
      expect(h3Commands.getTargetInfo()).toEqual({
        opcode: Opcode.GetTargetInfo,
        payload: Uint8Array.of(0xff, 0xff, 0xff, 0xff, 0x00),
      })
    })

    it('builds the BLE communication notice', () => {
      expect(h3Commands.notifyCommunicationWayBle()).toEqual({
        opcode: Opcode.NotifyCommunicationWay,
        payload: Uint8Array.of(0, 0),
      })
    })

    it('builds the battery read mask', () => {
      expect(h3Commands.readBattery()).toEqual({
        opcode: Opcode.GetAdvInfo,
        payload: Uint8Array.of(0x00, 0x00, 0x0d, 0x21),
      })
    })

    it('builds the name read mask', () => {
      expect(h3Commands.readName()).toEqual({
        opcode: Opcode.GetAdvInfo,
        payload: Uint8Array.of(0x00, 0x00, 0x00, 0x02),
      })
    })

    it('builds the ANC read', () => {
      expect(h3Commands.readAnc()).toEqual({
        opcode: Opcode.Custom,
        payload: Uint8Array.of(0xfe, 0x01, 0x17),
      })
    })

    it.each([
      [EqTlvFormat.SixByte, 0x20],
      [EqTlvFormat.SevenByte, 0x22],
    ])('builds the EQ read for format %s', (format, cmdId) => {
      expect(h3Commands.readEq(format)).toEqual({
        opcode: Opcode.Custom,
        payload: Uint8Array.of(0xfe, 0x01, cmdId),
      })
    })

    it('syncs time as big-endian unix seconds', () => {
      expect(h3Commands.syncTime(new Date(1_760_000_000_000))).toEqual({
        opcode: Opcode.SetAdvInfo,
        payload: Uint8Array.of(0x05, 0x07, 0x68, 0xe7, 0x78, 0x00),
      })
    })

    it('renames with the UTF-8 name', () => {
      expect(h3Commands.rename('H3')).toEqual({
        opcode: Opcode.SetAdvInfo,
        payload: Uint8Array.of(0x03, 0x01, 0x48, 0x33),
      })
    })

    it('sends ANC settings through the custom opcode', () => {
      expect(h3Commands.setAnc({ mode: 'off' })).toEqual({
        opcode: Opcode.Custom,
        payload: Uint8Array.of(0x17, 3, 2, 0, 0),
      })
    })

    it('sends presets and custom EQ through the custom opcode', () => {
      expect(h3Commands.applyEqPreset(1, EqTlvFormat.SixByte).opcode).toBe(Opcode.Custom)
      expect(h3Commands.applyCustomEq(EXTREME_GAINS[2]!, EqTlvFormat.SixByte, false).opcode).toBe(
        Opcode.Custom,
      )
    })
  })

  describe('payload isolation', () => {
    it.each([
      ['getTargetInfo', () => h3Commands.getTargetInfo()],
      ['notifyCommunicationWayBle', () => h3Commands.notifyCommunicationWayBle()],
    ])('returns a fresh payload from each %s call', (_name, build) => {
      const first = build()
      const original = [...first.payload]
      first.payload.fill(0x01)
      expect([...build().payload]).toEqual(original)
    })
  })

  describe('EQ format validation', () => {
    const INVALID_FORMATS: readonly number[] = [3, 0x21, 0]

    it.each(INVALID_FORMATS)('rejects format %s in every EQ builder', (format) => {
      expect(() => h3Commands.readEq(format)).toThrow(RangeError)
      expect(() => h3Commands.applyEqPreset(1, format)).toThrow(RangeError)
      expect(() => h3Commands.applyCustomEq(EXTREME_GAINS[2]!, format, false)).toThrow(RangeError)
    })
  })

  describe('rename validation', () => {
    it('throws RangeError for a blank name', () => {
      expect(() => h3Commands.rename('  ')).toThrow(RangeError)
    })

    it('throws RangeError for a name over 31 bytes', () => {
      expect(() => h3Commands.rename('a'.repeat(32))).toThrow(RangeError)
    })
  })
})
