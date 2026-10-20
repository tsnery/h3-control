import { QueryClient, QueryClientProvider, useSuspenseQuery } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { HeadsetApiError } from '../api/qcy-bridge'
import { COPY } from '../copy/pt-br'
import { IpcErrorCode } from '../../../shared/ipc-contract'
import { QueryBoundary } from './query-boundary'

function createFlakyReader() {
  let attempts = 0
  return function FlakyReader() {
    const { data } = useSuspenseQuery({
      queryKey: ['flaky'],
      queryFn: async () => {
        attempts += 1
        if (attempts === 1) throw new HeadsetApiError(IpcErrorCode.NotConnected, 'x')
        return 'loaded'
      },
    })
    return <p>{data}</p>
  }
}

describe('QueryBoundary', () => {
  it('offers a retry that refetches after an error', async () => {
    const FlakyReader = createFlakyReader()
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <QueryBoundary>
          <FlakyReader />
        </QueryBoundary>
      </QueryClientProvider>,
    )

    expect(await screen.findByText(COPY.errors['not-connected'])).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: COPY.retry }))

    expect(await screen.findByText('loaded')).toBeInTheDocument()
  })

  it('shows the loading text while data is pending', () => {
    const client = new QueryClient()
    function Pending() {
      useSuspenseQuery({ queryKey: ['pending'], queryFn: () => new Promise<string>(() => {}) })
      return null
    }
    render(
      <QueryClientProvider client={client}>
        <QueryBoundary>
          <Pending />
        </QueryBoundary>
      </QueryClientProvider>,
    )

    expect(screen.getByText(COPY.loading)).toBeInTheDocument()
  })
})
