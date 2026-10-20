import type { ConnectionStatus } from '../../../shared/headset-types'

interface LiveAnnouncerProps {
  message: string
  status: ConnectionStatus
}

export function LiveAnnouncer({ message, status }: LiveAnnouncerProps) {
  return (
    <p role="status" aria-live="polite" className="connection-status" data-status={status}>
      {message}
    </p>
  )
}
