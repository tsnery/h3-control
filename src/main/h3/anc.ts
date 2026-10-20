import {
  ANC_LEVELLESS_SCENES,
  type AncLevel,
  type AncScene,
  type AncSetting,
} from '../../shared/headset-types'
import { encodeTlv } from '../rcsp/qcy-tlv'

export const ANC_CMD_ID = 0x17
const VALUE_LENGTH = 3

enum AncMode {
  NoiseCancelling = 1,
  Off = 2,
  Transparency = 3,
}

const SCENE_BYTES: Record<AncScene, number> = {
  noisy: 1,
  commuting: 2,
  indoor: 3,
  'anti-wind': 4,
  adaptive: 5,
}

const LEVEL_BYTES: Record<AncLevel, number> = { low: 0, medium: 1, high: 2 }

const OFF_SCENE = 0
const TRANSPARENCY_SCENE = 1
const TRANSPARENCY_LEVEL = 4
const NO_LEVEL = 0

const SCENES_BY_BYTE = new Map<number, AncScene>([
  [SCENE_BYTES.noisy, 'noisy'],
  [SCENE_BYTES.commuting, 'commuting'],
  [SCENE_BYTES.indoor, 'indoor'],
  [SCENE_BYTES['anti-wind'], 'anti-wind'],
  [SCENE_BYTES.adaptive, 'adaptive'],
])

const LEVELS_BY_BYTE = new Map<number, AncLevel>([
  [LEVEL_BYTES.low, 'low'],
  [LEVEL_BYTES.medium, 'medium'],
  [LEVEL_BYTES.high, 'high'],
])

function encodeAncValue(mode: AncMode, scene: number, level: number): Uint8Array {
  return encodeTlv(ANC_CMD_ID, Uint8Array.of(mode, scene, level))
}

export function encodeAncSetting(setting: AncSetting): Uint8Array {
  if (setting.mode === 'off') return encodeAncValue(AncMode.Off, OFF_SCENE, NO_LEVEL)
  if (setting.mode === 'transparency') {
    return encodeAncValue(AncMode.Transparency, TRANSPARENCY_SCENE, TRANSPARENCY_LEVEL)
  }
  const scene = SCENE_BYTES[setting.scene]
  if (ANC_LEVELLESS_SCENES.has(setting.scene)) {
    return encodeAncValue(AncMode.NoiseCancelling, scene, NO_LEVEL)
  }
  if (setting.level === null) throw new RangeError(`Scene ${setting.scene} requires a level`)
  return encodeAncValue(AncMode.NoiseCancelling, scene, LEVEL_BYTES[setting.level])
}

export function decodeAncSetting(data: Uint8Array): AncSetting | null {
  if (data.length !== VALUE_LENGTH) return null
  const [mode, sceneByte, levelByte] = data
  if (mode === AncMode.Off) return { mode: 'off' }
  if (mode === AncMode.Transparency) return { mode: 'transparency' }
  if (mode !== AncMode.NoiseCancelling) return null
  if (sceneByte === undefined || levelByte === undefined) return null
  const scene = SCENES_BY_BYTE.get(sceneByte)
  if (scene === undefined) return null
  if (ANC_LEVELLESS_SCENES.has(scene)) {
    return levelByte === NO_LEVEL ? { mode: 'noise-cancelling', scene, level: null } : null
  }
  const level = LEVELS_BY_BYTE.get(levelByte)
  if (level === undefined) return null
  return { mode: 'noise-cancelling', scene, level }
}
