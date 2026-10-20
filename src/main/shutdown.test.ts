import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createShutdown, QUIT_TIMEOUT_MS } from './shutdown'

describe('createShutdown', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('disposes everything after the headset stops', async () => {
    const order: string[] = []
    const shutdown = createShutdown({
      stopHeadset: async () => {
        order.push('stop')
      },
      disposers: [() => order.push('dispose')],
    })
    await shutdown()
    expect(order).toEqual(['stop', 'dispose'])
  })

  it('gives up waiting for a headset that never stops', async () => {
    const disposeAll = vi.fn()
    const shutdown = createShutdown({ stopHeadset: () => new Promise<void>(() => undefined), disposers: [disposeAll] })
    const finished = shutdown()
    await vi.advanceTimersByTimeAsync(QUIT_TIMEOUT_MS)
    await finished
    expect(disposeAll).toHaveBeenCalledOnce()
  })

  it('disposes even when stopping the headset fails', async () => {
    const disposeAll = vi.fn()
    const shutdown = createShutdown({ stopHeadset: () => Promise.reject(new Error('boom')), disposers: [disposeAll] })
    await shutdown()
    expect(disposeAll).toHaveBeenCalledOnce()
  })

  it('runs the remaining disposers and resolves when one throws', async () => {
    const after = vi.fn()
    const shutdown = createShutdown({
      stopHeadset: () => Promise.resolve(),
      disposers: [
        () => {
          throw new Error('tray gone')
        },
        after,
      ],
    })
    await expect(shutdown()).resolves.toBeUndefined()
    expect(after).toHaveBeenCalledOnce()
    expect(console.warn).toHaveBeenCalled()
  })

  it('runs once however many times it is called', async () => {
    const stopHeadset = vi.fn(() => Promise.resolve())
    const disposeAll = vi.fn()
    const shutdown = createShutdown({ stopHeadset, disposers: [disposeAll] })
    await Promise.all([shutdown(), shutdown()])
    await shutdown()
    expect(stopHeadset).toHaveBeenCalledOnce()
    expect(disposeAll).toHaveBeenCalledOnce()
  })
})
