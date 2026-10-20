import { decodeFrameBody, type RcspFrame } from './frame'
import { FRAME_END, FRAME_OVERHEAD, FRAME_PREFIX, HEADER_LENGTH, MAX_PARAM_LENGTH } from './opcode'

const BYTE_BITS = 8
const FLAG_OFFSET = FRAME_PREFIX.length
const OPCODE_OFFSET = FLAG_OFFSET + 1
const LENGTH_OFFSET = OPCODE_OFFSET + 1

const findPrefix = (buffer: Uint8Array, from: number): number => {
  const lastStart = buffer.length - FRAME_PREFIX.length
  for (let index = from; index <= lastStart; index += 1) {
    if (FRAME_PREFIX.every((byte, offset) => buffer[index + offset] === byte)) return index
  }
  return -1
}

const trailingPrefixBytes = (buffer: Uint8Array): number => {
  const longest = Math.min(FRAME_PREFIX.length - 1, buffer.length)
  for (let size = longest; size > 0; size -= 1) {
    const tail = buffer.subarray(buffer.length - size)
    if (tail.every((byte, offset) => byte === FRAME_PREFIX[offset])) return size
  }
  return 0
}

const concat = (head: Uint8Array, tail: Uint8Array): Uint8Array => {
  if (head.length === 0) return tail
  const joined = new Uint8Array(head.length + tail.length)
  joined.set(head, 0)
  joined.set(tail, head.length)
  return joined
}

export const createFrameParser = () => {
  let pending: Uint8Array = new Uint8Array()

  const push = (chunk: Uint8Array): RcspFrame[] => {
    const buffer = concat(pending, chunk)
    const frames: RcspFrame[] = []
    let cursor = 0

    while (cursor < buffer.length) {
      const start = findPrefix(buffer, cursor)
      if (start === -1) {
        cursor = buffer.length - trailingPrefixBytes(buffer.subarray(cursor))
        break
      }
      if (buffer.length - start < HEADER_LENGTH) {
        cursor = start
        break
      }
      const paramLength = ((buffer[start + LENGTH_OFFSET] ?? 0) << BYTE_BITS) | (buffer[start + LENGTH_OFFSET + 1] ?? 0)
      if (paramLength > MAX_PARAM_LENGTH) {
        cursor = start + 1
        continue
      }
      const frameLength = paramLength + FRAME_OVERHEAD
      if (buffer.length - start < frameLength) {
        cursor = start
        break
      }
      if (buffer[start + frameLength - 1] !== FRAME_END) {
        cursor = start + 1
        continue
      }
      const body = buffer.slice(start + HEADER_LENGTH, start + HEADER_LENGTH + paramLength)
      const frame = decodeFrameBody(buffer[start + FLAG_OFFSET] ?? 0, buffer[start + OPCODE_OFFSET] ?? 0, body)
      cursor = frame ? start + frameLength : start + 1
      if (frame) frames.push(frame)
    }

    pending = buffer.slice(cursor)
    return frames
  }

  return { push }
}
