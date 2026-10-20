import { describe, expect, it } from 'vitest'
import { TransportError } from './headset-transport'
import {
  H3_DEVICE_NAME,
  assertSupportedDevice,
  buildLink,
  isNotConnectedError,
  isSupportedHeadsetName,
  shouldSelectNow,
} from './web-bluetooth-transport'

describe('isSupportedHeadsetName', () => {
  it('accepts the exact H3 advertised name', () => {
    expect(isSupportedHeadsetName(H3_DEVICE_NAME)).toBe(true)
    expect(isSupportedHeadsetName('QCY H3-APP')).toBe(true)
  })

  it.each(['QCY H3 Pro-APP', 'QCY H3S-APP', 'qcy h3-app', 'QCY H3-APP ', '', undefined])(
    'rejects %j',
    (name) => {
      expect(isSupportedHeadsetName(name)).toBe(false)
    },
  )
})

describe('shouldSelectNow', () => {
  const supported = { id: 'aa', name: 'QCY H3-APP' }

  it('selects the first supported device when no preference exists', () => {
    expect(shouldSelectNow(supported, null)).toBe(true)
  })

  it('selects the preferred device immediately', () => {
    expect(shouldSelectNow(supported, 'aa')).toBe(true)
  })

  it('holds a supported device that is not the preferred one', () => {
    expect(shouldSelectNow(supported, 'bb')).toBe(false)
  })

  it('never selects an unsupported name, even when it is the preferred id', () => {
    expect(shouldSelectNow({ id: 'aa', name: 'QCY H3S-APP' }, 'aa')).toBe(false)
    expect(shouldSelectNow({ id: 'aa', name: 'QCY H3S-APP' }, null)).toBe(false)
    expect(shouldSelectNow({ id: 'aa', name: undefined }, null)).toBe(false)
  })
})

describe('assertSupportedDevice', () => {
  it('returns the name of a supported device', () => {
    expect(assertSupportedDevice({ id: 'aa', name: H3_DEVICE_NAME })).toBe(H3_DEVICE_NAME)
  })

  it.each(['QCY H3S-APP', undefined])('rejects name %j with device-not-found', (name) => {
    expect(() => assertSupportedDevice({ id: 'aa', name })).toThrow(TransportError)
    expect(() => assertSupportedDevice({ id: 'aa', name })).toThrow(
      expect.objectContaining({ code: 'device-not-found' }),
    )
  })
})

describe('isNotConnectedError', () => {
  it('recognises the webbluetooth not connected message', () => {
    expect(isNotConnectedError(new Error('writeValue error: device not connected'))).toBe(true)
  })

  it('ignores other failures', () => {
    expect(isNotConnectedError(new Error('GATT error: unreachable'))).toBe(false)
    expect(isNotConnectedError('nope')).toBe(false)
  })
})

describe('buildLink disconnect detection', () => {
  const buildFakes = (writeError: Error | null) => {
    const device = Object.assign(new EventTarget(), { id: 'aa' })
    const notify = Object.assign(new EventTarget(), { value: undefined })
    const write = {
      properties: { writeWithoutResponse: true },
      writeValueWithoutResponse: async () => {
        if (writeError !== null) throw writeError
      },
      writeValueWithResponse: async () => undefined,
    }
    return { device, link: buildLink(device, H3_DEVICE_NAME, write, notify) }
  }

  it('notifies listeners once when the device reports a drop twice', () => {
    const { device, link } = buildFakes(null)
    let calls = 0
    link.onDisconnect(() => (calls += 1))
    device.dispatchEvent(new Event('gattserverdisconnected'))
    device.dispatchEvent(new Event('gattserverdisconnected'))
    expect(calls).toBe(1)
  })

  it('treats a not-connected write failure as a disconnect and still rejects the write', async () => {
    const { link } = buildFakes(new Error('writeValue error: device not connected'))
    let calls = 0
    link.onDisconnect(() => (calls += 1))
    await expect(link.write(Uint8Array.of(1))).rejects.toMatchObject({ code: 'write-failed' })
    await expect(link.write(Uint8Array.of(1))).rejects.toMatchObject({ code: 'write-failed' })
    expect(calls).toBe(1)
  })

  it('keeps the link up after an unrelated write failure', async () => {
    const { link } = buildFakes(new Error('timeout'))
    let calls = 0
    link.onDisconnect(() => (calls += 1))
    await expect(link.write(Uint8Array.of(1))).rejects.toMatchObject({ code: 'write-failed' })
    expect(calls).toBe(0)
  })
})
