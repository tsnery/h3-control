import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { HeadsetSnapshot } from '../../../shared/headset-types'
import { App } from '../app'
import { COPY } from '../copy/pt-br'
import { createFakeBridge } from '../test/fake-bridge'

const CONNECTED: HeadsetSnapshot = {
  status: 'connected',
  readOnly: null,
  name: 'QCY H3',
  firmwareVersion: '0.1.2.3',
  battery: { percent: 30, charging: false },
  anc: null,
  eq: null,
}

const SEARCHING: HeadsetSnapshot = {
  status: 'searching',
  readOnly: null,
  name: null,
  firmwareVersion: null,
  battery: null,
  anc: null,
  eq: null,
}

function renderHeader(snapshot: HeadsetSnapshot) {
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

describe('ConnectionHeader', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })
  afterEach(() => {
    Reflect.deleteProperty(window, 'qcy')
  })

  it('shows name, connection, battery and firmware when connected', async () => {
    renderHeader(CONNECTED)

    expect(await screen.findByText('QCY H3')).toBeInTheDocument()
    expect(screen.getByText(COPY.connected)).toBeInTheDocument()
    expect(screen.getByText(COPY.battery(30))).toBeInTheDocument()
    expect(screen.getByText(COPY.firmware('0.1.2.3'))).toBeInTheDocument()
  })

  it('shows help while searching', async () => {
    renderHeader(SEARCHING)

    expect(await screen.findByText(COPY.noHeadsetHelp)).toBeInTheDocument()
    expect(screen.getByText(COPY.searching)).toBeInTheDocument()
  })

  it('shows the read-only explanation', async () => {
    renderHeader({ ...CONNECTED, readOnly: 'unexpected-vendor' })

    expect(await screen.findByText(COPY.readOnly.unexpectedVendor)).toBeInTheDocument()
  })

  it('shows the charging state next to the battery', async () => {
    renderHeader({ ...CONNECTED, battery: { percent: 80, charging: true } })

    expect(await screen.findByText(`${COPY.battery(80)} (${COPY.charging})`)).toBeInTheDocument()
  })

  it('announces connection changes politely', async () => {
    const bridge = renderHeader(SEARCHING)
    const region = await screen.findByText(COPY.searching)
    expect(region).toHaveAttribute('aria-live', 'polite')

    await act(async () => bridge.emitSnapshot(CONNECTED))

    await waitFor(() => expect(region).toHaveTextContent(COPY.connected))
  })

  it('updates the displayed battery when a live snapshot arrives', async () => {
    const bridge = renderHeader(CONNECTED)
    await screen.findByText(COPY.battery(30))

    await act(async () =>
      bridge.emitSnapshot({ ...CONNECTED, battery: { percent: 55, charging: false } }),
    )

    expect(await screen.findByText(COPY.battery(55))).toBeInTheDocument()
  })
})
