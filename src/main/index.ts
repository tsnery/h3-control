import { app, BrowserWindow, ipcMain, protocol } from 'electron'
import { join } from 'node:path'
import { SNAPSHOT_CHANGED_CHANNEL } from '../shared/ipc-contract'
import { createAppWindow } from './app-window'
import { createHeadsetService } from './headset/headset-service'
import { registerIpcHandlers } from './ipc/register-ipc'
import { createTrustedSenderCheck } from './ipc/trusted-sender'
import { createLaunchAtLogin } from './launch-at-login'
import { registerRendererScheme, RENDERER_ENTRY_URL, serveRendererScheme } from './renderer-protocol'
import { createShutdown } from './shutdown'
import { resolveUserDataOverride } from './user-data-override'
import { createJsonSettingsStore } from './settings-store'
import { createTrayController } from './tray/tray-controller'
import { createFakeH3 } from './transport/fake-h3'
import { createWebBluetoothTransport } from './transport/web-bluetooth-transport'
import { createWindowsVolumeControl, spawnPowerShellVolumeHost } from './volume/windows-volume'

const SETTINGS_FILE_NAME = 'settings.json'
const VOLUME_HOST_FILE_NAME = 'volume-host.ps1'
const TRAY_ICON_FILE_NAME = 'tray-icon.png'
const FAKE_TRANSPORT_ENV_VALUE = 'fake'

function resourcePath(fileName: string): string {
  return app.isPackaged ? join(process.resourcesPath, fileName) : join(app.getAppPath(), 'resources', fileName)
}

function shouldUseFakeTransport(): boolean {
  return !app.isPackaged && process.env['QCY_TRANSPORT'] === FAKE_TRANSPORT_ENV_VALUE
}

function startMainProcess(): void {
  let mainWindow: BrowserWindow | null = null
  let isQuitting = false
  let hasShutDown = false
  const disposers: (() => void)[] = []

  const rendererUrl = app.isPackaged ? null : (process.env['ELECTRON_RENDERER_URL'] ?? null)
  const rendererDir = join(__dirname, '../renderer')

  const showMainWindow = (): void => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      const window = createAppWindow({
        preloadPath: join(__dirname, '../preload/index.js'),
        rendererUrl,
        entryUrl: RENDERER_ENTRY_URL,
        isQuitting: () => isQuitting,
      })
      window.on('session-end', () => void shutdown())
      mainWindow = window
      return
    }
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  }

  const transport = shouldUseFakeTransport() ? createFakeH3().transport : createWebBluetoothTransport()
  const settings = createJsonSettingsStore(join(app.getPath('userData'), SETTINGS_FILE_NAME))
  const headset = createHeadsetService({ transport, settings })
  const volume = createWindowsVolumeControl(() => spawnPowerShellVolumeHost(resourcePath(VOLUME_HOST_FILE_NAME)))

  const launchAtLogin = createLaunchAtLogin(app)

  const shutdown = createShutdown({ stopHeadset: () => headset.stop(), disposers })

  const quit = (): void => {
    isQuitting = true
    app.quit()
  }

  // Tray app: closing the last window must keep the process alive.
  app.on('window-all-closed', () => undefined)

  void app.whenReady().then(() => {
    if (!rendererUrl) serveRendererScheme(protocol, rendererDir)
    app.on('second-instance', showMainWindow)
    const tray = createTrayController({
      iconPath: resourcePath(TRAY_ICON_FILE_NAME),
      getLaunchAtLogin: launchAtLogin.get,
      actions: {
        setAnc: (setting) => {
          headset.setAnc(setting).catch((error: unknown) => console.warn('Tray ANC change failed', error))
        },
        openWindow: showMainWindow,
        setLaunchAtLogin: (enabled) => applyLaunchAtLogin(enabled),
        quit,
      },
    })
    const applyLaunchAtLogin = (enabled: boolean): void => {
      launchAtLogin.set(enabled)
      tray.update(headset.getSnapshot())
    }
    const preferences = { getLaunchAtLogin: launchAtLogin.get, setLaunchAtLogin: applyLaunchAtLogin }
    tray.update(headset.getSnapshot())
    const stopTrayUpdates = headset.onSnapshot((snapshot) => tray.update(snapshot))

    const disposeIpc = registerIpcHandlers({
      ipcMain,
      isTrustedSender: createTrustedSenderCheck({ rendererUrl, entryUrl: RENDERER_ENTRY_URL }),
      sendToRenderer: (channel: typeof SNAPSHOT_CHANGED_CHANNEL, snapshot) => {
        if (!mainWindow || mainWindow.isDestroyed()) return
        mainWindow.webContents.send(channel, snapshot)
      },
      headset,
      volume,
      preferences,
    })

    disposers.push(stopTrayUpdates, disposeIpc, () => volume.dispose(), () => tray.dispose())
    app.on('before-quit', (event) => {
      isQuitting = true
      if (hasShutDown) return
      event.preventDefault()
      void shutdown().finally(() => {
        hasShutDown = true
        app.quit()
      })
    })

    showMainWindow()
    headset.start()
  })
}

const userDataOverride = resolveUserDataOverride(process.env, app.isPackaged)
if (userDataOverride) app.setPath('userData', userDataOverride)

// file:// cannot load pages from the asar while the GrantFileProtocolExtraPrivileges fuse is off.
registerRendererScheme(protocol)

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  startMainProcess()
}
