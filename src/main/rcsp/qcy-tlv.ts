export const QCY_READ_PREFIX = 0xfe

const TLV_HEADER_LENGTH = 2

export type QcyTlv = { cmdId: number; data: Uint8Array }

export function encodeTlv(cmdId: number, data: Uint8Array): Uint8Array {
  return Uint8Array.of(cmdId, data.length, ...data)
}

export function encodeTlvRead(cmdId: number): Uint8Array {
  return Uint8Array.of(QCY_READ_PREFIX, 1, cmdId)
}

export function decodeTlvs(payload: Uint8Array): QcyTlv[] {
  const tlvs: QcyTlv[] = []
  let offset = 0
  while (offset + TLV_HEADER_LENGTH <= payload.length) {
    const cmdId = payload[offset]
    const length = payload[offset + 1]
    if (cmdId === undefined || length === undefined) break
    const end = offset + TLV_HEADER_LENGTH + length
    if (end > payload.length) break
    tlvs.push({ cmdId, data: payload.slice(offset + TLV_HEADER_LENGTH, end) })
    offset = end
  }
  return tlvs
}
