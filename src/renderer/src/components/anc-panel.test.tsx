import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import {
  type AncSetting,
  DEFAULT_NOISE_CANCELLING,
  type HeadsetSnapshot,
} from '../../../shared/headset-types'
import { IpcErrorCode } from '../../../shared/ipc-contract'
import { App } from '../app'
import { COPY } from '../copy/pt-br'
import { createFakeBridge } from '../test/fake-bridge'

const CONNECTED: HeadsetSnapshot = {
  status: 'connected',
  readOnly: null,
  name: 'QCY H3',
  firmwareVersion: '0.1.2.3',
  battery: { percent: 30, charging: false },
  gameMode: null,
  anc: { mode: 'off' },
  eq: null,
}

const withAnc = (anc: AncSetting): HeadsetSnapshot => ({ ...CONNECTED, anc })

function renderApp(snapshot: HeadsetSnapshot) {
  const bridge = createFakeBridge(snapshot)
  window.qcy = bridge
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <App />
    </QueryClientProvider>,
  )
  return bridge
}

function sentSettings(bridge: ReturnType<typeof renderApp>): unknown[] {
  return bridge.calls.filter((call) => call.channel === 'headset:set-anc').map((call) => call.input)
}

describe('AncPanel', () => {
  afterEach(() => {
    Reflect.deleteProperty(window, 'qcy')
  })

  it('marks the current mode from the snapshot', async () => {
    renderApp(withAnc({ mode: 'transparency' }))

    expect(await screen.findByRole('radio', { name: COPY.anc.modes.transparency })).toBeChecked()
    expect(screen.getByRole('radio', { name: COPY.anc.modes.off })).not.toBeChecked()
  })

  it('turns on noise cancelling with the default scene', async () => {
    const bridge = renderApp(CONNECTED)

    await userEvent.click(
      await screen.findByRole('radio', { name: COPY.anc.modes['noise-cancelling'] }),
    )

    expect(sentSettings(bridge)).toEqual([
      { mode: 'noise-cancelling', scene: 'noisy', level: 'high' },
    ])
  })

  describe('scene and intensity', () => {
    it('shows intensity only for scenes that have levels', async () => {
      renderApp(withAnc({ mode: 'noise-cancelling', scene: 'noisy', level: 'low' }))

      expect(await screen.findByRole('group', { name: COPY.anc.levelGroup })).toBeInTheDocument()
      expect(screen.getByRole('group', { name: COPY.anc.sceneGroup })).toBeInTheDocument()
    })

    it.each(['adaptive', 'anti-wind'] as const)('hides intensity in %s', async (scene) => {
      renderApp(withAnc({ mode: 'noise-cancelling', scene, level: null }))

      await screen.findByRole('group', { name: COPY.anc.sceneGroup })
      expect(screen.queryByRole('group', { name: COPY.anc.levelGroup })).not.toBeInTheDocument()
    })

    it('hides scene and intensity when noise cancelling is off', async () => {
      renderApp(CONNECTED)

      await screen.findByRole('group', { name: COPY.anc.modeGroup })
      expect(screen.queryByRole('group', { name: COPY.anc.sceneGroup })).not.toBeInTheDocument()
      expect(screen.queryByRole('group', { name: COPY.anc.levelGroup })).not.toBeInTheDocument()
    })

    it('keeps the current level when picking another scene with levels', async () => {
      const bridge = renderApp(withAnc({ mode: 'noise-cancelling', scene: 'noisy', level: 'low' }))

      await userEvent.click(await screen.findByRole('radio', { name: COPY.anc.scenes.indoor }))

      expect(sentSettings(bridge)).toEqual([
        { mode: 'noise-cancelling', scene: 'indoor', level: 'low' },
      ])
    })

    it('uses high intensity when leaving a levelless scene', async () => {
      const bridge = renderApp(
        withAnc({ mode: 'noise-cancelling', scene: 'adaptive', level: null }),
      )

      await userEvent.click(await screen.findByRole('radio', { name: COPY.anc.scenes.commuting }))

      expect(sentSettings(bridge)).toEqual([
        { mode: 'noise-cancelling', scene: 'commuting', level: 'high' },
      ])
    })

    it('sends no level when picking a levelless scene', async () => {
      const bridge = renderApp(withAnc({ mode: 'noise-cancelling', scene: 'noisy', level: 'low' }))

      await userEvent.click(
        await screen.findByRole('radio', { name: COPY.anc.scenes['anti-wind'] }),
      )

      expect(sentSettings(bridge)).toEqual([
        { mode: 'noise-cancelling', scene: 'anti-wind', level: null },
      ])
    })

    it('changes only the level when picking an intensity', async () => {
      const bridge = renderApp(
        withAnc({ mode: 'noise-cancelling', scene: 'commuting', level: 'low' }),
      )

      await userEvent.click(await screen.findByRole('radio', { name: COPY.anc.levels.medium }))

      expect(sentSettings(bridge)).toEqual([
        { mode: 'noise-cancelling', scene: 'commuting', level: 'medium' },
      ])
    })
  })

  it('can be operated with the keyboard alone', async () => {
    const bridge = renderApp(CONNECTED)
    const group = await screen.findByRole('group', { name: COPY.anc.modeGroup })
    const user = userEvent.setup()

    within(group).getByRole('radio', { name: COPY.anc.modes.off }).focus()
    await user.keyboard('{ArrowDown}')

    expect(within(group).getByRole('radio', { name: COPY.anc.modes.transparency })).toHaveFocus()
    expect(sentSettings(bridge)).toEqual([{ mode: 'transparency' }])
  })

  it('follows the snapshot pushed by the main process', async () => {
    const bridge = renderApp(CONNECTED)
    await screen.findByRole('radio', { name: COPY.anc.modes.off })

    await act(async () => bridge.emitSnapshot(withAnc({ mode: 'transparency' })))

    await waitFor(() =>
      expect(screen.getByRole('radio', { name: COPY.anc.modes.transparency })).toBeChecked(),
    )
  })

  describe('disabled states', () => {
    it.each([
      ['searching', { ...CONNECTED, status: 'searching' as const }],
      ['reconnecting', { ...CONNECTED, status: 'reconnecting' as const }],
      ['read-only', { ...CONNECTED, readOnly: 'unexpected-vendor' as const }],
    ])('disables every option when %s', async (_name, snapshot) => {
      renderApp({ ...snapshot, anc: DEFAULT_NOISE_CANCELLING })
      await screen.findByRole('group', { name: COPY.anc.modeGroup })

      const radios = screen.getAllByRole('radio')

      expect(radios.length).toBeGreaterThan(3)
      radios.forEach((radio) => expect(radio).toBeDisabled())
    })
  })

  it('moves the checked radio after a click once the main process pushes', async () => {
    renderApp(CONNECTED)

    await userEvent.click(await screen.findByRole('radio', { name: COPY.anc.modes.transparency }))

    await waitFor(() =>
      expect(screen.getByRole('radio', { name: COPY.anc.modes.transparency })).toBeChecked(),
    )
  })

  it('sends each arrow step in order and ends on the last choice', async () => {
    const bridge = renderApp(CONNECTED)
    const user = userEvent.setup()
    await screen.findByRole('radio', { name: COPY.anc.modes.off })

    screen.getByRole('radio', { name: COPY.anc.modes.off }).focus()
    await user.keyboard('{ArrowDown}{ArrowDown}{ArrowUp}')

    expect(sentSettings(bridge)).toEqual([
      { mode: 'transparency' },
      DEFAULT_NOISE_CANCELLING,
      { mode: 'transparency' },
    ])
    await waitFor(() =>
      expect(screen.getByRole('radio', { name: COPY.anc.modes.transparency })).toBeChecked(),
    )
  })

  describe('errors', () => {
    it('shows the error when main pushes the optimistic value and then reverts it', async () => {
      const bridge = renderApp(CONNECTED)
      bridge.failNext('headset:set-anc', IpcErrorCode.NotConnected)

      await userEvent.click(await screen.findByRole('radio', { name: COPY.anc.modes.transparency }))

      expect(await screen.findByText(COPY.errors['not-connected'])).toBeInTheDocument()
      expect(screen.getByRole('button', { name: COPY.retry })).toBeInTheDocument()
    })

    it('disables retry while disconnected or read-only', async () => {
      const bridge = renderApp(CONNECTED)
      bridge.failNext('headset:set-anc', IpcErrorCode.Timeout)
      await userEvent.click(await screen.findByRole('radio', { name: COPY.anc.modes.transparency }))
      const retry = await screen.findByRole('button', { name: COPY.retry })

      await act(async () => bridge.emitSnapshot({ ...CONNECTED, status: 'reconnecting' }))
      await waitFor(() => expect(retry).toBeDisabled())

      await act(async () => bridge.emitSnapshot({ ...CONNECTED, readOnly: 'unexpected-vendor' }))
      await waitFor(() => expect(retry).toBeDisabled())
    })

    it('hides the error once the pushed snapshot matches the attempted setting', async () => {
      const bridge = renderApp(CONNECTED)
      bridge.failNext('headset:set-anc', IpcErrorCode.Timeout)
      await userEvent.click(await screen.findByRole('radio', { name: COPY.anc.modes.transparency }))
      await screen.findByRole('alert')

      await act(async () => bridge.emitSnapshot(withAnc({ mode: 'transparency' })))

      await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
      expect(screen.queryByRole('button', { name: COPY.retry })).not.toBeInTheDocument()
    })

    it('keeps the error and retry when the pushed snapshot reverts to the old value', async () => {
      const bridge = renderApp(CONNECTED)
      bridge.failNext('headset:set-anc', IpcErrorCode.Timeout)
      await userEvent.click(await screen.findByRole('radio', { name: COPY.anc.modes.transparency }))
      await screen.findByRole('alert')

      await act(async () => bridge.emitSnapshot(withAnc({ mode: 'off' })))

      expect(screen.getByRole('alert')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: COPY.retry })).toBeEnabled()
    })

    it('shows the error and a retry when the headset rejects the change', async () => {
      const bridge = renderApp(CONNECTED)
      bridge.failNext('headset:set-anc', IpcErrorCode.NotConnected)

      await userEvent.click(await screen.findByRole('radio', { name: COPY.anc.modes.transparency }))

      expect(await screen.findByText(COPY.errors['not-connected'])).toBeInTheDocument()
      expect(screen.getByRole('button', { name: COPY.retry })).toBeInTheDocument()
    })

    it('re-sends the last attempted setting on retry and clears the error', async () => {
      const bridge = renderApp(CONNECTED)
      bridge.failNext('headset:set-anc', IpcErrorCode.Timeout)
      await userEvent.click(await screen.findByRole('radio', { name: COPY.anc.modes.transparency }))

      await userEvent.click(await screen.findByRole('button', { name: COPY.retry }))

      await waitFor(() => expect(screen.queryByText(COPY.errors.timeout)).not.toBeInTheDocument())
      expect(sentSettings(bridge)).toEqual([{ mode: 'transparency' }, { mode: 'transparency' }])
    })

    it('announces the error apart from the connection status region', async () => {
      const bridge = renderApp(CONNECTED)
      bridge.failNext('headset:set-anc', IpcErrorCode.DeviceRejected)

      await userEvent.click(await screen.findByRole('radio', { name: COPY.anc.modes.transparency }))

      expect(await screen.findByRole('alert')).toHaveTextContent(COPY.errors['device-rejected'])
      const connectionStatus = screen.getByText(COPY.connected)
      expect(connectionStatus).toHaveAttribute('aria-live', 'polite')
      expect(connectionStatus).not.toHaveTextContent(COPY.errors['device-rejected'])
    })
  })
})
