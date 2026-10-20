export enum Opcode {
  GetTargetInfo = 0x03,
  UpdateSysInfo = 0x09,
  NotifyCommunicationWay = 0x0b,
  SetAdvInfo = 0xc0,
  GetAdvInfo = 0xc1,
  NotifyAdvInfo = 0xc2,
  RequestAdvOp = 0xc4,
  Custom = 0xff,
}

export const MAX_PARAM_LENGTH = 530
export const FRAME_PREFIX = [0xfe, 0xdc, 0xba] as const
export const FRAME_END = 0xef
export const FRAME_OVERHEAD = 8
export const HEADER_LENGTH = 7
export const COMMAND_FLAG = 0x80
export const EXPECTS_RESPONSE_FLAG = 0x40
