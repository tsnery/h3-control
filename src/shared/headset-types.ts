import { z } from 'zod'

export const AncSceneSchema = z.enum(['adaptive', 'noisy', 'commuting', 'indoor', 'anti-wind'])
export type AncScene = z.infer<typeof AncSceneSchema>

export const AncLevelSchema = z.enum(['low', 'medium', 'high'])
export type AncLevel = z.infer<typeof AncLevelSchema>

export const AncSettingSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('off') }),
  z.object({ mode: z.literal('transparency') }),
  z.object({
    mode: z.literal('noise-cancelling'),
    scene: AncSceneSchema,
    level: AncLevelSchema.nullable(),
  }),
])
export type AncSetting = z.infer<typeof AncSettingSchema>

export const ANC_LEVELLESS_SCENES: ReadonlySet<AncScene> = new Set(['adaptive', 'anti-wind'])

export const DEFAULT_NOISE_CANCELLING: AncSetting = {
  mode: 'noise-cancelling',
  scene: 'noisy',
  level: 'high',
}

export const EqPresetIdSchema = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
  z.literal(6),
])
export type EqPresetId = z.infer<typeof EqPresetIdSchema>

export const CUSTOM_EQ_BAND_COUNT = 10
export const EQ_GAIN_LIMIT_DB = 8
export const CUSTOM_EQ_FREQUENCIES_HZ: readonly number[] = [
  55, 220, 500, 1000, 1800, 2800, 4500, 7500, 10000, 22000,
]

export const EqStateSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('preset'), presetId: EqPresetIdSchema }),
  z.object({ kind: z.literal('custom'), gainsDb: z.array(z.number()).readonly() }),
  z.object({ kind: z.literal('unknown') }),
])
export type EqState = z.infer<typeof EqStateSchema>

export const ConnectionStatusSchema = z.enum([
  'searching',
  'connecting',
  'connected',
  'reconnecting',
  'bluetooth-off',
])
export type ConnectionStatus = z.infer<typeof ConnectionStatusSchema>

export const ReadOnlyReasonSchema = z.enum(['unexpected-vendor'])
export type ReadOnlyReason = z.infer<typeof ReadOnlyReasonSchema>

export const HeadsetSnapshotSchema = z.object({
  status: ConnectionStatusSchema,
  readOnly: ReadOnlyReasonSchema.nullable(),
  name: z.string().nullable(),
  firmwareVersion: z.string().nullable(),
  battery: z.object({ percent: z.number(), charging: z.boolean() }).nullable(),
  gameMode: z.boolean().nullable(),
  anc: AncSettingSchema.nullable(),
  eq: EqStateSchema.nullable(),
})
export type HeadsetSnapshot = z.infer<typeof HeadsetSnapshotSchema>
