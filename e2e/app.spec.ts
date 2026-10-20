import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import { POLL_INTERVAL_MS } from '../src/main/headset/headset-service'
import { RENDERER_ENTRY_URL } from '../src/main/renderer-protocol'
import { COPY } from '../src/renderer/src/copy/pt-br'
import { type LaunchedApp, launchApp } from './launch-app'

const FAKE_BATTERY_PERCENT = 50
const BRIEF_MIN_OBSERVATION_MS = 4000
const POLL_MARGIN_MS = 1000
const OBSERVATION_MS = Math.max(BRIEF_MIN_OBSERVATION_MS, POLL_INTERVAL_MS + POLL_MARGIN_MS)
const SAMPLE_INTERVAL_MS = 250
const QUIT_TIMEOUT_MS = 10_000
const POLL_TEST_TIMEOUT_MS = 40_000
const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']

let launched: LaunchedApp | null = null

function current(): LaunchedApp {
  if (!launched) throw new Error('App was not launched')
  return launched
}

async function sampleFor<T>(durationMs: number, read: () => Promise<T>): Promise<T[]> {
  const samples: T[] = []
  const deadline = Date.now() + durationMs
  while (Date.now() < deadline) {
    samples.push(await read())
    await new Promise((resolve) => setTimeout(resolve, SAMPLE_INTERVAL_MS))
  }
  return samples
}

test.beforeEach(async () => {
  launched = await launchApp()
})

test.afterEach(async () => {
  const app = current()
  launched = null
  await app?.close()
})

async function waitUntilConnected() {
  await expect(current().page.getByText(COPY.connected, { exact: true })).toBeVisible()
}

test.describe('fake headset session', () => {
  test('connects to the fake headset and shows its battery', async () => {
    const { page } = current()
    expect(page.url()).toBe(RENDERER_ENTRY_URL)
    await expect(page).toHaveTitle(COPY.appName)
    await waitUntilConnected()
    await expect(page.getByText(COPY.battery(FAKE_BATTERY_PERCENT))).toBeVisible()
  })

  test('shows that game mode is off on the fake headset', async () => {
    const { page } = current()
    await waitUntilConnected()
    await expect(page.getByText(COPY.gameMode.off, { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: COPY.rename.trigger })).toBeEnabled()
  })

  test('changes ANC to Transparência and keeps it after the next poll', async () => {
    test.setTimeout(POLL_TEST_TIMEOUT_MS)
    const { page } = current()
    await waitUntilConnected()
    const transparency = page.getByRole('radio', { name: COPY.anc.modes.transparency })
    await transparency.click()
    await expect(transparency).toBeChecked()
    const samples = await sampleFor(OBSERVATION_MS, () => transparency.isChecked())
    expect(samples.every(Boolean)).toBe(true)
  })

  test('applies the Rock preset', async () => {
    test.setTimeout(POLL_TEST_TIMEOUT_MS)
    const { page } = current()
    await waitUntilConnected()
    const preset = page.getByLabel(COPY.eq.presetLabel)
    await preset.selectOption({ label: COPY.eq.presets[4] })
    await page.getByRole('button', { name: COPY.eq.apply }).click()
    await expect(page.getByRole('button', { name: COPY.eq.apply })).toBeEnabled()
    const samples = await sampleFor(OBSERVATION_MS, () => preset.locator('option:checked').innerText())
    expect(samples.every((text) => text === COPY.eq.presets[4])).toBe(true)
  })
})

test.describe('rename dialog', () => {
  test('opens from Renomear, closes on Escape and returns focus to the button', async () => {
    const { page } = current()
    await waitUntilConnected()
    const trigger = page.getByRole('button', { name: COPY.rename.trigger })
    await trigger.click()
    const dialog = page.getByRole('dialog', { name: COPY.rename.title })
    await expect(dialog).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await expect(trigger).toBeFocused()
  })
})

test.describe('window lifecycle', () => {
  test('keeps the app running with the window hidden when closed', async () => {
    const { app } = current()
    const child = app.process()
    const exited = new Promise<number | null>((resolve) => child.once('exit', (code) => resolve(code)))
    await waitUntilConnected()
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.close()))
    await expect
      .poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => w.isVisible())))
      .toEqual([false])
    expect(child.exitCode).toBeNull()

    void app.evaluate(({ app: electronApp }) => electronApp.quit()).catch(() => undefined)
    const exitCode = await Promise.race([
      exited,
      new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), QUIT_TIMEOUT_MS)),
    ])
    expect(exitCode).toBe(0)
  })
})

test.describe('quality gates', () => {
  test('has no automatic accessibility violations', async () => {
    const { page } = current()
    await waitUntilConnected()
    const scan = () => new AxeBuilder({ page }).setLegacyMode().withTags(AXE_TAGS).analyze()
    expect((await scan()).violations).toEqual([])
    await page.getByRole('button', { name: COPY.rename.trigger }).click()
    await expect(page.getByRole('dialog', { name: COPY.rename.title })).toBeVisible()
    expect((await scan()).violations).toEqual([])
  })

  test('logs no console errors or CSP violations across a poll', async () => {
    const { page, consoleErrors } = current()
    await waitUntilConnected()
    await page.getByRole('button', { name: COPY.rename.trigger }).click()
    await page.keyboard.press('Escape')
    await page.waitForTimeout(OBSERVATION_MS)
    expect(consoleErrors).toEqual([])
  })

  test('blocks dynamic code while zod-validated IPC calls still succeed', async () => {
    const { page } = current()
    await waitUntilConnected()
    const session = await page.context().newCDPSession(page)
    const { result: probe, exceptionDetails } = await session.send('Runtime.evaluate', {
      expression: `new Function('return 1')()`,
      allowUnsafeEvalBlockedByCSP: false,
    })
    expect(exceptionDetails?.exception?.description ?? probe.description).toMatch(/EvalError|Content Security Policy/)
    const result = await page.evaluate(`window.qcy.invoke('headset:get-snapshot')`)
    expect(result).toMatchObject({ ok: true })
  })
})
