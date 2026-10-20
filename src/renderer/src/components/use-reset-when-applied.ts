import { useEffect } from 'react'

export function useResetWhenApplied(applied: boolean, reset: () => void) {
  useEffect(() => {
    if (applied) reset()
  }, [applied, reset])
}
