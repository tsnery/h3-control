import { describe, expect, it } from 'vitest'

describe('webbluetooth package', () => {
  it('loads its entry point with the Bluetooth constructor', async () => {
    const { Bluetooth } = await import('webbluetooth')
    expect(Bluetooth).toBeTypeOf('function')
  })

  it('resolves GATT names to canonical UUIDs', async () => {
    const { BluetoothUUID } = await import('webbluetooth')
    expect(BluetoothUUID.getService(0x180f)).toBe('0000180f-0000-1000-8000-00805f9b34fb')
    expect(BluetoothUUID.getService('battery_service')).toBe('0000180f-0000-1000-8000-00805f9b34fb')
  })
})
