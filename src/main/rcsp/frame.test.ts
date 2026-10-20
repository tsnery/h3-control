import { describe, expect, it } from 'vitest'
import { encodeCommandFrame } from './frame'
import { Opcode } from './opcode'

describe('encodeCommandFrame', () => {
  it('encodes the game-mode example byte for byte', () => {
    const frame = encodeCommandFrame({
      opcode: Opcode.SetAdvInfo,
      sn: 0x70,
      payload: Uint8Array.of(0x02, 0x05, 0x02),
    })

    expect([...frame]).toEqual([0xfe, 0xdc, 0xba, 0xc0, 0xc0, 0x00, 0x04, 0x70, 0x02, 0x05, 0x02, 0xef])
  })

  it('encodes an ANC command inside the custom opcode', () => {
    const frame = encodeCommandFrame({
      opcode: Opcode.Custom,
      sn: 0xbb,
      payload: Uint8Array.of(0x17, 0x03, 0x02, 0x00, 0x00),
    })

    expect([...frame]).toEqual([
      0xfe, 0xdc, 0xba, 0xc0, 0xff, 0x00, 0x06, 0xbb, 0x17, 0x03, 0x02, 0x00, 0x00, 0xef,
    ])
  })

  it('encodes an empty payload with a length of one', () => {
    const frame = encodeCommandFrame({ opcode: Opcode.GetTargetInfo, sn: 1, payload: new Uint8Array() })

    expect([...frame]).toEqual([0xfe, 0xdc, 0xba, 0xc0, 0x03, 0x00, 0x01, 0x01, 0xef])
  })
})
