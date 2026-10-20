import type { IpcMainInvokeEvent } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HeadsetSnapshot } from '../../shared/headset-types'
import {
  IPC_CHANNELS,
  type IpcChannel,
  IpcErrorCode,
  type IpcMainLike,
  type IpcResult,
  SNAPSHOT_CHANGED_CHANNEL,
} from '../../shared/ipc-contract'
import { type HeadsetService, NotConnectedError, ReadOnlyError } from '../headset/headset-service'
import { RcspClosedError, RcspStatusError, RcspTimeoutError } from '../rcsp/rcsp-client'
import { type VolumeControl, VolumeEndpointUnavailableError } from '../volume/windows-volume'
import { registerIpcHandlers } from './register-ipc'

const TRUSTED_URL = 'app://renderer/index.html'
const SNAPSHOT: HeadsetSnapshot = {
  status: 'connected',
  readOnly: null,
  name: 'QCY H3',
  firmwareVersion: '1.0.0',
  battery: { percent: 80, charging: false },
  gameMode: null,
  anc: { mode: 'off' },
  eq: { kind: 'preset', presetId: 1 },
}
const VALID_GAINS = [0, 1, 2, 3, 4, 5, 6, 7, 8, -8]

type Handler = (event: IpcMainInvokeEvent, payload: unknown) => Promise<IpcResult<unknown>>

function createHarness() {
  const handlers = new Map<string, Handler>()
  const ipcMain: IpcMainLike = {
    handle: vi.fn((channel: string, handler: Handler) => {
      handlers.set(channel, handler)
    }),
    removeHandler: vi.fn((channel: string) => {
      handlers.delete(channel)
    }),
  }
  const unsubscribe = vi.fn()
  let snapshotListener: (snapshot: HeadsetSnapshot) => void = () => undefined
  const headset: HeadsetService = {
    start: vi.fn(),
    stop: vi.fn(async () => undefined),
    getSnapshot: vi.fn(() => SNAPSHOT),
    onSnapshot: vi.fn((listener) => {
      snapshotListener = listener
      return unsubscribe
    }),
    setAnc: vi.fn(async () => undefined),
    applyEqPreset: vi.fn(async () => undefined),
    applyCustomEq: vi.fn(async () => undefined),
    rename: vi.fn(async () => undefined),
  }
  const volume: VolumeControl = {
    get: vi.fn(async () => ({ percent: 40, muted: false, endpointName: 'QCY H3' })),
    set: vi.fn(async () => undefined),
    dispose: vi.fn(),
  }
  const preferences = { getLaunchAtLogin: vi.fn(() => true), setLaunchAtLogin: vi.fn() }
  const sendToRenderer = vi.fn()
  const isTrustedSender = vi.fn((url: string) => url === TRUSTED_URL)
  const dispose = registerIpcHandlers({
    ipcMain,
    isTrustedSender,
    sendToRenderer,
    headset,
    volume,
    preferences,
  })

  async function call(
    channel: IpcChannel,
    payload?: unknown,
    url: string | null = TRUSTED_URL,
    parent: object | null = null,
  ) {
    const handler = handlers.get(channel)
    if (!handler) throw new Error(`No handler for ${channel}`)
    const event = { senderFrame: url === null ? null : { url, parent } } as unknown as IpcMainInvokeEvent
    return await handler(event, payload)
  }

  return {
    call,
    dispose,
    handlers,
    headset,
    volume,
    preferences,
    sendToRenderer,
    unsubscribe,
    isTrustedSender,
    emitSnapshot: (snapshot: HeadsetSnapshot) => snapshotListener(snapshot),
  }
}

function expectErrorCode(result: IpcResult<unknown>, code: IpcErrorCode) {
  expect(result).toMatchObject({ ok: false, error: { code } })
}

describe('untrusted senders', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('logs the sender url of a rejected request', async () => {
    const harness = createHarness()
    await harness.call('volume:get', undefined, 'https://evil.example')
    expect(console.warn).toHaveBeenCalledWith(expect.any(String), 'https://evil.example')
  })

  it('logs a missing frame as no frame', async () => {
    const harness = createHarness()
    await harness.call('volume:get', undefined, null)
    expect(console.warn).toHaveBeenCalledWith(expect.any(String), 'no frame')
  })

  it('rejects requests from untrusted senders without calling the service', async () => {
    const harness = createHarness()
    const result = await harness.call('headset:set-anc', { mode: 'off' }, 'https://evil.example')
    expectErrorCode(result, IpcErrorCode.Unknown)
    expect(harness.headset.setAnc).not.toHaveBeenCalled()
  })

  it('rejects requests from a subframe even at a trusted url', async () => {
    const harness = createHarness()
    const result = await harness.call('volume:set', { percent: 10 }, TRUSTED_URL, { url: TRUSTED_URL })
    expectErrorCode(result, IpcErrorCode.Unknown)
    expect(harness.volume.set).not.toHaveBeenCalled()
  })

  it('rejects requests that carry no sender frame', async () => {
    const harness = createHarness()
    const result = await harness.call('volume:set', { percent: 10 }, null)
    expectErrorCode(result, IpcErrorCode.Unknown)
    expect(harness.volume.set).not.toHaveBeenCalled()
    expect(harness.isTrustedSender).not.toHaveBeenCalled()
  })

  it('checks the url of the sender frame', async () => {
    const harness = createHarness()
    await harness.call('volume:get')
    expect(harness.isTrustedSender).toHaveBeenCalledWith(TRUSTED_URL)
  })
})

describe('request validation', () => {
  it('returns invalid-input for a custom EQ with the wrong band count', async () => {
    const harness = createHarness()
    const result = await harness.call('headset:apply-custom-eq', { gainsDb: [0, 0, 0, 0, 0, 0, 0, 0, 0] })
    expectErrorCode(result, IpcErrorCode.InvalidInput)
    expect(harness.headset.applyCustomEq).not.toHaveBeenCalled()
  })

  it('returns invalid-input for a volume above 100', async () => {
    const harness = createHarness()
    const result = await harness.call('volume:set', { percent: 101 })
    expectErrorCode(result, IpcErrorCode.InvalidInput)
    expect(harness.volume.set).not.toHaveBeenCalled()
  })

  it('returns invalid-input for an invalid rename without calling the service', async () => {
    const harness = createHarness()
    expectErrorCode(await harness.call('headset:rename', { name: '   ' }), IpcErrorCode.InvalidInput)
    expectErrorCode(
      await harness.call('headset:rename', { name: 'x'.repeat(40) }),
      IpcErrorCode.InvalidInput,
    )
    expect(harness.headset.rename).not.toHaveBeenCalled()
  })
})

describe('error mapping', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  const cases: ReadonlyArray<readonly [string, Error, IpcErrorCode]> = [
    ['NotConnectedError', new NotConnectedError(), IpcErrorCode.NotConnected],
    ['RcspClosedError', new RcspClosedError(), IpcErrorCode.NotConnected],
    ['ReadOnlyError', new ReadOnlyError(), IpcErrorCode.ReadOnly],
    ['RcspTimeoutError', new RcspTimeoutError(), IpcErrorCode.Timeout],
    ['RcspStatusError', new RcspStatusError(1), IpcErrorCode.DeviceRejected],
    ['RangeError', new RangeError('gain out of range'), IpcErrorCode.InvalidInput],
  ]

  it.each(cases)('maps %s to its error code', async (_name, error, code) => {
    const harness = createHarness()
    vi.mocked(harness.headset.setAnc).mockRejectedValue(error)
    expectErrorCode(await harness.call('headset:set-anc', { mode: 'off' }), code)
  })

  it('maps VolumeEndpointUnavailableError from volume:set to output-unavailable', async () => {
    const harness = createHarness()
    vi.mocked(harness.volume.set).mockRejectedValue(new VolumeEndpointUnavailableError())
    expectErrorCode(await harness.call('volume:set', { percent: 30 }), IpcErrorCode.OutputUnavailable)
  })

  it('hides internal error text from unknown errors and logs the original in main', async () => {
    const harness = createHarness()
    const internal = new Error('C:\\secret\\path exploded')
    vi.mocked(harness.headset.setAnc).mockRejectedValue(internal)
    const result = await harness.call('headset:set-anc', { mode: 'off' })
    expectErrorCode(result, IpcErrorCode.Unknown)
    expect(JSON.stringify(result)).not.toContain('secret')
    expect(console.warn).toHaveBeenCalledWith(expect.any(String), internal)
  })
})

describe('successful calls', () => {
  it('forwards each request to the service and returns responses matching the contract', async () => {
    const harness = createHarness()
    const calls: ReadonlyArray<readonly [IpcChannel, unknown]> = [
      ['headset:get-snapshot', undefined],
      ['headset:set-anc', { mode: 'noise-cancelling', scene: 'adaptive', level: 'high' }],
      ['headset:apply-eq-preset', { presetId: 3 }],
      ['headset:apply-custom-eq', { gainsDb: VALID_GAINS }],
      ['headset:rename', { name: 'Meu H3' }],
      ['volume:get', undefined],
      ['volume:set', { percent: 55 }],
      ['app:get-preferences', undefined],
      ['app:set-launch-at-login', { enabled: false }],
    ]
    for (const [channel, payload] of calls) {
      const result = await harness.call(channel, payload)
      expect(result.ok).toBe(true)
      if (!result.ok) continue
      expect(IPC_CHANNELS[channel].response.safeParse(result.value).success).toBe(true)
    }
    expect(harness.headset.setAnc).toHaveBeenCalledWith({
      mode: 'noise-cancelling',
      scene: 'adaptive',
      level: 'high',
    })
    expect(harness.headset.applyEqPreset).toHaveBeenCalledWith(3)
    expect(harness.headset.applyCustomEq).toHaveBeenCalledWith(VALID_GAINS)
    expect(harness.headset.rename).toHaveBeenCalledWith('Meu H3')
    expect(harness.volume.set).toHaveBeenCalledWith(55)
    expect(harness.preferences.setLaunchAtLogin).toHaveBeenCalledWith(false)
  })

  it('returns null from volume:get when the H3 is not the active output', async () => {
    const harness = createHarness()
    vi.mocked(harness.volume.get).mockResolvedValue(null)
    expect(await harness.call('volume:get')).toEqual({ ok: true, value: null })
  })
})

describe('snapshot forwarding and disposal', () => {
  it('forwards snapshot changes to the renderer', () => {
    const harness = createHarness()
    harness.emitSnapshot(SNAPSHOT)
    expect(harness.sendToRenderer).toHaveBeenCalledWith(SNAPSHOT_CHANGED_CHANNEL, SNAPSHOT)
  })

  it('removes every handler and the snapshot subscription on dispose', () => {
    const harness = createHarness()
    harness.dispose()
    expect(harness.handlers.size).toBe(0)
    expect(harness.unsubscribe).toHaveBeenCalledTimes(1)
  })
})
