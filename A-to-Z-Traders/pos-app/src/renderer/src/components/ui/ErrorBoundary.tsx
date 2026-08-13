import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import { Icon } from '../icons/Icon'
import { Button } from './Button'
import { api } from '../../lib/api'

interface ErrorBoundaryProps {
  children: ReactNode
  /** A label for the log, e.g. the route or "app". */
  context?: string
  /**
   * When set, the boundary resets whenever this value changes — pass the route
   * so navigating away from a crashed screen clears it automatically.
   */
  resetKey?: string
}

interface ErrorBoundaryState {
  error: Error | null
}

/**
 * Catches a render crash so one broken screen never white-screens the whole
 * till. The owner sees a calm recovery card — their data is untouched, because
 * every write is a committed transaction — and can retry or reload. The error
 * is shipped to the main log so a crash on a shop counter is diagnosable.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  componentDidUpdate(previous: ErrorBoundaryProps): void {
    // A route change (or any resetKey change) clears a prior crash so the new
    // screen gets a clean mount instead of the stuck fallback.
    if (this.state.error && previous.resetKey !== this.props.resetKey) {
      this.setState({ error: null })
    }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    try {
      void api.system.logError({
        message: error.message,
        stack: `${error.stack ?? ''}\n--- component stack ---${info.componentStack ?? ''}`,
        context: this.props.context
      })
    } catch {
      // Reporting a crash must never itself throw.
    }
  }

  private reset = (): void => this.setState({ error: null })

  render(): ReactNode {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      <div className="flex h-full min-h-[320px] items-center justify-center bg-canvas p-8">
        <div className="w-full max-w-[440px] rounded-lg border border-line bg-paper p-7 text-center shadow-popover">
          <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-bad-weak text-bad">
            <Icon name="warning" size={24} />
          </div>
          <h2 className="text-lg font-semibold">Something went wrong on this screen</h2>
          <p className="mt-2 text-sm text-ink-muted">
            Your data is safe — nothing was lost. You can try this screen again, or reload the app.
          </p>
          <p className="mt-3 rounded-md bg-surface-sunken px-3 py-2 font-mono text-caption break-words text-ink-subtle">
            {error.message || 'Unexpected error'}
          </p>
          <div className="mt-5 flex justify-center gap-2">
            <Button onClick={this.reset}>Try again</Button>
            <Button variant="primary" onClick={() => window.location.reload()}>
              Reload app
            </Button>
          </div>
        </div>
      </div>
    )
  }
}
