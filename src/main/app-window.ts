import { BrowserWindow, type WebPreferences } from 'electron'
import { parseUrl, WEB_PROTOCOLS, withoutHash } from './url-compare'

const WINDOW_WIDTH = 960
const WINDOW_HEIGHT = 720

export const SECURE_WEB_PREFERENCES = {
  contextIsolation: true,
  sandbox: true,
  nodeIntegration: false,
  webSecurity: true,
} as const satisfies WebPreferences

export type AppWindowOptions = {
  preloadPath: string
  rendererUrl: string | null
  entryUrl: string
  isQuitting: () => boolean
}

type HideableWindow = {
  on(event: 'close', listener: (event: { preventDefault(): void }) => void): unknown
  hide(): void
}

export function attachHideOnClose(window: HideableWindow, isQuitting: () => boolean): void {
  window.on('close', (event) => {
    if (isQuitting()) return
    event.preventDefault()
    window.hide()
  })
}

export function createAppWindow({
  preloadPath,
  rendererUrl,
  entryUrl,
  isQuitting,
}: AppWindowOptions): BrowserWindow {
  const appUrl = rendererUrl ?? entryUrl
  const window = new BrowserWindow({
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
    show: false,
    webPreferences: { ...SECURE_WEB_PREFERENCES, preload: preloadPath },
  })

  attachHideOnClose(window, isQuitting)
  window.once('ready-to-show', () => window.show())
  window.webContents.on('will-navigate', (event, url) => {
    if (isAppUrl(url, appUrl)) return
    event.preventDefault()
  })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  void window.loadURL(appUrl)
  return window
}

export function isAppUrl(url: string, appUrl: string): boolean {
  const target = parseUrl(url)
  const app = parseUrl(appUrl)
  if (!target || !app) return false
  if (WEB_PROTOCOLS.has(app.protocol)) return target.origin === app.origin
  return withoutHash(target) === withoutHash(app)
}
