import type { HeadsetSnapshot } from '../../../shared/headset-types'
import type { VolumeReading } from '../../../shared/volume-types'
import {
  type IpcChannel,
  IpcErrorCode,
  type IpcRequest,
  type IpcResponse,
  type IpcResult,
  type QcyBridge,
} from '../../../shared/ipc-contract'

interface RecordedCall {
  channel: string
  input: unknown
}

const BLE_WRITE_MS = 5

type ChannelFailureEffects = { [C in IpcChannel]?: (input: IpcRequest<C>) => Promise<void> }

interface FakeBridge extends QcyBridge {
  emitSnapshot(snapshot: HeadsetSnapshot): void
  setVolumeReading(reading: VolumeReading | null): void
  calls: RecordedCall[]
  failNext(channel: IpcChannel, code: IpcErrorCode): void
  delayResponses(channel: IpcChannel, ms: number): void
  listenerCount(): number
}

type ChannelHandlers = { [C in IpcChannel]?: (input: IpcRequest<C>) => IpcResponse<C> }

export function createFakeBridge(
  initial: HeadsetSnapshot,
  initialVolume: VolumeReading | null = null,
): FakeBridge {
  let current = initial
  let volume = initialVolume
  const listeners = new Set<(snapshot: HeadsetSnapshot) => void>()
  const pendingFailures = new Map<IpcChannel, IpcErrorCode>()
  const responseDelays = new Map<IpcChannel, number>()
  const calls: RecordedCall[] = []
  function emitSnapshot(snapshot: HeadsetSnapshot) {
    current = snapshot
    listeners.forEach((listener) => listener(snapshot))
  }
  const failureEffects: ChannelFailureEffects = {
    'headset:set-anc': async (anc) => {
      const previous = current
      emitSnapshot({ ...current, anc })
      await new Promise((resolve) => setTimeout(resolve, BLE_WRITE_MS))
      emitSnapshot(previous)
    },
  }
  const handlers: ChannelHandlers = {
    'headset:get-snapshot': () => current,
    'headset:set-anc': (anc) => {
      emitSnapshot({ ...current, anc })
      return undefined
    },
    'headset:apply-eq-preset': ({ presetId }) => {
      emitSnapshot({ ...current, eq: { kind: 'preset', presetId } })
      return undefined
    },
    'headset:apply-custom-eq': ({ gainsDb }) => {
      emitSnapshot({ ...current, eq: { kind: 'custom', gainsDb } })
      return undefined
    },
    'headset:rename': ({ name }) => {
      emitSnapshot({ ...current, name })
      return undefined
    },
    'volume:get': () => volume,
    'volume:set': ({ percent }) => {
      if (volume) volume = { ...volume, percent }
      return undefined
    },
  }

  async function invoke<C extends IpcChannel>(
    channel: C,
    input: IpcRequest<C>,
  ): Promise<IpcResult<IpcResponse<C>>> {
    calls.push({ channel, input })
    const delayMs = responseDelays.get(channel)
    if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs))
    const failure = pendingFailures.get(channel)
    if (failure) {
      pendingFailures.delete(channel)
      await failureEffects[channel]?.(input)
      return { ok: false, error: { code: failure, message: failure } }
    }
    const handler = handlers[channel]
    if (!handler) {
      const message = `fake bridge does not model channel ${channel}`
      return { ok: false, error: { code: IpcErrorCode.Unknown, message } }
    }
    return { ok: true, value: handler(input) }
  }

  return {
    invoke,
    onSnapshot(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    emitSnapshot,
    setVolumeReading(reading) {
      volume = reading
    },
    calls,
    delayResponses(channel, ms) {
      responseDelays.set(channel, ms)
    },
    failNext(channel, code) {
      pendingFailures.set(channel, code)
    },
    listenerCount: () => listeners.size,
  }
}
