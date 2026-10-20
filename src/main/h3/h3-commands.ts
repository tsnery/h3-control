import type { AncSetting, EqPresetId } from '../../shared/headset-types'
import { validateHeadsetName } from '../../shared/headset-name'
import { AdvType, encodeAdvGetMask, encodeAdvSet } from '../rcsp/adv-info'
import { Opcode } from '../rcsp/opcode'
import { encodeTlvRead } from '../rcsp/qcy-tlv'
import { ANC_CMD_ID, encodeAncSetting } from './anc'
import { type EqTlvFormat, assertEqTlvFormat, encodeCustomEq, encodeEqPreset } from './eq'

export type H3Command = { opcode: Opcode; payload: Uint8Array }

const BATTERY_ADV_TYPES = [
  AdvType.Battery,
  AdvType.WorkMode,
  AdvType.InEar,
  AdvType.Sleep,
  AdvType.NoiseMode,
]
const NAME_ADV_TYPES = [AdvType.Name]
const UNIX_SECONDS_BYTES = 4
const MS_PER_SECOND = 1000

function command(opcode: Opcode, payload: Uint8Array): H3Command {
  return { opcode, payload }
}

function encodeUnixSeconds(date: Date): Uint8Array {
  const view = new DataView(new ArrayBuffer(UNIX_SECONDS_BYTES))
  view.setUint32(0, Math.floor(date.getTime() / MS_PER_SECOND))
  return new Uint8Array(view.buffer)
}

export const h3Commands = Object.freeze({
  getTargetInfo: () => command(Opcode.GetTargetInfo, Uint8Array.of(0xff, 0xff, 0xff, 0xff, 0x00)),
  notifyCommunicationWayBle: () =>
    command(Opcode.NotifyCommunicationWay, Uint8Array.of(0x00, 0x00)),
  syncTime: (date: Date) =>
    command(Opcode.SetAdvInfo, encodeAdvSet(AdvType.Time, encodeUnixSeconds(date))),
  readBattery: () => command(Opcode.GetAdvInfo, encodeAdvGetMask(BATTERY_ADV_TYPES)),
  readName: () => command(Opcode.GetAdvInfo, encodeAdvGetMask(NAME_ADV_TYPES)),
  readAnc: () => command(Opcode.Custom, encodeTlvRead(ANC_CMD_ID)),
  readEq: (format: EqTlvFormat) => {
    assertEqTlvFormat(format)
    return command(Opcode.Custom, encodeTlvRead(format))
  },
  setAnc: (setting: AncSetting) => command(Opcode.Custom, encodeAncSetting(setting)),
  applyEqPreset: (id: EqPresetId, format: EqTlvFormat) =>
    command(Opcode.Custom, encodeEqPreset(id, format)),
  applyCustomEq: (gainsDb: readonly number[], format: EqTlvFormat, isFirstCustomWrite: boolean) =>
    command(Opcode.Custom, encodeCustomEq(gainsDb, format, isFirstCustomWrite)),
  rename: (name: string) => {
    const validation = validateHeadsetName(name)
    if (!validation.ok) throw new RangeError(`Invalid headset name: ${validation.reason}`)
    return command(Opcode.SetAdvInfo, encodeAdvSet(AdvType.Name, validation.bytes))
  },
})
