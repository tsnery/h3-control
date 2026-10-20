import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { BATTERY_GAUGE_CELLS, BatteryGauge } from './battery-gauge'

const FILLED = '[data-filled="true"]'
const CELL = '[data-filled]'

function renderGauge(percent: number) {
  const { container } = render(<BatteryGauge percent={percent} />)
  const gauge = container.firstElementChild
  if (!gauge) throw new Error('Gauge not rendered')
  return gauge
}

describe('BatteryGauge', () => {
  it('draws ten cells', () => {
    expect(BATTERY_GAUGE_CELLS).toBe(10)
    expect(renderGauge(70).querySelectorAll(CELL)).toHaveLength(BATTERY_GAUGE_CELLS)
  })

  it.each([
    [0, 0],
    [4, 0],
    [5, 1],
    [70, 7],
    [74, 7],
    [100, 10],
  ])('fills the cells for %i%% to %i', (percent, filled) => {
    expect(renderGauge(percent).querySelectorAll(FILLED)).toHaveLength(filled)
  })

  it('stays hidden from assistive technology and adds no text', () => {
    const gauge = renderGauge(70)
    expect(gauge).toHaveAttribute('aria-hidden', 'true')
    expect(gauge).toHaveTextContent('')
  })
})
