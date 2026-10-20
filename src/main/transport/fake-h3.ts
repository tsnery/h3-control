import {
  type AncSetting,
  DEFAULT_NOISE_CANCELLING,
  EqPresetIdSchema,
} from '../../shared/headset-types'
import { ANC_CMD_ID, decodeAncSetting, encodeAncSetting } from '../h3/anc'
import { EqTlvFormat, encodeEqPreset } from '../h3/eq'
import { AdvType, decodeAdvInfo, encodeAdvSet } from '../rcsp/adv-info'
import { type RcspCommandFrame, encodeCommandFrame } from '../rcsp/frame'
import { createFrameParser } from '../rcsp/frame-parser'
import { FRAME_END, FRAME_OVERHEAD, FRAME_PREFIX, Opcode } from '../rcsp/opcode'
import { QCY_READ_PREFIX, decodeTlvs, encodeTlv } from '../rcsp/qcy-tlv'
import { type ConnectedLink, type HeadsetTransport, TransportError } from './headset-transport'

export type FakeH3State = {
  name: string
  batteryPercent: number
  anc: AncSetting
  eqIndex: number
  gameMode: boolean
  vendorId: number
  firmwareVersion: string
  respondsToTargetInfo: boolean
  needsCommunicationWayNotice: boolean
}

export type FakeH3 = {
  transport: HeadsetTransport
  state: () => FakeH3State
  writtenFrames: () => Uint8Array[]
  pressAncButton(setting: AncSetting): void
  pressGameModeButton(on: boolean): void
  powerOff(): void
  powerOffSilently(): void
  powerOn(): void
  setAdapterAvailable(available: boolean): void
}

const DEFAULT_STATE: FakeH3State = {
  name: 'QCY H3',
  batteryPercent: 50,
  anc: DEFAULT_NOISE_CANCELLING,
  eqIndex: 1,
  gameMode: false,
  vendorId: 0x1c52,
  firmwareVersion: '0.9.1.2',
  respondsToTargetInfo: true,
  needsCommunicationWayNotice: false,
}

const DEVICE_ID = 'fake-h3'
const DEVICE_NAME = 'QCY H3-APP'
const PRODUCT_ID = 0x4173
const FIRMWARE_TYPE = 5
const IDS_TYPE = 10
const HEX_RADIX = 16
const SLEEP_VALUE = 0x02
const WORK_MODE_NORMAL = 0x01
const WORK_MODE_GAME = 0x02
const DEFAULT_EQ_INDEX = 1
const CAPTURED_TARGET_INFO_HEX =
  '02 00 20 05 01 00 00 00 01 09 02 84 AC 60 83 27 E1 8E 01 07 04 00 00 00 01 00 00 03 05 09 12 02 06 0A 03 07 1B 34 04 08 01 00 01 04 09 00 00 00 05 0A 1C 52 41 73 11 0B 68 45 39 79 66 73 65 58 36 55 64 4B 37 72 46 68 15 0C 6A 6C 5F 73 64 6B 5F 61 63 36 39 37 5F 70 75 62 6C 69 73 68 05 0D 01 10 02 1C 08 11 00 84 AC 60 26 F5 68 02 12 00 03 13 06 00 05 15 00 00 00 00'
const CAPTURED_DEFAULT_EQ_HEX =
  '22 49 01 DA FD 37 00 FA 00 28 00 02 DC 00 B4 FB 50 00 02 F4 01 64 00 46 00 02 E8 03 00 00 46 00 02 08 07 FA 00 64 00 02 F0 0A 2C 01 50 00 02 4C 1D FA 00 78 00 02 94 11 C8 00 82 00 02 8A 28 00 00 46 00 02 60 54 00 00 46 00 02'
const STATUS_OK = 0
const STATUS_UNKNOWN_COMMAND = 2
const READ_TLV_LENGTH = 1
const RESPONSE_FLAG = 0x00
const RESPONSE_HEADER_LENGTH = 2
const NIBBLE_BITS = 4
const BYTE_BITS = 8
const BYTE_MASK = 0xff
const SN_MODULUS = 256
const ADV_MASK_BYTES = 4
const ACCEPTED_ADV_SET_TYPES: ReadonlySet<number> = new Set([AdvType.Name, AdvType.Time])

type Reply = { status: number; payload: Uint8Array }

const ok = (payload: Uint8Array = new Uint8Array()): Reply => ({ status: STATUS_OK, payload })
const unknownCommand = (): Reply => ({ status: STATUS_UNKNOWN_COMMAND, payload: new Uint8Array() })

const u16 = (value: number): Uint8Array =>
  Uint8Array.of((value >> BYTE_BITS) & BYTE_MASK, value & BYTE_MASK)

const joinBytes = (parts: readonly Uint8Array[]): Uint8Array =>
  Uint8Array.of(...parts.flatMap((part) => [...part]))

const encodeFirmware = (version: string): Uint8Array =>
  u16(version.split('.').reduce((raw, part) => (raw << NIBBLE_BITS) | Number(part), 0))

const fromHex = (hex: string): Uint8Array =>
  Uint8Array.from(hex.split(' '), (token) => Number.parseInt(token, HEX_RADIX))

const encodeResponseFrame = (opcode: number, sn: number, reply: Reply): Uint8Array => {
  const paramLength = RESPONSE_HEADER_LENGTH + reply.payload.length
  const header = [RESPONSE_FLAG, opcode, ...u16(paramLength), reply.status, sn]
  const frame = new Uint8Array(paramLength + FRAME_OVERHEAD)
  frame.set(FRAME_PREFIX, 0)
  frame.set(header, FRAME_PREFIX.length)
  frame.set(reply.payload, FRAME_PREFIX.length + header.length)
  frame[frame.length - 1] = FRAME_END
  return frame
}

const encodeAncPushFrame = (setting: AncSetting, sn: number): Uint8Array =>
  encodeCommandFrame({ opcode: Opcode.Custom, sn, payload: encodeAncSetting(setting) })

const targetInfoReply = (state: FakeH3State): Reply => {
  const fields = decodeAdvInfo(fromHex(CAPTURED_TARGET_INFO_HEX))
  fields.set(FIRMWARE_TYPE, encodeFirmware(state.firmwareVersion))
  fields.set(IDS_TYPE, joinBytes([u16(state.vendorId), u16(PRODUCT_ID)]))
  return ok(joinBytes([...fields].map(([type, value]) => encodeAdvSet(type, value))))
}

const advInfoReply = (state: FakeH3State, request: Uint8Array): Reply => {
  if (request.length < ADV_MASK_BYTES) return unknownCommand()
  const mask = new DataView(request.buffer, request.byteOffset, request.byteLength).getUint32(0)
  const available: [AdvType, Uint8Array][] = [
    [AdvType.Sleep, Uint8Array.of(SLEEP_VALUE)],
    [AdvType.WorkMode, Uint8Array.of(state.gameMode ? WORK_MODE_GAME : WORK_MODE_NORMAL)],
    [AdvType.Battery, Uint8Array.of(state.batteryPercent, 0, 0)],
    [AdvType.Name, new TextEncoder().encode(state.name)],
  ]
  const wanted = available.filter(([type]) => ((mask >>> type) & 1) === 1)
  return ok(joinBytes(wanted.map(([type, value]) => encodeAdvSet(type, value))))
}

const setAdvInfoReply = (state: FakeH3State, request: Uint8Array): Reply => {
  const fields = decodeAdvInfo(request)
  const accepted = fields.size > 0 && [...fields.keys()].every((type) => ACCEPTED_ADV_SET_TYPES.has(type))
  if (!accepted) return unknownCommand()
  const name = fields.get(AdvType.Name)
  if (name !== undefined) state.name = new TextDecoder().decode(name)
  return ok(Uint8Array.of(STATUS_OK))
}

const deliverAfterWrite = (notify: (chunk: Uint8Array) => void, chunk: Uint8Array): void => {
  void Promise.resolve()
    .then(() => undefined)
    .then(() => notify(chunk))
}

type LiveLink = { notify: (chunk: Uint8Array) => void; drop: () => void; mute: () => void }

export const createFakeH3 = (initial: Partial<FakeH3State> = {}): FakeH3 => {
  const state: FakeH3State = { ...DEFAULT_STATE, ...initial }
  const written: Uint8Array[] = []
  let eqTlv =
    state.eqIndex === DEFAULT_EQ_INDEX
      ? fromHex(CAPTURED_DEFAULT_EQ_HEX)
      : encodeEqPreset(EqPresetIdSchema.parse(state.eqIndex), EqTlvFormat.SevenByte)
  let pushSn = 0
  let powered = true
  let adapterAvailable = true
  let live: LiveLink | null = null
  let communicationWayNoticed = false

  const customReadReply = (cmdId: number): Reply | null => {
    if (cmdId === ANC_CMD_ID) return ok(encodeAncSetting(state.anc))
    if (cmdId === EqTlvFormat.SevenByte) return ok(eqTlv)
    if (cmdId === EqTlvFormat.SixByte) return null
    return unknownCommand()
  }

  const customReply = (payload: Uint8Array): Reply | null => {
    const [prefix, length, readId] = payload
    if (prefix === QCY_READ_PREFIX && length === READ_TLV_LENGTH && readId !== undefined) {
      return customReadReply(readId)
    }
    const tlvs = decodeTlvs(payload)
    const [tlv] = tlvs
    if (tlvs.length !== 1 || tlv === undefined) return unknownCommand()
    if (tlv.cmdId === ANC_CMD_ID) {
      const anc = decodeAncSetting(tlv.data)
      if (anc === null) return unknownCommand()
      state.anc = anc
      return ok()
    }
    if (tlv.cmdId === EqTlvFormat.SixByte) return null
    if (tlv.cmdId === EqTlvFormat.SevenByte) {
      eqTlv = encodeTlv(tlv.cmdId, tlv.data)
      state.eqIndex = tlv.data[0] ?? state.eqIndex
      return ok()
    }
    return unknownCommand()
  }

  const answersTargetInfo = (): boolean =>
    state.respondsToTargetInfo && (!state.needsCommunicationWayNotice || communicationWayNoticed)

  const replyTo = (frame: RcspCommandFrame): Reply | null => {
    if (frame.opcode === Opcode.GetTargetInfo) return answersTargetInfo() ? targetInfoReply(state) : null
    if (frame.opcode === Opcode.NotifyCommunicationWay) {
      communicationWayNoticed = true
      return ok()
    }
    if (frame.opcode === Opcode.GetAdvInfo) return advInfoReply(state, frame.payload)
    if (frame.opcode === Opcode.SetAdvInfo) return setAdvInfoReply(state, frame.payload)
    if (frame.opcode === Opcode.Custom) return customReply(frame.payload)
    return unknownCommand()
  }

  const openLink = (): ConnectedLink => {
    const notificationListeners = new Set<(chunk: Uint8Array) => void>()
    const disconnectListeners = new Set<() => void>()
    const parser = createFrameParser()
    let connected = true
    let muted = false
    communicationWayNoticed = false

    const notify = (chunk: Uint8Array): void => {
      if (!connected || muted) return
      notificationListeners.forEach((listener) => listener(chunk))
    }
    const drop = (): void => {
      if (!connected) return
      connected = false
      if (live?.drop === drop) live = null
      disconnectListeners.forEach((listener) => listener())
    }
    const mute = (): void => {
      muted = true
    }
    live = { notify, drop, mute }

    return {
      deviceId: DEVICE_ID,
      deviceName: DEVICE_NAME,
      write: async (frame) => {
        if (!connected) throw new TransportError('write-failed', 'Link is disconnected')
        written.push(frame.slice())
        for (const incoming of parser.push(frame)) {
          if (incoming.kind !== 'command') continue
          const reply = replyTo(incoming)
          if (reply === null) continue
          deliverAfterWrite(notify, encodeResponseFrame(incoming.opcode, incoming.sn, reply))
        }
      },
      onNotification: (listener) => {
        notificationListeners.add(listener)
        return () => {
          notificationListeners.delete(listener)
        }
      },
      onDisconnect: (listener) => {
        disconnectListeners.add(listener)
        return () => {
          disconnectListeners.delete(listener)
        }
      },
      disconnect: async () => drop(),
    }
  }

  const transport: HeadsetTransport = {
    connect: async ({ signal }) => {
      signal.throwIfAborted()
      if (!adapterAvailable) throw new TransportError('adapter-unavailable')
      if (!powered) throw new TransportError('device-not-found')
      return openLink()
    },
  }

  return {
    transport,
    state: () => ({ ...state, anc: { ...state.anc } }),
    writtenFrames: () => written.map((frame) => frame.slice()),
    pressAncButton: (setting) => {
      state.anc = setting
      if (live === null) return
      live.notify(encodeAncPushFrame(setting, pushSn))
      pushSn = (pushSn + 1) % SN_MODULUS
    },
    pressGameModeButton: (on) => {
      state.gameMode = on
    },
    powerOff: () => {
      powered = false
      live?.drop()
    },
    powerOffSilently: () => {
      powered = false
      live?.mute()
    },
    powerOn: () => {
      powered = true
    },
    setAdapterAvailable: (available) => {
      adapterAvailable = available
      if (!available) live?.drop()
    },
  }
}
