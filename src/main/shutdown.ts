export const QUIT_TIMEOUT_MS = 2000

export type ShutdownOptions = {
  stopHeadset: () => Promise<void>
  disposers: readonly (() => void)[]
  timeoutMs?: number
}

function disposeEach(disposers: readonly (() => void)[]): void {
  for (const dispose of disposers) {
    try {
      dispose()
    } catch (error) {
      console.warn('Disposer failed during shutdown', error)
    }
  }
}

export function createShutdown({
  stopHeadset,
  disposers,
  timeoutMs = QUIT_TIMEOUT_MS,
}: ShutdownOptions): () => Promise<void> {
  let running: Promise<void> | null = null

  const run = async (): Promise<void> => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, timeoutMs)
    })
    try {
      await Promise.race([stopHeadset(), timeout])
    } catch (error) {
      console.warn('Headset did not stop cleanly', error)
    } finally {
      clearTimeout(timer)
      disposeEach(disposers)
    }
  }

  return () => {
    running ??= run()
    return running
  }
}
