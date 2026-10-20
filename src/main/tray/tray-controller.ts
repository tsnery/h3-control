import { Menu, Tray, nativeImage } from 'electron'
import type { HeadsetSnapshot } from '../../shared/headset-types'
import { buildTrayMenuTemplate, buildTrayTooltip, type TrayActions } from './tray-menu'

export type TrayControllerOptions = {
  iconPath: string
  actions: TrayActions
  getLaunchAtLogin: () => boolean
}

export type TrayController = {
  update(snapshot: HeadsetSnapshot): void
  dispose(): void
}

export function createTrayController({ iconPath, actions, getLaunchAtLogin }: TrayControllerOptions): TrayController {
  const icon = nativeImage.createFromPath(iconPath)
  if (icon.isEmpty()) console.warn('Tray icon could not be loaded', iconPath)
  const tray = new Tray(icon)
  tray.on('click', () => actions.openWindow())

  return {
    update: (snapshot) => {
      tray.setToolTip(buildTrayTooltip(snapshot))
      tray.setContextMenu(Menu.buildFromTemplate(buildTrayMenuTemplate(snapshot, actions, getLaunchAtLogin())))
    },
    dispose: () => tray.destroy(),
  }
}
