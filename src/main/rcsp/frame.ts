import {
  COMMAND_FLAG,
  EXPECTS_RESPONSE_FLAG,
  FRAME_END,
  FRAME_OVERHEAD,
  FRAME_PREFIX,
  HEADER_LENGTH,
  MAX_PARAM_LENGTH,
  type Opcode,
} from './opcode'

export type RcspCommandFrame = {
  kind: 'command'
  opcode: number
  expectsResponse: boolean
  sn: number
  payload: Uint8Array
}

export type RcspResponseFrame = {
  kind: 'response'
  opcode: number
  status: number
  sn: number
  payload: Uint8Array
}

export type RcspFrame = RcspCommandFrame | RcspResponseFrame

const HOST_COMMAND_FLAG = COMMAND_FLAG | EXPECTS_RESPONSE_FLAG
const SN_LENGTH = 1
const BYTE_MASK = 0xff
const BYTE_BITS = 8

export const encodeCommandFrame = (input: { opcode: Opcode; sn: number; payload: Uint8Array }): Uint8Array => {
  const paramLength = SN_LENGTH + input.payload.length
  if (paramLength > MAX_PARAM_LENGTH) {
    throw new RangeError(`RCSP payload too long: ${input.payload.length} bytes`)
  }
  const frame = new Uint8Array(paramLength + FRAME_OVERHEAD)
  frame.set(FRAME_PREFIX, 0)
  frame[FRAME_PREFIX.length] = HOST_COMMAND_FLAG
  frame[FRAME_PREFIX.length + 1] = input.opcode
  frame[FRAME_PREFIX.length + 2] = paramLength >> BYTE_BITS
  frame[FRAME_PREFIX.length + 3] = paramLength & BYTE_MASK
  frame[HEADER_LENGTH] = input.sn & BYTE_MASK
  frame.set(input.payload, HEADER_LENGTH + SN_LENGTH)
  frame[frame.length - 1] = FRAME_END
  return frame
}

export const decodeFrameBody = (flag: number, opcode: number, body: Uint8Array): RcspFrame | undefined => {
  if ((flag & COMMAND_FLAG) !== 0) {
    const [sn] = body
    if (sn === undefined) return undefined
    return {
      kind: 'command',
      opcode,
      expectsResponse: (flag & EXPECTS_RESPONSE_FLAG) !== 0,
      sn,
      payload: body.slice(SN_LENGTH),
    }
  }
  const [status, sn] = body
  if (status === undefined || sn === undefined) return undefined
  return { kind: 'response', opcode, status, sn, payload: body.slice(SN_LENGTH + 1) }
}
