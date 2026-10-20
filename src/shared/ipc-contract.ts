import type { IpcMain } from 'electron'
import { z } from 'zod'
import {
  AncSettingSchema,
  CUSTOM_EQ_BAND_COUNT,
  EQ_GAIN_LIMIT_DB,
  EqPresetIdSchema,
  type HeadsetSnapshot,
  HeadsetSnapshotSchema,
} from './headset-types'
import { validateHeadsetName } from './headset-name'
import { MAX_VOLUME_PERCENT, MIN_VOLUME_PERCENT, VolumeReadingSchema } from './volume-types'

export enum IpcErrorCode {
  NotConnected = 'not-connected',
  ReadOnly = 'read-only',
  InvalidInput = 'invalid-input',
  DeviceRejected = 'device-rejected',
  Timeout = 'timeout',
  OutputUnavailable = 'output-unavailable',
  Unknown = 'unknown',
}

export type IpcResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: { code: IpcErrorCode; message: string } }

export const SNAPSHOT_CHANGED_CHANNEL = 'headset:snapshot-changed'

const NoInputSchema = z.undefined()
const NoOutputSchema = z.undefined()

export const IPC_CHANNELS = {
  'headset:get-snapshot': { request: NoInputSchema, response: HeadsetSnapshotSchema },
  'headset:set-anc': { request: AncSettingSchema, response: NoOutputSchema },
  'headset:apply-eq-preset': {
    request: z.object({ presetId: EqPresetIdSchema }),
    response: NoOutputSchema,
  },
  'headset:apply-custom-eq': {
    request: z.object({
      gainsDb: z
        .array(z.number().int().min(-EQ_GAIN_LIMIT_DB).max(EQ_GAIN_LIMIT_DB))
        .length(CUSTOM_EQ_BAND_COUNT),
    }),
    response: NoOutputSchema,
  },
  'headset:rename': {
    request: z.object({ name: z.string().refine((name) => validateHeadsetName(name).ok) }),
    response: NoOutputSchema,
  },
  'volume:get': { request: NoInputSchema, response: VolumeReadingSchema.nullable() },
  'volume:set': {
    request: z.object({
      percent: z.number().int().min(MIN_VOLUME_PERCENT).max(MAX_VOLUME_PERCENT),
    }),
    response: NoOutputSchema,
  },
  'app:get-preferences': {
    request: NoInputSchema,
    response: z.object({ launchAtLogin: z.boolean() }),
  },
  'app:set-launch-at-login': {
    request: z.object({ enabled: z.boolean() }),
    response: NoOutputSchema,
  },
} as const

export type IpcChannel = keyof typeof IPC_CHANNELS
export type IpcRequest<C extends IpcChannel> = z.infer<(typeof IPC_CHANNELS)[C]['request']>
export type IpcResponse<C extends IpcChannel> = z.infer<(typeof IPC_CHANNELS)[C]['response']>

export function isIpcChannel(channel: unknown): channel is IpcChannel {
  return typeof channel === 'string' && Object.hasOwn(IPC_CHANNELS, channel)
}

export function ipcResultSchema<Value extends z.ZodType>(value: Value) {
  return z.discriminatedUnion('ok', [
    z.object({ ok: z.literal(true), value }),
    z.object({
      ok: z.literal(false),
      error: z.object({ code: z.enum(IpcErrorCode), message: z.string() }),
    }),
  ])
}

export interface QcyBridge {
  invoke<C extends IpcChannel>(channel: C, input: IpcRequest<C>): Promise<IpcResult<IpcResponse<C>>>
  onSnapshot(listener: (snapshot: HeadsetSnapshot) => void): () => void
}

declare global {
  interface Window {
    qcy: QcyBridge
  }
}

export type IpcMainLike = Pick<IpcMain, 'handle' | 'removeHandler'>
