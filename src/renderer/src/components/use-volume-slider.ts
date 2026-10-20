import { type ChangeEvent, useCallback, useEffect, useRef, useState } from 'react'
import { useSetVolume } from '../api/headset-queries'

export const VOLUME_DEBOUNCE_MS = 150

export function useVolumeSlider(reportedPercent: number) {
  const [pending, setPending] = useState<number | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const mutation = useSetVolume()
  const { mutate, variables } = mutation

  useEffect(() => () => clearTimeout(timer.current), [])

  const send = useCallback(
    (percent: number) => {
      mutate(percent, {
        onSettled: (_result, _error, sent) =>
          setPending((latest) => (latest === sent ? null : latest)),
      })
    },
    [mutate],
  )

  const onChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const percent = Math.round(event.target.valueAsNumber)
      setPending(percent)
      clearTimeout(timer.current)
      timer.current = setTimeout(() => send(percent), VOLUME_DEBOUNCE_MS)
    },
    [send],
  )

  const retry = useCallback(() => {
    if (variables !== undefined) send(variables)
  }, [variables, send])

  return { percent: pending ?? reportedPercent, error: mutation.error, retry, onChange }
}
