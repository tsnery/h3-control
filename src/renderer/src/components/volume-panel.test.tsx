import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { HeadsetSnapshot } from '../../../shared/headset-types'
import { IpcErrorCode } from '../../../shared/ipc-contract'
import type { VolumeReading } from '../../../shared/volume-types'
import { VOLUME_REFRESH_MS } from '../api/headset-queries'
import { App } from '../app'
import { COPY } from '../copy/pt-br'
import { createFakeBridge } from '../test/fake-bridge'
import { VOLUME_DEBOUNCE_MS } from './use-volume-slider'

const SNAPSHOT: HeadsetSnapshot = {
  status: 'searching',
  readOnly: null,
  name: null,
  firmwareVersion: null,
  battery: null,
  gameMode: null,
  anc: null,
  eq: null,
}

const READING: VolumeReading = { percent: 40, muted: false, endpointName: 'QCY H3' }

function renderApp(reading: VolumeReading | null) {
  const bridge = createFakeBridge(SNAPSHOT, reading)
  window.qcy = bridge
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const view = render(
    <QueryClientProvider client={client}>
      <App />
    </QueryClientProvider>,
  )
  return { bridge, unmount: view.unmount }
}

type Bridge = ReturnType<typeof renderApp>['bridge']

const volumeSets = (bridge: Bridge) => bridge.calls.filter((call) => call.channel === 'volume:set')
const slider = () => screen.findByRole('slider', { name: COPY.volume.title })
const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms))

afterEach(() => {
  vi.useRealTimers()
})

describe('volume panel', () => {
  it('shows the H3 volume and sends changes after a short pause', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const { bridge } = renderApp(READING)
    const control = await slider()
    expect(control).toHaveValue(String(READING.percent))

    fireEvent.change(control, { target: { value: '50' } })
    fireEvent.change(control, { target: { value: '60' } })
    await advance(VOLUME_DEBOUNCE_MS - 1)
    expect(volumeSets(bridge)).toHaveLength(0)

    await advance(1)
    expect(volumeSets(bridge)).toEqual([{ channel: 'volume:set', input: { percent: 60 } }])
    await waitFor(() => expect(control).toHaveValue('60'))
  })

  describe('while the user is dragging', () => {
    const STALE_PERCENT = 10
    const DRAGGED_PERCENT = 70
    const SLOW_SET_MS = 10 * VOLUME_REFRESH_MS
    const DRAG_STEP_MS = 100

    const volumeReads = (bridge: Bridge) =>
      bridge.calls.filter((call) => call.channel === 'volume:get').length

    it('ignores refetched readings while the set is still pending', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
      const { bridge } = renderApp(READING)
      const control = await slider()
      bridge.delayResponses('volume:set', SLOW_SET_MS)
      fireEvent.change(control, { target: { value: String(DRAGGED_PERCENT) } })
      await advance(VOLUME_DEBOUNCE_MS)
      expect(volumeSets(bridge)).toHaveLength(1)

      bridge.setVolumeReading({ ...READING, percent: STALE_PERCENT })
      const readsBefore = volumeReads(bridge)
      await advance(VOLUME_REFRESH_MS + DRAG_STEP_MS)

      expect(volumeReads(bridge)).toBeGreaterThan(readsBefore)
      expect(control).toHaveValue(String(DRAGGED_PERCENT))
    })

    it('ignores refetched readings before the debounced set is sent', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
      const { bridge } = renderApp(READING)
      const control = await slider()
      bridge.setVolumeReading({ ...READING, percent: STALE_PERCENT })
      const readsBefore = volumeReads(bridge)

      const steps = Math.ceil(VOLUME_REFRESH_MS / DRAG_STEP_MS) + 1
      for (let step = 1; step <= steps; step += 1) {
        fireEvent.change(control, { target: { value: String(step) } })
        await advance(DRAG_STEP_MS)
      }

      expect(volumeSets(bridge)).toHaveLength(0)
      expect(volumeReads(bridge)).toBeGreaterThan(readsBefore)
      expect(control).toHaveValue(String(steps))
    })
  })

  it('shows volume changed in the Windows mixer', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const { bridge } = renderApp(READING)
    const control = await slider()
    bridge.setVolumeReading({ ...READING, percent: 25 })
    await advance(VOLUME_REFRESH_MS)
    await waitFor(() => expect(control).toHaveValue('25'))
  })

  it('sends nothing when unmounted before the pause ends', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const { bridge, unmount } = renderApp(READING)
    fireEvent.change(await slider(), { target: { value: '55' } })
    unmount()
    await advance(VOLUME_DEBOUNCE_MS * 2)
    expect(volumeSets(bridge)).toHaveLength(0)
  })

  it('shows the error text when the volume change fails', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const { bridge } = renderApp(READING)
    bridge.failNext('volume:set', IpcErrorCode.OutputUnavailable)
    fireEvent.change(await slider(), { target: { value: '55' } })
    await advance(VOLUME_DEBOUNCE_MS)
    expect(await screen.findByRole('alert')).toHaveTextContent(COPY.errors['output-unavailable'])
  })

  it('keeps an empty status region ready before the H3 stops being the output', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const { bridge } = renderApp(READING)
    await slider()
    const region = screen.getByRole('region', { name: COPY.volume.title }).querySelector('p')
    expect(region).toBeEmptyDOMElement()

    bridge.setVolumeReading(null)
    await advance(VOLUME_REFRESH_MS)
    await waitFor(() => expect(region).toHaveTextContent(COPY.errors['output-unavailable']))
  })

  it('explains when the H3 is not the audio output', async () => {
    renderApp(null)
    expect(await screen.findByText(COPY.errors['output-unavailable'])).toBeInTheDocument()
    expect(screen.queryByRole('slider', { name: COPY.volume.title })).not.toBeInTheDocument()
  })
})
