import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { z } from 'zod'

export type Settings = { preferredDeviceId: string | null; hasWrittenCustomEq: boolean }

export interface KeyValueStore {
  get<K extends keyof Settings>(key: K): Settings[K]
  set<K extends keyof Settings>(key: K, value: Settings[K]): void
}

const DEFAULT_SETTINGS: Settings = { preferredDeviceId: null, hasWrittenCustomEq: false }
const JSON_INDENT = 2
const TEMPORARY_SUFFIX = '.tmp'

const SettingsFileSchema = z.object({
  preferredDeviceId: z.string().nullable().catch(DEFAULT_SETTINGS.preferredDeviceId),
  hasWrittenCustomEq: z.boolean().catch(DEFAULT_SETTINGS.hasWrittenCustomEq),
})

function readSettingsFile(filePath: string): Settings {
  try {
    const parsed = SettingsFileSchema.safeParse(JSON.parse(readFileSync(filePath, 'utf8')))
    return parsed.success ? parsed.data : { ...DEFAULT_SETTINGS }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

function writeSettingsFile(filePath: string, settings: Settings): void {
  const temporaryPath = `${filePath}${TEMPORARY_SUFFIX}`
  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(temporaryPath, JSON.stringify(settings, null, JSON_INDENT))
  renameSync(temporaryPath, filePath)
}

function createStore(initial: Settings, persist: (settings: Settings) => void): KeyValueStore {
  const settings: Settings = { ...initial }
  return {
    get: (key) => settings[key],
    set: (key, value) => {
      settings[key] = value
      persist({ ...settings })
    },
  }
}

export function createJsonSettingsStore(filePath: string): KeyValueStore {
  return createStore(readSettingsFile(filePath), (settings) => writeSettingsFile(filePath, settings))
}

export function createMemorySettingsStore(): KeyValueStore {
  return createStore(DEFAULT_SETTINGS, () => undefined)
}
