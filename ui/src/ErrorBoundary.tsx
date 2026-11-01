import { Component } from 'react'
import type { ReactNode } from 'react'

/**
 * Keeps one part of the page that fails to draw from taking the rest with it (React drops the whole tree otherwise, and the page goes blank): a line that names the error,
 * and Reload. The part stays as it is until the page is reloaded or the part is closed.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error?: string }> {
  override state: { error?: string } = {}

  static getDerivedStateFromError(error: unknown): { error: string } {
    return { error: (error instanceof Error ? error.message : String(error)) || 'Unknown error' }
  }

  override render() {
    if (this.state.error === undefined) return this.props.children
    return (
      <div className="crashed" role="alert">
        <span>Stopped: {this.state.error}</span>
        <button type="button" onClick={() => location.reload()}>Reload</button>
      </div>
    )
  }
}
