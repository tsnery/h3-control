export const BATTERY_GAUGE_CELLS = 10

const FULL_PERCENT = 100
const PERCENT_PER_CELL = FULL_PERCENT / BATTERY_GAUGE_CELLS
const CELLS = Array.from({ length: BATTERY_GAUGE_CELLS }, (_unused, cell) => cell)

function filledCells(percent: number): number {
  return Math.round(percent / PERCENT_PER_CELL)
}

interface BatteryGaugeProps {
  percent: number
}

export function BatteryGauge({ percent }: BatteryGaugeProps) {
  const filled = filledCells(percent)
  return (
    <span className="battery-gauge" aria-hidden="true">
      {CELLS.map((cell) => (
        <span key={cell} className="battery-cell" data-filled={cell < filled} />
      ))}
    </span>
  )
}
