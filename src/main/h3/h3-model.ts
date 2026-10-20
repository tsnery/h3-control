import type { TargetInfo } from '../rcsp/target-info'
import { EqTlvFormat } from './eq'

export const COMMUNICATION_WAY_NOTICE_REQUIRED = false
export const EXPECTED_VENDOR_ID = 0x1c52
export const SUPPORTED_PRODUCT_IDS: readonly number[] = [0x4173, 0x4178]

const SEVEN_BYTE_FROM_FIRMWARE = [0, 9, 0, 0] as const
const FIRMWARE_PART_PATTERN = /^\d+$/

function parseFirmware(firmwareVersion: string): number[] | null {
  const parts = firmwareVersion.split('.')
  if (!parts.every((part) => FIRMWARE_PART_PATTERN.test(part))) return null
  return parts.map(Number)
}

function compareParts(left: readonly number[], right: readonly number[]): number {
  const length = Math.max(left.length, right.length)
  for (let position = 0; position < length; position++) {
    const difference = (left[position] ?? 0) - (right[position] ?? 0)
    if (difference !== 0) return difference
  }
  return 0
}

export function eqFormatForFirmware(firmwareVersion: string | null): EqTlvFormat {
  if (firmwareVersion === null) return EqTlvFormat.SevenByte
  const parts = parseFirmware(firmwareVersion)
  if (parts === null) return EqTlvFormat.SevenByte
  return compareParts(parts, SEVEN_BYTE_FROM_FIRMWARE) >= 0 ? EqTlvFormat.SevenByte : EqTlvFormat.SixByte
}

export function isSupportedTarget(info: TargetInfo): boolean {
  if (info.vendorId !== EXPECTED_VENDOR_ID || info.productId === null) return false
  return SUPPORTED_PRODUCT_IDS.includes(info.productId)
}
