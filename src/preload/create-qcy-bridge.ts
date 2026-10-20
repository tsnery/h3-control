import type { IpcRendererEvent } from 'electron'
import { z } from 'zod'
import { HeadsetSnapshotSchema } from '../shared/headset-types'
import {
  IpcErrorCode,
  ipcResultSchema,
  type IpcResult,
  IPC_CHANNELS,
  type IpcChannel,
  type IpcRequest,
  type IpcResponse,
  isIpcChannel,
  type QcyBridge,
  SNAPSHOT_CHANGED_CHANNEL,
} from '../shared/ipc-contract'

type RendererListener = (event: IpcRendererEvent, payload: unknown) => void

export type IpcRendererLike = {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>
  on(channel: string, listener: RendererListener): unknown
  removeListener(channel: string, listener: RendererListener): unknown
}

function failure(code: IpcErrorCode, message: string): IpcResult<never> {
  return { ok: false, error: { code, message } }
}

type Calls = {
  [C in IpcChannel]: (input: IpcRequest<C>) => Promise<IpcResult<IpcResponse<C>>>
}

function createCalls(ipcRenderer: IpcRendererLike): Calls {
  function caller<Request extends z.ZodType, Response extends z.ZodType>(
    channel: IpcChannel,
    contract: { request: Request; response: Response },
  ) {
    return async (input: z.infer<Request>): Promise<IpcResult<z.infer<Response>>> => {
      try {
        const envelope = ipcResultSchema(z.unknown()).safeParse(
          await ipcRenderer.invoke(channel, input),
        )
        if (envelope.success && !envelope.data.ok) return envelope.data
        if (envelope.success && envelope.data.ok) {
          const value = contract.response.safeParse(envelope.data.value)
          if (value.success) return { ok: true, value: value.data }
        }
      } catch {
        return failure(IpcErrorCode.Unknown, 'Request failed')
      }
      return failure(IpcErrorCode.Unknown, 'Malformed response')
    }
  }

  return {
    'headset:get-snapshot': caller('headset:get-snapshot', IPC_CHANNELS['headset:get-snapshot']),
    'headset:set-anc': caller('headset:set-anc', IPC_CHANNELS['headset:set-anc']),
    'headset:apply-eq-preset': caller('headset:apply-eq-preset', IPC_CHANNELS['headset:apply-eq-preset']),
    'headset:apply-custom-eq': caller('headset:apply-custom-eq', IPC_CHANNELS['headset:apply-custom-eq']),
    'headset:rename': caller('headset:rename', IPC_CHANNELS['headset:rename']),
    'volume:get': caller('volume:get', IPC_CHANNELS['volume:get']),
    'volume:set': caller('volume:set', IPC_CHANNELS['volume:set']),
    'app:get-preferences': caller('app:get-preferences', IPC_CHANNELS['app:get-preferences']),
    'app:set-launch-at-login': caller('app:set-launch-at-login', IPC_CHANNELS['app:set-launch-at-login']),
  }
}

export function createQcyBridge(ipcRenderer: IpcRendererLike): QcyBridge {
  const calls = createCalls(ipcRenderer)
  return {
    async invoke(channel, input) {
      if (!isIpcChannel(channel)) return failure(IpcErrorCode.InvalidInput, 'Unknown channel')
      return await calls[channel](input)
    },
    onSnapshot(listener) {
      const forward: RendererListener = (_event, payload) => {
        const parsed = HeadsetSnapshotSchema.safeParse(payload)
        if (parsed.success) listener(parsed.data)
      }
      ipcRenderer.on(SNAPSHOT_CHANGED_CHANNEL, forward)
      return () => {
        ipcRenderer.removeListener(SNAPSHOT_CHANGED_CHANNEL, forward)
      }
    },
  }
}
