import type { MenuItemConstructorOptions } from 'electron'
import { type AncSetting, DEFAULT_NOISE_CANCELLING, type HeadsetSnapshot } from '../../shared/headset-types'
import { TRAY_COPY } from './tray-copy'

export type TrayActions = {
  setAnc(setting: AncSetting): void
  openWindow(): void
  setLaunchAtLogin(enabled: boolean): void
  quit(): void
}

type AncChoice = { mode: AncSetting['mode']; label: string; setting: AncSetting }

const ANC_CHOICES: readonly AncChoice[] = [
  { mode: 'off', label: TRAY_COPY.anc.off, setting: { mode: 'off' } },
  { mode: 'transparency', label: TRAY_COPY.anc.transparency, setting: { mode: 'transparency' } },
  { mode: 'noise-cancelling', label: TRAY_COPY.anc.noiseCancelling, setting: DEFAULT_NOISE_CANCELLING },
]

const SEPARATOR: MenuItemConstructorOptions = { type: 'separator' }

function isControllable(snapshot: HeadsetSnapshot): boolean {
  return snapshot.status === 'connected' && snapshot.readOnly === null
}

export function buildTrayMenuTemplate(
  snapshot: HeadsetSnapshot,
  actions: TrayActions,
  launchAtLogin: boolean,
): MenuItemConstructorOptions[] {
  const enabled = isControllable(snapshot)
  const ancItems = ANC_CHOICES.map(
    ({ mode, label, setting }): MenuItemConstructorOptions => ({
      label,
      type: 'radio',
      checked: snapshot.anc?.mode === mode,
      enabled,
      click: () => {
        if (snapshot.anc?.mode === mode) return
        actions.setAnc(setting)
      },
    }),
  )
  return [
    ...ancItems,
    SEPARATOR,
    { label: TRAY_COPY.open, click: () => actions.openWindow() },
    {
      label: TRAY_COPY.launchAtLogin,
      type: 'checkbox',
      checked: launchAtLogin,
      click: (menuItem) => actions.setLaunchAtLogin(menuItem.checked),
    },
    SEPARATOR,
    { label: TRAY_COPY.quit, click: () => actions.quit() },
  ]
}

function describeState(snapshot: HeadsetSnapshot): string {
  if (snapshot.status !== 'connected') return TRAY_COPY.tooltipDisconnected
  if (!snapshot.battery) return TRAY_COPY.tooltipConnected
  return `${snapshot.battery.percent}%`
}

export function buildTrayTooltip(snapshot: HeadsetSnapshot): string {
  return `${TRAY_COPY.tooltipName} — ${describeState(snapshot)}`
}
