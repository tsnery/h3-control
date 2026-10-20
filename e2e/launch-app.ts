import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const APP_DIR = '.'
const USER_DATA_PREFIX = 'qcy-h3-e2e-'

const CSP_VIOLATION_REPORTER = `document.addEventListener('securitypolicyviolation', (event) => {
  console.error('CSP violation: ' + event.violatedDirective + ' ' + event.blockedURI)
})`

const RM_RETRIES = 10
const RM_RETRY_DELAY_MS = 200

export type LaunchedApp = {
  app: ElectronApplication
  page: Page
  consoleErrors: string[]
  close: () => Promise<void>
}

export async function launchApp(): Promise<LaunchedApp> {
  const userDataDir = await mkdtemp(join(tmpdir(), USER_DATA_PREFIX))
  const removeUserData = (): Promise<void> =>
    rm(userDataDir, { recursive: true, force: true, maxRetries: RM_RETRIES, retryDelay: RM_RETRY_DELAY_MS })
  const app = await electron
    .launch({
      args: [APP_DIR],
      env: { ...process.env, QCY_TRANSPORT: 'fake', QCY_USER_DATA_DIR: userDataDir },
    })
    .catch(async (error: unknown) => {
      await removeUserData()
      throw error
    })
  const child = app.process()
  const hasExited = (): boolean => child.exitCode !== null
  const close = async (): Promise<void> => {
    if (!hasExited()) await app.close()
    await removeUserData()
  }
  const consoleErrors: string[] = []
  try {
    const page = await app.firstWindow()
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text())
    })
    await page.addInitScript(CSP_VIOLATION_REPORTER)
    await page.reload()
    return { app, page, consoleErrors, close }
  } catch (error) {
    await close().catch(() => undefined)
    throw error
  }
}
