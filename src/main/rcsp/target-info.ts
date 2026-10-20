import { decodeAdvInfo } from './adv-info'

export type TargetInfo = {
  firmwareVersion: string | null
  vendorId: number | null
  productId: number | null
}

const FIRMWARE_TYPE = 5
const IDS_TYPE = 10
const NIBBLE_BITS = 4
const NIBBLE_MASK = 0xf
const FIRMWARE_NIBBLES = 4
const VENDOR_ID_OFFSET = 0
const PRODUCT_ID_OFFSET = 2
const U16_BYTES = 2

function readU16(value: Uint8Array, offset: number): number | null {
  const high = value[offset]
  const low = value[offset + 1]
  if (high === undefined || low === undefined || offset + U16_BYTES > value.length) return null
  return (high << 8) | low
}

function formatFirmware(value: Uint8Array): string | null {
  const raw = readU16(value, 0)
  if (raw === null) return null
  return Array.from(
    { length: FIRMWARE_NIBBLES },
    (_, index) => (raw >> (NIBBLE_BITS * (FIRMWARE_NIBBLES - 1 - index))) & NIBBLE_MASK,
  ).join('.')
}

export function decodeTargetInfo(payload: Uint8Array): TargetInfo {
  const fields = decodeAdvInfo(payload)
  const firmware = fields.get(FIRMWARE_TYPE)
  const ids = fields.get(IDS_TYPE)
  return {
    firmwareVersion: firmware ? formatFirmware(firmware) : null,
    vendorId: ids ? readU16(ids, VENDOR_ID_OFFSET) : null,
    productId: ids ? readU16(ids, PRODUCT_ID_OFFSET) : null,
  }
}
