import { COPY } from '../copy/pt-br'
import { HeadsetApiError } from '../api/qcy-bridge'
import { IpcErrorCode } from '../../../shared/ipc-contract'

export function errorText(error: Error): string {
  return COPY.errors[error instanceof HeadsetApiError ? error.code : IpcErrorCode.Unknown]
}
