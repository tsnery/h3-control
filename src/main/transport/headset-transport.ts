export type TransportErrorCode =
  | 'adapter-unavailable'
  | 'device-not-found'
  | 'connect-failed'
  | 'service-missing'
  | 'write-failed'

export class TransportError extends Error {
  readonly code: TransportErrorCode

  constructor(code: TransportErrorCode, message: string = code) {
    super(message)
    this.name = 'TransportError'
    this.code = code
  }
}

export interface ConnectedLink {
  readonly deviceId: string
  readonly deviceName: string
  write(frame: Uint8Array): Promise<void>
  onNotification(listener: (chunk: Uint8Array) => void): () => void
  onDisconnect(listener: () => void): () => void
  disconnect(): Promise<void>
}

export interface HeadsetTransport {
  connect(options: { preferredDeviceId: string | null; signal: AbortSignal }): Promise<ConnectedLink>
}
