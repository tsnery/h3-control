import { QueryErrorResetBoundary } from '@tanstack/react-query'
import { type ReactNode, Suspense } from 'react'
import { ErrorBoundary, type FallbackProps } from 'react-error-boundary'
import { HeadsetApiError } from '../api/qcy-bridge'
import { COPY } from '../copy/pt-br'

interface QueryBoundaryProps {
  children: ReactNode
}

function errorMessage(error: unknown): string {
  return error instanceof HeadsetApiError ? COPY.errors[error.code] : COPY.errors.unknown
}

function renderFallback({ error, resetErrorBoundary }: FallbackProps) {
  return (
    <div role="alert" className="error-panel">
      <p>{errorMessage(error)}</p>
      <button type="button" onClick={resetErrorBoundary}>
        {COPY.retry}
      </button>
    </div>
  )
}

export function QueryBoundary({ children }: QueryBoundaryProps) {
  return (
    <QueryErrorResetBoundary>
      {({ reset }) => (
        <ErrorBoundary onReset={reset} fallbackRender={renderFallback}>
          <Suspense fallback={<p>{COPY.loading}</p>}>{children}</Suspense>
        </ErrorBoundary>
      )}
    </QueryErrorResetBoundary>
  )
}
