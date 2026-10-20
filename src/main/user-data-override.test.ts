import { describe, expect, it } from 'vitest'
import { resolveUserDataOverride } from './user-data-override'

describe('resolveUserDataOverride', () => {
  it('returns the directory when running unpackaged', () => {
    expect(resolveUserDataOverride({ QCY_USER_DATA_DIR: '/tmp/qcy' }, false)).toBe('/tmp/qcy')
  })

  it('ignores the variable in a packaged app', () => {
    expect(resolveUserDataOverride({ QCY_USER_DATA_DIR: '/tmp/qcy' }, true)).toBeNull()
  })

  it('returns null when the variable is unset or empty', () => {
    expect(resolveUserDataOverride({}, false)).toBeNull()
    expect(resolveUserDataOverride({ QCY_USER_DATA_DIR: '' }, false)).toBeNull()
  })
})
