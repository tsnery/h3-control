import { type ChangeEvent, type FormEvent, useCallback, useState } from 'react'
import { useRename } from '../api/headset-queries'
import { utf8ByteLength, validateHeadsetName } from '../../../shared/headset-name'

export function useRenameForm() {
  const [name, setName] = useState('')
  const mutation = useRename()
  const { mutate, reset: resetMutation } = mutation
  const validation = validateHeadsetName(name)

  const onChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      if (mutation.isPending) return
      setName(event.target.value)
      resetMutation()
    },
    [mutation.isPending, resetMutation],
  )

  const onSubmit = useCallback(
    (event: FormEvent) => {
      event.preventDefault()
      mutate(name)
    },
    [mutate, name],
  )

  const reset = useCallback(
    (initialName: string) => {
      setName(initialName)
      resetMutation()
    },
    [resetMutation],
  )

  return {
    name,
    byteCount: utf8ByteLength(name.trim()),
    invalidReason: validation.ok ? null : validation.reason,
    canSave: validation.ok && !mutation.isPending,
    pending: mutation.isPending,
    saved: mutation.isSuccess,
    error: mutation.error,
    onChange,
    onSubmit,
    reset,
  }
}
