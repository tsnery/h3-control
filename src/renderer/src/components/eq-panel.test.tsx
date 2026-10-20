import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import {
  CUSTOM_EQ_BAND_COUNT,
  CUSTOM_EQ_FREQUENCIES_HZ,
  EQ_GAIN_LIMIT_DB,
  type EqState,
  type HeadsetSnapshot,
} from '../../../shared/headset-types'
import { IpcErrorCode } from '../../../shared/ipc-contract'
import { App } from '../app'
import { COPY } from '../copy/pt-br'
import { createFakeBridge } from '../test/fake-bridge'
import { clampGain, formatFrequency, formatGain } from './eq-slider'

const CONNECTED: HeadsetSnapshot = {
  status: 'connected',
  readOnly: null,
  name: 'QCY H3',
  firmwareVersion: '0.1.2.3',
  battery: { percent: 30, charging: false },
  gameMode: null,
  anc: { mode: 'off' },
  eq: { kind: 'preset', presetId: 1 },
}

const SLOW_WRITE_MS = 50
const CUSTOM_GAINS = [0, 1, 2, 3, 0, -1, -2, -3, 0, 8]
const DEFAULT_CURVE_ON_SLIDERS = [3, -8, 1, 0, 3, 3, 2, 3, 0, 0]
const POP_CURVE_ON_SLIDERS = [-3, -8, 1, -1, 2, 4, 0, 3, 0, 0]

const withEq = (eq: EqState | null): HeadsetSnapshot => ({ ...CONNECTED, eq })

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

function eqCalls(bridge: ReturnType<typeof renderApp>) {
  return bridge.calls.filter((call) => call.channel.startsWith('headset:apply-'))
}

const presetSelect = () => screen.findByRole('combobox', { name: COPY.eq.presetLabel })
const slider = (frequencyHz: number) =>
  screen.getByRole('slider', { name: formatFrequency(frequencyHz) })

function expectSliders(gainsDb: readonly number[]) {
  CUSTOM_EQ_FREQUENCIES_HZ.forEach((hz, band) =>
    expect(slider(hz)).toHaveValue(String(gainsDb[band])),
  )
}

describe('formatFrequency', () => {
  it.each([
    [55, '55 Hz'],
    [500, '500 Hz'],
    [1000, '1 kHz'],
    [1800, '1,8 kHz'],
    [10000, '10 kHz'],
    [22000, '22 kHz'],
  ])('formats %i Hz as %s', (hz, text) => {
    expect(formatFrequency(hz)).toBe(text)
  })
})

describe('formatGain', () => {
  it.each([
    [3, '+3 dB'],
    [0, '0 dB'],
    [-2, '−2 dB'],
    [8, '+8 dB'],
    [-8, '−8 dB'],
    [-0, '0 dB'],
    [3.5, '+3,5 dB'],
    [-12, '−12 dB'],
  ])('formats %d as %s', (db, text) => {
    expect(formatGain(db)).toBe(text)
  })
})

describe('clampGain', () => {
  it.each([
    [12, 8],
    [-12, -8],
    [3, 3],
    [2.6, 3],
    [-8, -8],
  ])('clamps %d to %d', (gain, expected) => {
    expect(clampGain(gain)).toBe(expected)
  })
})

describe('EqPanel', () => {
  afterEach(() => {
    Reflect.deleteProperty(window, 'qcy')
  })

  it('selects the preset reported by the headset', async () => {
    renderApp(withEq({ kind: 'preset', presetId: 4 }))

    expect(await presetSelect()).toHaveDisplayValue(COPY.eq.presets[4])
  })

  it('offers the six official presets and Personalizado', async () => {
    renderApp(CONNECTED)
    const select = await presetSelect()

    const names = Array.from(select.querySelectorAll('option'), (option) => option.textContent)

    expect(names).toEqual([...Object.values(COPY.eq.presets), COPY.eq.custom])
  })

  it('selects Personalizado when the headset reports a custom curve', async () => {
    renderApp(withEq({ kind: 'custom', gainsDb: CUSTOM_GAINS }))

    expect(await presetSelect()).toHaveDisplayValue(COPY.eq.custom)
    CUSTOM_EQ_FREQUENCIES_HZ.forEach((hz, band) =>
      expect(slider(hz)).toHaveValue(String(CUSTOM_GAINS[band])),
    )
  })

  it('asks for a profile when the headset reports none', async () => {
    renderApp(withEq(null))

    expect(await presetSelect()).toHaveDisplayValue(COPY.eq.chooseProfile)
    expect(screen.getByRole('button', { name: COPY.eq.apply })).toBeDisabled()
  })

  it('applies a preset only after Aplicar', async () => {
    const bridge = renderApp(CONNECTED)
    const select = await presetSelect()

    await userEvent.selectOptions(select, COPY.eq.presets[4])
    expect(eqCalls(bridge)).toEqual([])

    await userEvent.click(screen.getByRole('button', { name: COPY.eq.apply }))

    expect(eqCalls(bridge)).toEqual([
      { channel: 'headset:apply-eq-preset', input: { presetId: 4 } },
    ])
    await waitFor(() => expect(select).toHaveDisplayValue(COPY.eq.presets[4]))
  })

  it('switches to Personalizado when a slider moves and sends all ten gains', async () => {
    const bridge = renderApp(CONNECTED)
    const select = await presetSelect()

    fireEvent.change(slider(1000), { target: { value: '3' } })

    expect(select).toHaveDisplayValue(COPY.eq.custom)
    expect(eqCalls(bridge)).toEqual([])

    await userEvent.click(screen.getByRole('button', { name: COPY.eq.apply }))

    expect(eqCalls(bridge)).toEqual([
      {
        channel: 'headset:apply-custom-eq',
        input: { gainsDb: DEFAULT_CURVE_ON_SLIDERS.with(3, 3) },
      },
    ])
  })

  it('starts the draft from the headset custom gains', async () => {
    const bridge = renderApp(withEq({ kind: 'custom', gainsDb: CUSTOM_GAINS }))
    await presetSelect()

    fireEvent.change(slider(55), { target: { value: '-4' } })
    await userEvent.click(screen.getByRole('button', { name: COPY.eq.apply }))

    expect(eqCalls(bridge)).toEqual([
      {
        channel: 'headset:apply-custom-eq',
        input: { gainsDb: [-4, ...CUSTOM_GAINS.slice(1)] },
      },
    ])
  })

  it('labels each slider with its frequency and spoken gain', async () => {
    renderApp(withEq({ kind: 'custom', gainsDb: CUSTOM_GAINS }))
    await presetSelect()

    expect(screen.getByRole('slider', { name: '1 kHz' })).toHaveAttribute('aria-valuetext', '+3 dB')
    expect(screen.getByRole('slider', { name: '55 Hz' })).toHaveAttribute('aria-valuetext', '0 dB')
    expect(screen.getByRole('slider', { name: '7,5 kHz' })).toHaveAttribute(
      'aria-valuetext',
      '−3 dB',
    )
    expect(screen.getAllByRole('slider')).toHaveLength(CUSTOM_EQ_BAND_COUNT)
  })

  it('clamps sliders to ±8 dB with arrow keys', async () => {
    renderApp(CONNECTED)
    await presetSelect()

    screen.getAllByRole('slider').forEach((band) => {
      expect(band).toHaveAttribute('min', String(-EQ_GAIN_LIMIT_DB))
      expect(band).toHaveAttribute('max', String(EQ_GAIN_LIMIT_DB))
      expect(band).toHaveAttribute('step', '1')
      expect(band).toHaveAttribute('aria-orientation', 'vertical')
    })
  })

  it('moves the sent gain to the nearest whole decibel inside the limit', async () => {
    const bridge = renderApp(withEq({ kind: 'custom', gainsDb: CUSTOM_GAINS }))
    await presetSelect()

    fireEvent.change(slider(22000), { target: { value: '12' } })
    fireEvent.change(slider(55), { target: { value: '-12' } })
    await userEvent.click(screen.getByRole('button', { name: COPY.eq.apply }))

    expect(eqCalls(bridge)).toEqual([
      {
        channel: 'headset:apply-custom-eq',
        input: { gainsDb: [-EQ_GAIN_LIMIT_DB, ...CUSTOM_GAINS.slice(1, -1), EQ_GAIN_LIMIT_DB] },
      },
    ])
  })

  it('restores the headset values with Restaurar', async () => {
    const bridge = renderApp(withEq({ kind: 'custom', gainsDb: CUSTOM_GAINS }))
    const select = await presetSelect()
    fireEvent.change(slider(1000), { target: { value: '-5' } })
    await userEvent.selectOptions(select, COPY.eq.presets[2])

    await userEvent.click(screen.getByRole('button', { name: COPY.eq.restore }))

    expect(select).toHaveDisplayValue(COPY.eq.custom)
    expect(slider(1000)).toHaveValue('3')
    expect(eqCalls(bridge)).toEqual([])
  })

  it('drops the draft once the headset reports the applied value', async () => {
    const bridge = renderApp(CONNECTED)
    const select = await presetSelect()
    await userEvent.selectOptions(select, COPY.eq.presets[3])
    await userEvent.click(screen.getByRole('button', { name: COPY.eq.apply }))

    await act(async () => bridge.emitSnapshot(withEq({ kind: 'preset', presetId: 5 })))

    await waitFor(() => expect(select).toHaveDisplayValue(COPY.eq.presets[5]))
  })

  describe('preset curve', () => {
    it('shows the reported preset curve on the sliders', async () => {
      renderApp(withEq({ kind: 'preset', presetId: 2 }))
      await presetSelect()

      expectSliders(POP_CURVE_ON_SLIDERS)
    })

    it('speaks the exact preset gain when it exceeds the slider limit', async () => {
      renderApp(withEq({ kind: 'preset', presetId: 2 }))
      await presetSelect()

      expect(slider(220)).toHaveAttribute('aria-valuetext', '−12 dB')
      expect(slider(2800)).toHaveAttribute('aria-valuetext', '+3,5 dB')
    })

    it('shows the chosen preset curve before Aplicar', async () => {
      renderApp(withEq({ kind: 'custom', gainsDb: CUSTOM_GAINS }))
      const select = await presetSelect()

      await userEvent.selectOptions(select, COPY.eq.presets[2])

      expectSliders(POP_CURVE_ON_SLIDERS)
    })

    it('shows the new curve once the headset reports another preset', async () => {
      const bridge = renderApp(CONNECTED)
      await presetSelect()

      await act(async () => bridge.emitSnapshot(withEq({ kind: 'preset', presetId: 2 })))

      await waitFor(() => expectSliders(POP_CURVE_ON_SLIDERS))
    })

    it('starts Personalizado from the preset curve within the slider limit', async () => {
      const bridge = renderApp(withEq({ kind: 'preset', presetId: 2 }))
      await presetSelect()

      fireEvent.change(slider(22000), { target: { value: '5' } })
      await userEvent.click(screen.getByRole('button', { name: COPY.eq.apply }))

      expect(eqCalls(bridge)).toEqual([
        { channel: 'headset:apply-custom-eq', input: { gainsDb: POP_CURVE_ON_SLIDERS.with(9, 5) } },
      ])
    })

    it('starts Personalizado from the preset curve when picked in the selector', async () => {
      const bridge = renderApp(withEq({ kind: 'preset', presetId: 2 }))
      const select = await presetSelect()

      await userEvent.selectOptions(select, COPY.eq.custom)
      await userEvent.click(screen.getByRole('button', { name: COPY.eq.apply }))

      expect(eqCalls(bridge)).toEqual([
        { channel: 'headset:apply-custom-eq', input: { gainsDb: POP_CURVE_ON_SLIDERS } },
      ])
    })
  })

  describe('draft', () => {
    it('keeps the draft when an unrelated snapshot push arrives mid-edit', async () => {
      const bridge = renderApp(CONNECTED)
      const select = await presetSelect()
      await userEvent.selectOptions(select, COPY.eq.presets[4])

      await act(async () =>
        bridge.emitSnapshot({ ...CONNECTED, battery: { percent: 29, charging: false } }),
      )

      expect(select).toHaveDisplayValue(COPY.eq.presets[4])
    })

    it('sends the preset when a preset is picked again after a slider move', async () => {
      const bridge = renderApp(CONNECTED)
      const select = await presetSelect()
      fireEvent.change(slider(1000), { target: { value: '3' } })
      await userEvent.selectOptions(select, COPY.eq.presets[4])

      await userEvent.click(screen.getByRole('button', { name: COPY.eq.apply }))

      expect(eqCalls(bridge)).toEqual([
        { channel: 'headset:apply-eq-preset', input: { presetId: 4 } },
      ])
    })

    it('drops the draft after a custom apply once the headset reports it', async () => {
      const bridge = renderApp(CONNECTED)
      const select = await presetSelect()
      fireEvent.change(slider(1000), { target: { value: '3' } })
      await userEvent.click(screen.getByRole('button', { name: COPY.eq.apply }))
      await waitFor(() => expect(bridge.calls.length).toBeGreaterThan(1))

      await act(async () => bridge.emitSnapshot(withEq({ kind: 'preset', presetId: 2 })))

      await waitFor(() => expect(select).toHaveDisplayValue(COPY.eq.presets[2]))
      expectSliders(POP_CURVE_ON_SLIDERS)
    })
  })

  describe('while applying', () => {
    it('sends exactly one write on a double click', async () => {
      const bridge = renderApp(CONNECTED)
      const invoke = bridge.invoke
      window.qcy = {
        ...bridge,
        invoke: async (channel, input) => {
          await new Promise((resolve) => setTimeout(resolve, SLOW_WRITE_MS))
          return invoke(channel, input)
        },
      }
      await userEvent.selectOptions(await presetSelect(), COPY.eq.presets[4])

      await userEvent.dblClick(screen.getByRole('button', { name: COPY.eq.apply }))

      await waitFor(() => expect(eqCalls(bridge)).toHaveLength(1))
      await waitFor(() => expect(screen.getByRole('button', { name: COPY.eq.apply })).toBeEnabled())
      expect(eqCalls(bridge)).toHaveLength(1)
    })
  })

  it('clears a stale error and retry with Restaurar', async () => {
    const bridge = renderApp(CONNECTED)
    bridge.failNext('headset:apply-eq-preset', IpcErrorCode.Timeout)
    await userEvent.selectOptions(await presetSelect(), COPY.eq.presets[4])
    await userEvent.click(screen.getByRole('button', { name: COPY.eq.apply }))
    await screen.findByRole('alert')

    await userEvent.click(screen.getByRole('button', { name: COPY.eq.restore }))

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: COPY.retry })).not.toBeInTheDocument()
  })

  describe('disabled states', () => {
    it.each([
      ['searching', { ...CONNECTED, status: 'searching' as const }],
      ['reconnecting', { ...CONNECTED, status: 'reconnecting' as const }],
      ['read-only', { ...CONNECTED, readOnly: 'unexpected-vendor' as const }],
    ])('disables every control when %s', async (_name, snapshot) => {
      renderApp(snapshot)
      const select = await presetSelect()

      expect(select).toBeDisabled()
      screen.getAllByRole('slider').forEach((band) => expect(band).toBeDisabled())
      expect(screen.getByRole('button', { name: COPY.eq.apply })).toBeDisabled()
      expect(screen.getByRole('button', { name: COPY.eq.restore })).toBeDisabled()
    })
  })

  describe('errors', () => {
    it('shows the error and keeps the draft when the headset rejects a preset', async () => {
      const bridge = renderApp(CONNECTED)
      bridge.failNext('headset:apply-eq-preset', IpcErrorCode.DeviceRejected)
      const select = await presetSelect()
      await userEvent.selectOptions(select, COPY.eq.presets[4])

      await userEvent.click(screen.getByRole('button', { name: COPY.eq.apply }))

      expect(await screen.findByRole('alert')).toHaveTextContent(COPY.errors['device-rejected'])
      expect(select).toHaveDisplayValue(COPY.eq.presets[4])
    })

    it('re-sends the last preset on retry and clears the error', async () => {
      const bridge = renderApp(CONNECTED)
      bridge.failNext('headset:apply-eq-preset', IpcErrorCode.Timeout)
      await userEvent.selectOptions(await presetSelect(), COPY.eq.presets[4])
      await userEvent.click(screen.getByRole('button', { name: COPY.eq.apply }))

      await userEvent.click(await screen.findByRole('button', { name: COPY.retry }))

      await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
      expect(eqCalls(bridge)).toEqual([
        { channel: 'headset:apply-eq-preset', input: { presetId: 4 } },
        { channel: 'headset:apply-eq-preset', input: { presetId: 4 } },
      ])
    })

    it('re-sends the last custom curve on retry', async () => {
      const bridge = renderApp(CONNECTED)
      bridge.failNext('headset:apply-custom-eq', IpcErrorCode.Timeout)
      await presetSelect()
      fireEvent.change(slider(220), { target: { value: '2' } })
      await userEvent.click(screen.getByRole('button', { name: COPY.eq.apply }))

      await userEvent.click(await screen.findByRole('button', { name: COPY.retry }))

      const gainsDb = DEFAULT_CURVE_ON_SLIDERS.with(1, 2)
      await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
      expect(eqCalls(bridge)).toEqual([
        { channel: 'headset:apply-custom-eq', input: { gainsDb } },
        { channel: 'headset:apply-custom-eq', input: { gainsDb } },
      ])
    })

    it('disables retry while disconnected or read-only', async () => {
      const bridge = renderApp(CONNECTED)
      bridge.failNext('headset:apply-eq-preset', IpcErrorCode.Timeout)
      await userEvent.selectOptions(await presetSelect(), COPY.eq.presets[4])
      await userEvent.click(screen.getByRole('button', { name: COPY.eq.apply }))
      const retry = await screen.findByRole('button', { name: COPY.retry })

      await act(async () => bridge.emitSnapshot({ ...CONNECTED, status: 'reconnecting' }))
      await waitFor(() => expect(retry).toBeDisabled())

      await act(async () => bridge.emitSnapshot({ ...CONNECTED, readOnly: 'unexpected-vendor' }))
      await waitFor(() => expect(retry).toBeDisabled())
    })

    it('hides the error once the pushed snapshot matches the attempted preset', async () => {
      const bridge = renderApp(CONNECTED)
      bridge.failNext('headset:apply-eq-preset', IpcErrorCode.Timeout)
      await userEvent.selectOptions(await presetSelect(), COPY.eq.presets[4])
      await userEvent.click(screen.getByRole('button', { name: COPY.eq.apply }))
      await screen.findByRole('alert')

      await act(async () => bridge.emitSnapshot(withEq({ kind: 'preset', presetId: 4 })))

      await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
    })

    it('keeps the error when the pushed snapshot does not match the attempt', async () => {
      const bridge = renderApp(CONNECTED)
      bridge.failNext('headset:apply-eq-preset', IpcErrorCode.Timeout)
      await userEvent.selectOptions(await presetSelect(), COPY.eq.presets[4])
      await userEvent.click(screen.getByRole('button', { name: COPY.eq.apply }))
      await screen.findByRole('alert')

      await act(async () => bridge.emitSnapshot(withEq({ kind: 'preset', presetId: 2 })))

      expect(screen.getByRole('alert')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: COPY.retry })).toBeEnabled()
    })
  })
})
