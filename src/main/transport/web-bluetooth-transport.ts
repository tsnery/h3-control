import { type ConnectedLink, type HeadsetTransport, TransportError } from './headset-transport'

export const H3_DEVICE_NAME = 'QCY H3-APP'
export const RCSP_SERVICE_UUID = '0000a002-0000-1000-8000-00805f9b34fb'
export const RCSP_WRITE_UUID = '00000001-0000-1000-8000-00805f9b34fb'
export const RCSP_NOTIFY_UUID = '00000002-0000-1000-8000-00805f9b34fb'

const SCAN_TIME_SECONDS = 10
const PREFERRED_GRACE_MS = 3000
const NOTIFICATION_EVENT = 'characteristicvaluechanged'
const DISCONNECT_EVENT = 'gattserverdisconnected'
const NOT_CONNECTED_PATTERN = /not connected/i

export type DeviceCandidate = { id: string; name: string | undefined }

export type LinkDevice = EventTarget & {
  id: string
  gatt?: { connected: boolean; disconnect(): void }
}
export type LinkWriteCharacteristic = {
  properties: { writeWithoutResponse: boolean }
  writeValueWithoutResponse(value: Uint8Array): Promise<void>
  writeValueWithResponse(value: Uint8Array): Promise<void>
}
export type LinkNotifyCharacteristic = EventTarget & { value?: DataView | undefined }

export function isSupportedHeadsetName(name: string | undefined): boolean {
  return name === H3_DEVICE_NAME
}

export function shouldSelectNow(candidate: DeviceCandidate, preferredDeviceId: string | null): boolean {
  if (!isSupportedHeadsetName(candidate.name)) return false
  return preferredDeviceId === null || candidate.id === preferredDeviceId
}

export function assertSupportedDevice(device: DeviceCandidate): string {
  const { name } = device
  if (name === undefined || !isSupportedHeadsetName(name)) {
    throw new TransportError('device-not-found', `Unsupported device name: ${name ?? 'unnamed'}`)
  }
  return name
}

function toError(reason: unknown): Error {
  return reason instanceof Error ? reason : new Error(String(reason))
}

export function isNotConnectedError(reason: unknown): boolean {
  return reason instanceof Error && NOT_CONNECTED_PATTERN.test(reason.message)
}

const ABORT_MESSAGE = 'Connection aborted'

function abortError(): Error {
  return new Error(ABORT_MESSAGE)
}

const signalWasAborted = (error: unknown): boolean => error instanceof Error && error.message === ABORT_MESSAGE

type AbortGuard = { race<T>(work: Promise<T>): Promise<T>; release(): void }

function guardAbort(signal: AbortSignal): AbortGuard {
  let release = (): void => {}
  const aborted = new Promise<never>((_resolve, reject) => {
    if (signal.aborted) {
      reject(abortError())
      return
    }
    const onAbort = (): void => reject(abortError())
    signal.addEventListener('abort', onAbort, { once: true })
    release = () => signal.removeEventListener('abort', onAbort)
  })
  aborted.catch(() => undefined)
  return { race: (work) => Promise.race([work, aborted]), release: () => release() }
}

function copyChunk(view: DataView | undefined): Uint8Array {
  if (view === undefined) return new Uint8Array()
  return new Uint8Array(view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength))
}

export function buildLink(
  device: LinkDevice,
  deviceName: string,
  writeCharacteristic: LinkWriteCharacteristic,
  notifyCharacteristic: LinkNotifyCharacteristic,
): ConnectedLink {
  const canWriteWithoutResponse = writeCharacteristic.properties.writeWithoutResponse
  const disconnectListeners = new Set<() => void>()
  let disconnected = false

  const reportDisconnect = (): void => {
    if (disconnected) return
    disconnected = true
    for (const listener of [...disconnectListeners]) listener()
    disconnectListeners.clear()
  }
  device.addEventListener(DISCONNECT_EVENT, reportDisconnect)

  return {
    deviceId: device.id,
    deviceName,
    async write(frame) {
      try {
        if (canWriteWithoutResponse) await writeCharacteristic.writeValueWithoutResponse(frame)
        else await writeCharacteristic.writeValueWithResponse(frame)
      } catch (error) {
        if (isNotConnectedError(error)) reportDisconnect()
        throw new TransportError('write-failed', toError(error).message)
      }
    },
    onNotification(listener) {
      const handler = (): void => listener(copyChunk(notifyCharacteristic.value))
      notifyCharacteristic.addEventListener(NOTIFICATION_EVENT, handler)
      return () => notifyCharacteristic.removeEventListener(NOTIFICATION_EVENT, handler)
    },
    onDisconnect(listener) {
      if (disconnected) {
        queueMicrotask(listener)
        return () => undefined
      }
      disconnectListeners.add(listener)
      return () => {
        disconnectListeners.delete(listener)
      }
    },
    async disconnect() {
      if (device.gatt?.connected !== true) return
      device.gatt.disconnect()
    },
  }
}

async function acquireCharacteristics(
  server: BluetoothRemoteGATTServer,
  guard: AbortGuard,
): Promise<{ write: BluetoothRemoteGATTCharacteristic; notify: BluetoothRemoteGATTCharacteristic }> {
  try {
    const service = await guard.race(server.getPrimaryService(RCSP_SERVICE_UUID))
    const write = await guard.race(service.getCharacteristic(RCSP_WRITE_UUID))
    const notify = await guard.race(service.getCharacteristic(RCSP_NOTIFY_UUID))
    return { write, notify }
  } catch (error) {
    if (signalWasAborted(error)) throw error
    throw new TransportError('service-missing', toError(error).message)
  }
}

async function connectServer(
  gatt: BluetoothRemoteGATTServer,
  guard: AbortGuard,
): Promise<BluetoothRemoteGATTServer> {
  const connecting = gatt.connect()
  try {
    return await guard.race(connecting)
  } catch (error) {
    connecting.then(
      (server) => server.disconnect(),
      () => undefined,
    )
    if (signalWasAborted(error)) throw error
    throw new TransportError('connect-failed', toError(error).message)
  }
}

async function openLink(device: BluetoothDevice, name: string, guard: AbortGuard): Promise<ConnectedLink> {
  const gatt = device.gatt
  if (gatt === undefined) throw new TransportError('connect-failed', 'Device has no GATT server')
  const server = await connectServer(gatt, guard)
  try {
    const { write, notify } = await acquireCharacteristics(server, guard)
    await guard.race(notify.startNotifications())
    return buildLink(device, name, write, notify)
  } catch (error) {
    server.disconnect()
    if (error instanceof TransportError || signalWasAborted(error)) throw error
    throw new TransportError('connect-failed', toError(error).message)
  }
}

async function findDevice(preferredDeviceId: string | null, guard: AbortGuard): Promise<BluetoothDevice> {
  const { Bluetooth } = await import('webbluetooth')
  let fallbackTimer: ReturnType<typeof setTimeout> | undefined
  const bluetooth = new Bluetooth({
    scanTime: SCAN_TIME_SECONDS,
    deviceFound: (device, select) => {
      const candidate = { id: device.id, name: device.name }
      if (shouldSelectNow(candidate, preferredDeviceId)) return true
      if (isSupportedHeadsetName(device.name) && fallbackTimer === undefined) {
        fallbackTimer = setTimeout(select, PREFERRED_GRACE_MS)
      }
      return false
    },
  })

  try {
    let available: boolean
    try {
      available = await guard.race(bluetooth.getAvailability())
    } catch (error) {
      if (signalWasAborted(error)) throw error
      throw new TransportError('adapter-unavailable', toError(error).message)
    }
    if (!available) throw new TransportError('adapter-unavailable')

    const scan = bluetooth
      .requestDevice({ filters: [{ name: H3_DEVICE_NAME }], optionalServices: [RCSP_SERVICE_UUID] })
      .catch((reason: unknown) => {
        throw new TransportError('device-not-found', toError(reason).message)
      })
    return await guard.race(scan)
  } catch (error) {
    bluetooth.cancelRequest()
    throw error
  } finally {
    clearTimeout(fallbackTimer)
  }
}

export function createWebBluetoothTransport(): HeadsetTransport {
  return {
    async connect({ preferredDeviceId, signal }) {
      const guard = guardAbort(signal)
      try {
        const device = await findDevice(preferredDeviceId, guard)
        const name = assertSupportedDevice({ id: device.id, name: device.name })
        return await openLink(device, name, guard)
      } finally {
        guard.release()
      }
    },
  }
}
