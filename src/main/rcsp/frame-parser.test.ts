import { describe, expect, it } from 'vitest'
import { createFrameParser } from './frame-parser'

const RESPONSE = [0xfe, 0xdc, 0xba, 0x00, 0xc0, 0x00, 0x03, 0x00, 0x70, 0x00, 0xef]
const PUSHED_COMMAND = [0xfe, 0xdc, 0xba, 0xc0, 0xff, 0x00, 0x06, 0x05, 0x17, 0x03, 0x03, 0x01, 0x04, 0xef]

const RESPONSE_FRAME = { kind: 'response', opcode: 0xc0, status: 0, sn: 0x70, payload: Uint8Array.of(0x00) }
const PUSHED_COMMAND_FRAME = {
  kind: 'command',
  opcode: 0xff,
  expectsResponse: true,
  sn: 5,
  payload: Uint8Array.of(0x17, 0x03, 0x03, 0x01, 0x04),
}

const bytes = (values: number[]) => Uint8Array.from(values)

const createRandom = (seed: number) => {
  let state = seed
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state
  }
}

describe('createFrameParser', () => {
  it('decodes a response frame', () => {
    expect(createFrameParser().push(bytes(RESPONSE))).toEqual([RESPONSE_FRAME])
  })

  it('decodes a device-pushed command frame', () => {
    expect(createFrameParser().push(bytes(PUSHED_COMMAND))).toEqual([PUSHED_COMMAND_FRAME])
  })

  it('reassembles a frame split across three chunks', () => {
    const parser = createFrameParser()

    expect(parser.push(bytes(PUSHED_COMMAND.slice(0, 2)))).toEqual([])
    expect(parser.push(bytes(PUSHED_COMMAND.slice(2, 9)))).toEqual([])
    expect(parser.push(bytes(PUSHED_COMMAND.slice(9)))).toEqual([PUSHED_COMMAND_FRAME])
  })

  it('returns every frame when one chunk carries two frames', () => {
    const frames = createFrameParser().push(bytes([...RESPONSE, ...PUSHED_COMMAND]))

    expect(frames).toEqual([RESPONSE_FRAME, PUSHED_COMMAND_FRAME])
  })

  it('skips leading garbage before the prefix', () => {
    const frames = createFrameParser().push(bytes([0x01, 0xfe, 0xdc, 0x55, ...RESPONSE]))

    expect(frames).toEqual([RESPONSE_FRAME])
  })

  it('drops a frame whose end byte is not EF and resyncs on the next prefix', () => {
    const corrupted = [...RESPONSE.slice(0, -1), 0x00]

    const frames = createFrameParser().push(bytes([...corrupted, ...PUSHED_COMMAND]))

    expect(frames).toEqual([PUSHED_COMMAND_FRAME])
  })

  it('skips frames whose length exceeds 530', () => {
    const oversized = [0xfe, 0xdc, 0xba, 0x00, 0xc0, 0x02, 0x13]

    const frames = createFrameParser().push(bytes([...oversized, ...RESPONSE]))

    expect(frames).toEqual([RESPONSE_FRAME])
  })

  it('keeps an incomplete frame after complete ones until the rest arrives', () => {
    const parser = createFrameParser()

    expect(parser.push(bytes([...RESPONSE, ...PUSHED_COMMAND.slice(0, 5)]))).toEqual([RESPONSE_FRAME])
    expect(parser.push(bytes(PUSHED_COMMAND.slice(5)))).toEqual([PUSHED_COMMAND_FRAME])
  })

  it('keeps separate buffers per parser instance', () => {
    const first = createFrameParser()
    const second = createFrameParser()

    first.push(bytes(RESPONSE.slice(0, 5)))

    expect(second.push(bytes(RESPONSE.slice(5)))).toEqual([])
    expect(first.push(bytes(RESPONSE.slice(5)))).toEqual([RESPONSE_FRAME])
  })

  it('never throws on random bytes', () => {
    const random = createRandom(0x51ed)
    const parser = createFrameParser()

    const run = () => {
      for (let index = 0; index < 1000; index += 1) {
        const length = random() % 64
        const chunk = Uint8Array.from({ length }, () => random() & 0xff)
        parser.push(chunk)
      }
    }

    expect(run).not.toThrow()
  })

  it('still decodes a valid frame after random bytes', () => {
    const random = createRandom(7)
    const parser = createFrameParser()
    for (let index = 0; index < 200; index += 1) {
      parser.push(Uint8Array.from({ length: 32 }, () => random() & 0xff))
    }

    const frames = parser.push(bytes([0xef, 0xef, ...RESPONSE]))

    expect(frames.at(-1)).toEqual(RESPONSE_FRAME)
  })
})
