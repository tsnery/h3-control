import type { IpcChannel, IpcErrorCode, IpcRequest, IpcResponse } from '../../../shared/ipc-contract'

export class HeadsetApiError extends Error {
  readonly code: IpcErrorCode

  constructor(code: IpcErrorCode, message: string) {
    super(message)
    this.name = 'HeadsetApiError'
    this.code = code
  }
}

export async function callBridge<C extends IpcChannel>(
  channel: C,
  input: IpcRequest<C>,
): Promise<IpcResponse<C>> {
  const result = await window.qcy.invoke(channel, input)
  if (!result.ok) throw new HeadsetApiError(result.error.code, result.error.message)
  return result.value
}
