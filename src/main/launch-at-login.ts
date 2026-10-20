export type LoginItemApp = {
  isPackaged: boolean
  getLoginItemSettings(): { openAtLogin: boolean }
  setLoginItemSettings(settings: { openAtLogin: boolean }): void
}

export type LaunchAtLogin = {
  get(): boolean
  set(enabled: boolean): void
}

// An unpackaged run would register the bare electron.exe at login, so dev stays inert and reports false.
export function createLaunchAtLogin(app: LoginItemApp): LaunchAtLogin {
  return {
    get: () => app.isPackaged && app.getLoginItemSettings().openAtLogin,
    set: (enabled) => {
      if (!app.isPackaged) return
      app.setLoginItemSettings({ openAtLogin: enabled })
    },
  }
}
