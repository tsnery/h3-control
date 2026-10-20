export enum AdvType {
  Battery = 0,
  Name = 1,
  WorkMode = 5,
  Time = 7,
  InEar = 8,
  Sleep = 10,
  NoiseMode = 11,
}

export type BatteryLevel = { percent: number; charging: boolean }

const CHARGING_BIT = 0x80
const PERCENT_MASK = 0x7f
const MAX_PERCENT = 100

const GAME_MODE_BY_WORK_MODE: Readonly<Record<number, boolean>> = { 1: false, 2: true }

export function encodeAdvSet(type: AdvType, value: Uint8Array): Uint8Array {
  return Uint8Array.of(value.length + 1, type, ...value)
}

export function encodeAdvGetMask(types: readonly number[]): Uint8Array {
  const mask = types.reduce((bits, type) => bits | (1 << type), 0) >>> 0
  const view = new DataView(new ArrayBuffer(4))
  view.setUint32(0, mask)
  return new Uint8Array(view.buffer)
}

export function decodeAdvInfo(payload: Uint8Array): Map<number, Uint8Array> {
  const values = new Map<number, Uint8Array>()
  let offset = 0
  while (offset < payload.length) {
    const length = payload[offset]
    if (length === undefined || length === 0) break
    const end = offset + 1 + length
    if (end > payload.length) break
    const type = payload[offset + 1]
    if (type === undefined) break
    values.set(type, payload.slice(offset + 2, end))
    offset = end
  }
  return values
}

export function decodeBattery(value: Uint8Array): BatteryLevel | null {
  const headset = value[0]
  if (headset === undefined) return null
  const percent = headset & PERCENT_MASK
  if (percent < 1 || percent > MAX_PERCENT) return null
  return { percent, charging: (headset & CHARGING_BIT) !== 0 }
}

export function decodeGameMode(value: Uint8Array): boolean | null {
  const workMode = value[0]
  if (workMode === undefined) return null
  return GAME_MODE_BY_WORK_MODE[workMode] ?? null
}
