import { describe, expect, it, vi } from 'vitest'
import { createLaunchAtLogin } from './launch-at-login'

function createApp(isPackaged: boolean, openAtLogin = true) {
  return { isPackaged, getLoginItemSettings: vi.fn(() => ({ openAtLogin })), setLoginItemSettings: vi.fn() }
}

describe('createLaunchAtLogin when packaged', () => {
  it('reads and writes the Windows login item', () => {
    const app = createApp(true)
    const launchAtLogin = createLaunchAtLogin(app)
    expect(launchAtLogin.get()).toBe(true)
    launchAtLogin.set(false)
    expect(app.setLoginItemSettings).toHaveBeenCalledWith({ openAtLogin: false })
  })
})

describe('createLaunchAtLogin in development', () => {
  it('never registers the unpackaged executable at login', () => {
    const app = createApp(false)
    createLaunchAtLogin(app).set(true)
    expect(app.setLoginItemSettings).not.toHaveBeenCalled()
  })

  it('reports false so the UI stays honest', () => {
    expect(createLaunchAtLogin(createApp(false, true)).get()).toBe(false)
  })
})
