import { describe, expect, it, vi } from 'vitest'
import { attachHideOnClose, isAppUrl, SECURE_WEB_PREFERENCES } from './app-window'
import { RENDERER_ENTRY_URL } from './renderer-protocol'

const DEV_URL = 'http://localhost:5173/'

describe('SECURE_WEB_PREFERENCES', () => {
  it('isolates the renderer from Node', () => {
    expect(SECURE_WEB_PREFERENCES.contextIsolation).toBe(true)
    expect(SECURE_WEB_PREFERENCES.sandbox).toBe(true)
    expect(SECURE_WEB_PREFERENCES.nodeIntegration).toBe(false)
    expect(SECURE_WEB_PREFERENCES.webSecurity).toBe(true)
  })
})

type CloseListener = (event: { preventDefault(): void }) => void

function createFakeWindow() {
  let closeListener: CloseListener | null = null
  const hide = vi.fn()
  const window = {
    on: (name: 'close', listener: CloseListener) => {
      if (name === 'close') closeListener = listener
    },
    hide,
  }
  const close = () => {
    const event = { preventDefault: vi.fn() }
    closeListener?.(event)
    return event
  }
  return { window, hide, close }
}

describe('attachHideOnClose', () => {
  it('hides instead of closing unless the app is quitting', () => {
    const fake = createFakeWindow()
    attachHideOnClose(fake.window, () => false)
    const event = fake.close()
    expect(event.preventDefault).toHaveBeenCalledOnce()
    expect(fake.hide).toHaveBeenCalledOnce()
  })

  it('lets the window close while the app is quitting', () => {
    const fake = createFakeWindow()
    attachHideOnClose(fake.window, () => true)
    const event = fake.close()
    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(fake.hide).not.toHaveBeenCalled()
  })
})

describe('isAppUrl for the app scheme entry', () => {
  it('allows the exact entry URL and in-page hash changes', () => {
    expect(isAppUrl(RENDERER_ENTRY_URL, RENDERER_ENTRY_URL)).toBe(true)
    expect(isAppUrl(`${RENDERER_ENTRY_URL}#/settings`, RENDERER_ENTRY_URL)).toBe(true)
  })

  it('blocks the entry URL with a query string', () => {
    expect(isAppUrl(`${RENDERER_ENTRY_URL}?injected=1`, RENDERER_ENTRY_URL)).toBe(false)
  })

  it('blocks other pages and hosts on the app scheme', () => {
    expect(isAppUrl('app://renderer/assets/index.js', RENDERER_ENTRY_URL)).toBe(false)
    expect(isAppUrl(`${RENDERER_ENTRY_URL}.evil.html`, RENDERER_ENTRY_URL)).toBe(false)
    expect(isAppUrl('app://evil/index.html', RENDERER_ENTRY_URL)).toBe(false)
  })

  it('blocks file, web and malformed URLs', () => {
    expect(isAppUrl('file:///C:/app/out/renderer/index.html', RENDERER_ENTRY_URL)).toBe(false)
    expect(isAppUrl('https://example.com/', RENDERER_ENTRY_URL)).toBe(false)
    expect(isAppUrl('not a url', RENDERER_ENTRY_URL)).toBe(false)
  })
})

describe('isAppUrl for the dev server', () => {
  it('allows any path on the dev server origin', () => {
    expect(isAppUrl('http://localhost:5173/index.html?x=1#a', DEV_URL)).toBe(true)
  })

  it('blocks other origins', () => {
    expect(isAppUrl('http://localhost:5174/', DEV_URL)).toBe(false)
    expect(isAppUrl(RENDERER_ENTRY_URL, DEV_URL)).toBe(false)
  })
})
