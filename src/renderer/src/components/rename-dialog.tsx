import { type SyntheticEvent, useCallback, useEffect, useId, useRef, useState } from 'react'
import { useHeadsetSnapshot } from '../api/headset-queries'
import { COPY } from '../copy/pt-br'
import { errorText } from './error-text'
import { useRenameForm } from './use-rename-form'

interface RenameDialogProps {
  open: boolean
  onClose: () => void
}

export function RenameDialog({ open, onClose }: RenameDialogProps) {
  const snapshot = useHeadsetSnapshot()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const form = useRenameForm()
  const { reset, pending } = form
  const currentName = snapshot.name ?? ''
  const counterId = useId()
  const problemId = useId()

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) {
      reset(currentName)
      dialog.showModal()
    }
    if (!open && dialog.open) dialog.close()
  }, [open, reset, currentName])

  const blockCancelWhilePending = useCallback(
    (event: SyntheticEvent) => {
      if (pending) event.preventDefault()
    },
    [pending],
  )

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      onCancel={blockCancelWhilePending}
      aria-label={COPY.rename.title}
      className="rename-dialog"
    >
      <form onSubmit={form.onSubmit}>
        <h2>{COPY.rename.title}</h2>
        <label>
          {COPY.rename.nameLabel}
          <input
            type="text"
            value={form.name}
            onChange={form.onChange}
            readOnly={pending}
            aria-describedby={`${counterId} ${problemId}`}
            aria-invalid={form.invalidReason !== null}
          />
        </label>
        <p id={counterId}>{COPY.rename.bytes(form.byteCount)}</p>
        <p id={problemId} aria-live="polite">
          {form.invalidReason ? COPY.rename.invalid[form.invalidReason] : ''}
        </p>
        <p role="status">{form.saved ? COPY.rename.cachingNote : ''}</p>
        {form.error ? <p role="alert">{errorText(form.error)}</p> : null}
        <button type="submit" className="button-primary" disabled={!form.canSave}>
          {COPY.rename.save}
        </button>
        <button type="button" disabled={pending} onClick={onClose}>
          {form.saved ? COPY.rename.close : COPY.rename.cancel}
        </button>
      </form>
    </dialog>
  )
}

export function RenameButton() {
  const snapshot = useHeadsetSnapshot()
  const [open, setOpen] = useState(false)
  const disabled = snapshot.status !== 'connected' || snapshot.readOnly !== null

  return (
    <>
      <button type="button" className="rename-trigger" disabled={disabled} onClick={() => setOpen(true)}>
        {COPY.rename.trigger}
      </button>
      <RenameDialog open={open} onClose={() => setOpen(false)} />
    </>
  )
}
