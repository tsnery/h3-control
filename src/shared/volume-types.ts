import { z } from 'zod'

export const MIN_VOLUME_PERCENT = 0
export const MAX_VOLUME_PERCENT = 100

export const VolumeReadingSchema = z.object({
  percent: z.number().int().min(MIN_VOLUME_PERCENT).max(MAX_VOLUME_PERCENT),
  muted: z.boolean(),
  endpointName: z.string(),
})

export type VolumeReading = z.infer<typeof VolumeReadingSchema>
