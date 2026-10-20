import type { MenuItemConstructorOptions } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_NOISE_CANCELLING, type HeadsetSnapshot } from '../../shared/headset-types'
import { TRAY_COPY } from './tray-copy'
import { buildTrayMenuTemplate, buildTrayTooltip, type TrayActions } from './tray-menu'

const CONNECTED: HeadsetSnapshot = {
  status: 'connected',
  readOnly: null,
  name: 'QCY H3',
  firmwareVersion: '0.9.1.2',
  battery: { percent: 30, charging: false },
  gameMode: null,
  anc: { mode: 'transparency' },
  eq: null,
}

const ANC_LABELS = [TRAY_COPY.anc.off, TRAY_COPY.anc.transparency, TRAY_COPY.anc.noiseCancelling]

function createActions(): TrayActions {
  return { setAnc: vi.fn(), openWindow: vi.fn(), setLaunchAtLogin: vi.fn(), quit: vi.fn() }
}

function findItem(template: MenuItemConstructorOptions[], label: string): MenuItemConstructorOptions {
  const item = template.find((entry) => entry.label === label)
  if (!item) throw new Error(`Missing menu item ${label}`)
  return item
}

function click(item: MenuItemConstructorOptions, checked = false): void {
  const handler = item.click
  if (!handler) throw new Error()
  const menuItem: Parameters<typeof handler>[0] = Object.assign(Object.create(null), { checked })
  const event: Parameters<typeof handler>[2] = Object.create(null)
  handler(menuItem, undefined, event)
}

describe('buildTrayMenuTemplate', () => {
  it('lists the three ANC modes as radio items with the current one checked', () => {
    const template = buildTrayMenuTemplate(CONNECTED, createActions(), false)
    const anc = ANC_LABELS.map((label) => findItem(template, label))
    expect(anc.map((item) => item.type)).toEqual(['radio', 'radio', 'radio'])
    expect(anc.map((item) => item.checked)).toEqual([false, true, false])
  })

  it('checks noise cancelling for any noise-cancelling scene', () => {
    const snapshot: HeadsetSnapshot = {
      ...CONNECTED,
      anc: { mode: 'noise-cancelling', scene: 'indoor', level: 'low' },
    }
    const template = buildTrayMenuTemplate(snapshot, createActions(), false)
    expect(findItem(template, TRAY_COPY.anc.noiseCancelling).checked).toBe(true)
  })

  it('turns on noise cancelling with the default scene from the tray', () => {
    const actions = createActions()
    click(findItem(buildTrayMenuTemplate(CONNECTED, actions, false), TRAY_COPY.anc.noiseCancelling))
    expect(actions.setAnc).toHaveBeenCalledWith(DEFAULT_NOISE_CANCELLING)
  })

  it('sends off and transparency from their items', () => {
    const actions = createActions()
    const fromNoiseCancelling = { ...CONNECTED, anc: DEFAULT_NOISE_CANCELLING }
    const template = buildTrayMenuTemplate(fromNoiseCancelling, actions, false)
    click(findItem(template, TRAY_COPY.anc.off))
    click(findItem(template, TRAY_COPY.anc.transparency))
    expect(actions.setAnc).toHaveBeenNthCalledWith(1, { mode: 'off' })
    expect(actions.setAnc).toHaveBeenNthCalledWith(2, { mode: 'transparency' })
  })

  it('applies the checked state of the clicked launch item, not the stored value', () => {
    const actions = createActions()
    const launch = findItem(buildTrayMenuTemplate(CONNECTED, actions, false), TRAY_COPY.launchAtLogin)
    click(launch, true)
    expect(actions.setLaunchAtLogin).toHaveBeenCalledWith(true)
  })

  it('ignores a click on the ANC mode that is already active', () => {
    const actions = createActions()
    const template = buildTrayMenuTemplate(
      { ...CONNECTED, anc: { mode: 'noise-cancelling', scene: 'indoor', level: 'low' } },
      actions,
      false,
    )
    click(findItem(template, TRAY_COPY.anc.noiseCancelling))
    expect(actions.setAnc).not.toHaveBeenCalled()
  })

  it('disables ANC items while disconnected or read-only', () => {
    const disconnected: HeadsetSnapshot = { ...CONNECTED, status: 'reconnecting', battery: null, anc: null }
    const readOnly: HeadsetSnapshot = { ...CONNECTED, readOnly: 'unexpected-vendor' }
    for (const snapshot of [disconnected, readOnly]) {
      const template = buildTrayMenuTemplate(snapshot, createActions(), false)
      const enabled = ANC_LABELS.map((label) => findItem(template, label).enabled)
      expect(enabled).toEqual([false, false, false])
    }
  })

  it('includes Abrir, Iniciar com o Windows and Sair wired to their actions', () => {
    const actions = createActions()
    const template = buildTrayMenuTemplate(CONNECTED, actions, true)
    const launch = findItem(template, TRAY_COPY.launchAtLogin)
    expect(launch.type).toBe('checkbox')
    expect(launch.checked).toBe(true)
    click(findItem(template, TRAY_COPY.open))
    click(launch, false)
    click(findItem(template, TRAY_COPY.quit))
    expect(actions.openWindow).toHaveBeenCalledOnce()
    expect(actions.setLaunchAtLogin).toHaveBeenCalledWith(false)
    expect(actions.quit).toHaveBeenCalledOnce()
  })
})

describe('buildTrayTooltip', () => {
  it('shows the battery percentage when connected', () => {
    expect(buildTrayTooltip(CONNECTED)).toBe('QCY H3 — 30%')
  })

  it('says desconectado without a battery reading', () => {
    expect(buildTrayTooltip({ ...CONNECTED, status: 'searching', battery: null })).toBe(
      'QCY H3 — desconectado',
    )
  })

  it('says conectado when connected without a battery reading', () => {
    expect(buildTrayTooltip({ ...CONNECTED, battery: null })).toBe('QCY H3 — conectado')
  })

  it('says desconectado when the link is not connected', () => {
    expect(buildTrayTooltip({ ...CONNECTED, status: 'reconnecting' })).toBe('QCY H3 — desconectado')
  })
})
