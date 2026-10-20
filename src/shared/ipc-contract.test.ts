import { describe, expect, it } from 'vitest'
import { AncLevelSchema, AncSceneSchema } from './headset-types'
import { IPC_CHANNELS, isIpcChannel } from './ipc-contract'

const ancRequest = IPC_CHANNELS['headset:set-anc'].request
const customEqRequest = IPC_CHANNELS['headset:apply-custom-eq'].request
const renameRequest = IPC_CHANNELS['headset:rename'].request
const volumeSetRequest = IPC_CHANNELS['volume:set'].request

const gains = (count: number, value: number) => Array.from({ length: count }, () => value)

describe('headset:set-anc request', () => {
  it('accepts every AncSetting variant and rejects unknown scenes', () => {
    const variants = [
      { mode: 'off' },
      { mode: 'transparency' },
      ...AncSceneSchema.options.flatMap((scene) => [
        { mode: 'noise-cancelling', scene, level: null },
        ...AncLevelSchema.options.map((level) => ({ mode: 'noise-cancelling', scene, level })),
      ]),
    ]
    for (const variant of variants) expect(ancRequest.safeParse(variant).success).toBe(true)
    expect(
      ancRequest.safeParse({ mode: 'noise-cancelling', scene: 'stadium', level: null }).success,
    ).toBe(false)
  })
})

describe('headset:apply-custom-eq request', () => {
  it('accepts ten integer gains within the limit', () => {
    expect(customEqRequest.safeParse({ gainsDb: gains(10, 8) }).success).toBe(true)
    expect(customEqRequest.safeParse({ gainsDb: gains(10, -8) }).success).toBe(true)
  })

  it('rejects wrong band counts, out-of-range and fractional gains', () => {
    expect(customEqRequest.safeParse({ gainsDb: gains(9, 0) }).success).toBe(false)
    expect(customEqRequest.safeParse({ gainsDb: gains(10, 9) }).success).toBe(false)
    expect(customEqRequest.safeParse({ gainsDb: gains(10, 0.5) }).success).toBe(false)
  })
})

describe('headset:rename request', () => {
  it('accepts a valid name and rejects empty or oversized names', () => {
    expect(renameRequest.safeParse({ name: 'Meu H3' }).success).toBe(true)
    expect(renameRequest.safeParse({ name: '   ' }).success).toBe(false)
    expect(renameRequest.safeParse({ name: 'a'.repeat(32) }).success).toBe(false)
  })
})

describe('volume:set request', () => {
  it('accepts 0 to 100 and rejects values outside', () => {
    expect(volumeSetRequest.safeParse({ percent: 0 }).success).toBe(true)
    expect(volumeSetRequest.safeParse({ percent: 100 }).success).toBe(true)
    expect(volumeSetRequest.safeParse({ percent: 101 }).success).toBe(false)
    expect(volumeSetRequest.safeParse({ percent: -1 }).success).toBe(false)
  })
})

describe('isIpcChannel', () => {
  it('recognizes contract channels only', () => {
    expect(isIpcChannel('volume:get')).toBe(true)
    expect(isIpcChannel('toString')).toBe(false)
    expect(isIpcChannel('shell:open')).toBe(false)
    expect(isIpcChannel(['volume:set'])).toBe(false)
  })
})
