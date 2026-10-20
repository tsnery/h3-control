import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { HeadsetSnapshot } from '../../../shared/headset-types'
import { App } from '../app'
import { COPY } from '../copy/pt-br'
import { createFakeBridge } from '../test/fake-bridge'

const SEARCHING: HeadsetSnapshot = {
  status: 'searching',
  readOnly: null,
  name: null,
  firmwareVersion: null,
  battery: null,
  gameMode: null,
  anc: null,
  eq: null,
}
const CONNECTED: HeadsetSnapshot = { ...SEARCHING, status: 'connected', name: 'QCY H3' }

const FLUSH_DELAY_MS = 50

function createGate() {
  let resolve: () => void = () => {}
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function renderApp() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <App />
    </QueryClientProvider>,
  )
}

describe('snapshot subscription', () => {
  afterEach(() => {
    Reflect.deleteProperty(window, 'qcy')
  })

  it('keeps a snapshot pushed while the first fetch is still pending', async () => {
    const bridge = createFakeBridge(SEARCHING)
    const fetchStarted = createGate()
    const releaseFetch = createGate()
    const originalInvoke = bridge.invoke.bind(bridge)
    bridge.invoke = async (channel, input) => {
      const staleResult = await originalInvoke(channel, input)
      fetchStarted.resolve()
      await releaseFetch.promise
      return staleResult
    }
    window.qcy = bridge
    renderApp()
    await fetchStarted.promise

    await act(async () => bridge.emitSnapshot(CONNECTED))
    await act(async () => releaseFetch.resolve())

    await act(async () => new Promise((done) => setTimeout(done, FLUSH_DELAY_MS)))

    expect(screen.getByText(COPY.connected)).toBeInTheDocument()
  })

  it('unsubscribes when the app unmounts', async () => {
    const bridge = createFakeBridge(SEARCHING)
    window.qcy = bridge
    const view = renderApp()
    await screen.findByText(COPY.searching)
    expect(bridge.listenerCount()).toBe(1)

    view.unmount()

    expect(bridge.listenerCount()).toBe(0)
  })
})
