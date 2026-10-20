import type { IpcRendererEvent } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import type { HeadsetSnapshot } from '../shared/headset-types'
import { type IpcChannel, IpcErrorCode, SNAPSHOT_CHANGED_CHANNEL } from '../shared/ipc-contract'
import { createQcyBridge, type IpcRendererLike } from './create-qcy-bridge'

const SNAPSHOT: HeadsetSnapshot = {
  status: 'connected',
  readOnly: null,
  name: 'QCY H3',
  firmwareVersion: null,
  battery: null,
  anc: null,
  eq: null,
}

type Listener = (event: IpcRendererEvent, payload: unknown) => void

function createHarness() {
  const listeners = new Set<Listener>()
  const ipcRenderer: IpcRendererLike = {
    invoke: vi.fn(async (): Promise<unknown> => ({ ok: true, value: undefined })),
    on: vi.fn((_channel: string, listener: Listener) => {
      listeners.add(listener)
      return ipcRenderer
    }),
    removeListener: vi.fn((_channel: string, listener: Listener) => {
      listeners.delete(listener)
      return ipcRenderer
    }),
  }
  const emit = (payload: unknown) => {
    for (const listener of listeners) listener({} as IpcRendererEvent, payload)
  }
  return { ipcRenderer, bridge: createQcyBridge(ipcRenderer), listeners, emit }
}

describe('invoke', () => {
  it('forwards contract channels to ipcRenderer', async () => {
    const { ipcRenderer, bridge } = createHarness()
    const result = await bridge.invoke('volume:set', { percent: 20 })
    expect(ipcRenderer.invoke).toHaveBeenCalledWith('volume:set', { percent: 20 })
    expect(result).toEqual({ ok: true, value: undefined })
  })

  it('rejects a non-string channel such as an array without calling ipcRenderer', async () => {
    const { ipcRenderer, bridge } = createHarness()
    const result = await bridge.invoke(['volume:set'] as unknown as IpcChannel, { percent: 1 })
    expect(result).toMatchObject({ ok: false, error: { code: IpcErrorCode.InvalidInput } })
    expect(ipcRenderer.invoke).not.toHaveBeenCalled()
  })

  it('turns a malformed main response into an unknown error', async () => {
    const { ipcRenderer, bridge } = createHarness()
    vi.mocked(ipcRenderer.invoke).mockResolvedValue({ ok: true, value: { percent: 'loud' } })
    const result = await bridge.invoke('volume:get', undefined)
    expect(result).toMatchObject({ ok: false, error: { code: IpcErrorCode.Unknown } })
  })

  it('turns a response that is not a result envelope into an unknown error', async () => {
    const { ipcRenderer, bridge } = createHarness()
    vi.mocked(ipcRenderer.invoke).mockResolvedValue('nonsense')
    const result = await bridge.invoke('volume:set', { percent: 5 })
    expect(result).toMatchObject({ ok: false, error: { code: IpcErrorCode.Unknown } })
  })

  it('turns a rejected invoke into an unknown error instead of throwing', async () => {
    const { ipcRenderer, bridge } = createHarness()
    vi.mocked(ipcRenderer.invoke).mockRejectedValue(new Error('boom'))
    const result = await bridge.invoke('volume:set', { percent: 5 })
    expect(result).toMatchObject({ ok: false, error: { code: IpcErrorCode.Unknown } })
  })

  it('passes through error results from main', async () => {
    const { ipcRenderer, bridge } = createHarness()
    const error = { code: IpcErrorCode.Timeout, message: 'slow' }
    vi.mocked(ipcRenderer.invoke).mockResolvedValue({ ok: false, error })
    expect(await bridge.invoke('volume:set', { percent: 5 })).toEqual({ ok: false, error })
  })

  it('rejects channels outside the contract without calling ipcRenderer', async () => {
    const { ipcRenderer, bridge } = createHarness()
    const result = await bridge.invoke('shell:open' as IpcChannel, undefined)
    expect(result).toMatchObject({ ok: false, error: { code: IpcErrorCode.InvalidInput } })
    expect(ipcRenderer.invoke).not.toHaveBeenCalled()
  })
})

describe('onSnapshot', () => {
  it('delivers valid snapshots to the listener', () => {
    const { bridge, emit } = createHarness()
    const listener = vi.fn()
    bridge.onSnapshot(listener)
    emit(SNAPSHOT)
    expect(listener).toHaveBeenCalledWith(SNAPSHOT)
  })

  it('drops payloads that are not valid snapshots', () => {
    const { bridge, emit } = createHarness()
    const listener = vi.fn()
    bridge.onSnapshot(listener)
    emit({ status: 'exploded' })
    emit(null)
    expect(listener).not.toHaveBeenCalled()
  })

  it('unsubscribes exactly its own ipcRenderer listener', () => {
    const { ipcRenderer, bridge, listeners, emit } = createHarness()
    const first = vi.fn()
    const second = vi.fn()
    const unsubscribeFirst = bridge.onSnapshot(first)
    bridge.onSnapshot(second)
    unsubscribeFirst()
    expect(ipcRenderer.removeListener).toHaveBeenCalledTimes(1)
    expect(vi.mocked(ipcRenderer.removeListener).mock.calls[0]?.[0]).toBe(SNAPSHOT_CHANGED_CHANNEL)
    expect(listeners.size).toBe(1)
    emit(SNAPSHOT)
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
  })
})
