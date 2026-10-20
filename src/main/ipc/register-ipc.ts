import type { IpcMainInvokeEvent } from 'electron'
import type { z } from 'zod'
import type { HeadsetSnapshot } from '../../shared/headset-types'
import {
  IPC_CHANNELS,
  type IpcChannel,
  IpcErrorCode,
  type IpcMainLike,
  type IpcResult,
  isIpcChannel,
  SNAPSHOT_CHANGED_CHANNEL,
} from '../../shared/ipc-contract'
import { NotConnectedError, ReadOnlyError, type HeadsetService } from '../headset/headset-service'
import { RcspClosedError, RcspStatusError, RcspTimeoutError } from '../rcsp/rcsp-client'
import { VolumeEndpointUnavailableError, type VolumeControl } from '../volume/windows-volume'

export type IpcPreferences = {
  getLaunchAtLogin(): boolean
  setLaunchAtLogin(enabled: boolean): void
}

export type IpcDeps = {
  ipcMain: IpcMainLike
  isTrustedSender: (url: string) => boolean
  sendToRenderer: (channel: typeof SNAPSHOT_CHANGED_CHANNEL, snapshot: HeadsetSnapshot) => void
  headset: HeadsetService
  volume: VolumeControl
  preferences: IpcPreferences
}

type ErrorClass = abstract new (...args: never[]) => Error

const ERROR_MESSAGES: Record<IpcErrorCode, string> = {
  [IpcErrorCode.NotConnected]: 'Headset is not connected',
  [IpcErrorCode.ReadOnly]: 'Headset is read-only',
  [IpcErrorCode.InvalidInput]: 'Invalid input',
  [IpcErrorCode.DeviceRejected]: 'Headset rejected the command',
  [IpcErrorCode.Timeout]: 'Headset did not answer in time',
  [IpcErrorCode.OutputUnavailable]: 'The headset is not the active audio output',
  [IpcErrorCode.Unknown]: 'Something went wrong',
}

const ERROR_CODE_BY_CLASS: ReadonlyArray<readonly [ErrorClass, IpcErrorCode]> = [
  [NotConnectedError, IpcErrorCode.NotConnected],
  [RcspClosedError, IpcErrorCode.NotConnected],
  [ReadOnlyError, IpcErrorCode.ReadOnly],
  [RcspTimeoutError, IpcErrorCode.Timeout],
  [RcspStatusError, IpcErrorCode.DeviceRejected],
  [VolumeEndpointUnavailableError, IpcErrorCode.OutputUnavailable],
  [RangeError, IpcErrorCode.InvalidInput],
]

function failure(code: IpcErrorCode): IpcResult<never> {
  return { ok: false, error: { code, message: ERROR_MESSAGES[code] } }
}

function mapError(error: unknown): IpcResult<never> {
  const match = ERROR_CODE_BY_CLASS.find(([errorClass]) => error instanceof errorClass)
  if (match) return failure(match[1])
  console.warn('Unhandled IPC handler error', error)
  return failure(IpcErrorCode.Unknown)
}

async function settle(work: void | Promise<void>): Promise<undefined> {
  await work
  return undefined
}

type Route = (payload: unknown) => Promise<IpcResult<unknown>>

function route<Request extends z.ZodType, Response extends z.ZodType>(
  contract: { request: Request; response: Response },
  handler: (input: z.infer<Request>) => z.infer<Response> | Promise<z.infer<Response>>,
): Route {
  return async (payload) => {
    const parsed = contract.request.safeParse(payload)
    if (!parsed.success) return failure(IpcErrorCode.InvalidInput)
    try {
      return { ok: true, value: await handler(parsed.data) }
    } catch (error) {
      return mapError(error)
    }
  }
}

export function registerIpcHandlers(deps: IpcDeps): () => void {
  const { ipcMain, headset, volume, preferences } = deps
  const contracts = IPC_CHANNELS

  const routes: Record<IpcChannel, Route> = {
    'headset:get-snapshot': route(contracts['headset:get-snapshot'], () => headset.getSnapshot()),
    'headset:set-anc': route(contracts['headset:set-anc'], (setting) => settle(headset.setAnc(setting))),
    'headset:apply-eq-preset': route(contracts['headset:apply-eq-preset'], ({ presetId }) =>
      settle(headset.applyEqPreset(presetId)),
    ),
    'headset:apply-custom-eq': route(contracts['headset:apply-custom-eq'], ({ gainsDb }) =>
      settle(headset.applyCustomEq(gainsDb)),
    ),
    'headset:rename': route(contracts['headset:rename'], ({ name }) => settle(headset.rename(name))),
    'volume:get': route(contracts['volume:get'], () => volume.get()),
    'volume:set': route(contracts['volume:set'], ({ percent }) => settle(volume.set(percent))),
    'app:get-preferences': route(contracts['app:get-preferences'], () => ({
      launchAtLogin: preferences.getLaunchAtLogin(),
    })),
    'app:set-launch-at-login': route(contracts['app:set-launch-at-login'], ({ enabled }) =>
      settle(preferences.setLaunchAtLogin(enabled)),
    ),
  }

  const channels = Object.keys(routes).filter(isIpcChannel)
  for (const channel of channels) {
    ipcMain.handle(channel, async (event: IpcMainInvokeEvent, payload: unknown) => {
      const frame = event.senderFrame
      const senderUrl = frame?.url
      const isTopLevel = frame?.parent === null
      if (senderUrl === undefined || !isTopLevel || !deps.isTrustedSender(senderUrl)) {
        console.warn('Rejected IPC request from untrusted sender', senderUrl ?? 'no frame')
        return failure(IpcErrorCode.Unknown)
      }
      return await routes[channel](payload)
    })
  }
  const unsubscribe = headset.onSnapshot((snapshot) =>
    deps.sendToRenderer(SNAPSHOT_CHANGED_CHANNEL, snapshot),
  )

  return () => {
    for (const channel of channels) ipcMain.removeHandler(channel)
    unsubscribe()
  }
}
