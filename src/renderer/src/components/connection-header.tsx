import { useHeadsetSnapshot } from '../api/headset-queries'
import { COPY, STATUS_TEXT } from '../copy/pt-br'
import type { HeadsetSnapshot } from '../../../shared/headset-types'
import { BatteryGauge } from './battery-gauge'
import { GameModeTag } from './game-mode-tag'
import { LiveAnnouncer } from './live-announcer'

const NO_HEADSET_STATUSES: ReadonlySet<HeadsetSnapshot['status']> = new Set([
  'searching',
  'reconnecting',
  'bluetooth-off',
])

function batteryText(battery: NonNullable<HeadsetSnapshot['battery']>): string {
  const text = COPY.battery(battery.percent)
  return battery.charging ? `${text} (${COPY.charging})` : text
}

export function ConnectionHeader() {
  const snapshot = useHeadsetSnapshot()
  const statusText = STATUS_TEXT[snapshot.status]

  return (
    <header className="connection-header">
      <h1 className="title-card">{snapshot.name ?? COPY.appName}</h1>
      <LiveAnnouncer message={statusText} status={snapshot.status} />
      {snapshot.battery ? (
        <p className="battery">
          <BatteryGauge percent={snapshot.battery.percent} />
          {batteryText(snapshot.battery)}
        </p>
      ) : null}
      {snapshot.firmwareVersion ? <p className="firmware">{COPY.firmware(snapshot.firmwareVersion)}</p> : null}
      {snapshot.gameMode === null ? null : <GameModeTag on={snapshot.gameMode} />}
      {NO_HEADSET_STATUSES.has(snapshot.status) ? <p className="connection-help">{COPY.noHeadsetHelp}</p> : null}
      {snapshot.readOnly ? <p role="note" className="read-only-note">{COPY.readOnly.unexpectedVendor}</p> : null}
    </header>
  )
}
