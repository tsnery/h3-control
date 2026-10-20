import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createJsonSettingsStore, createMemorySettingsStore } from './settings-store'

describe('createJsonSettingsStore', () => {
  let directory: string
  let filePath: string

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'qcy-settings-'))
    filePath = join(directory, 'nested', 'settings.json')
  })

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true })
  })

  it('persists values across instances', () => {
    const first = createJsonSettingsStore(filePath)
    first.set('preferredDeviceId', '84:AC:60:26:F5:68')
    first.set('hasWrittenCustomEq', true)

    const second = createJsonSettingsStore(filePath)

    expect(second.get('preferredDeviceId')).toBe('84:AC:60:26:F5:68')
    expect(second.get('hasWrittenCustomEq')).toBe(true)
  })

  describe('returns defaults when the file is missing or corrupt', () => {
    it('uses defaults for a missing file', () => {
      const store = createJsonSettingsStore(filePath)

      expect(store.get('preferredDeviceId')).toBeNull()
      expect(store.get('hasWrittenCustomEq')).toBe(false)
    })

    it.each([
      ['text that is not JSON', '{ not json'],
      ['JSON that is not an object', '[1, 2, 3]'],
    ])('uses defaults for %s', (_case, contents) => {
      writeFileSync(join(directory, 'settings.json'), contents)

      const store = createJsonSettingsStore(join(directory, 'settings.json'))

      expect(store.get('preferredDeviceId')).toBeNull()
      expect(store.get('hasWrittenCustomEq')).toBe(false)
    })

    it('keeps valid fields and defaults only the invalid ones', () => {
      writeFileSync(
        join(directory, 'settings.json'),
        JSON.stringify({ preferredDeviceId: 'fake-h3', hasWrittenCustomEq: 'yes' }),
      )

      const store = createJsonSettingsStore(join(directory, 'settings.json'))

      expect(store.get('preferredDeviceId')).toBe('fake-h3')
      expect(store.get('hasWrittenCustomEq')).toBe(false)
    })
  })
})

describe('createMemorySettingsStore', () => {
  it('starts from defaults and keeps what is set', () => {
    const store = createMemorySettingsStore()
    expect(store.get('hasWrittenCustomEq')).toBe(false)

    store.set('hasWrittenCustomEq', true)

    expect(store.get('hasWrittenCustomEq')).toBe(true)
    expect(store.get('preferredDeviceId')).toBeNull()
  })
})
