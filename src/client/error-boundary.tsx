/**
 * D8 (upstream ErrorBoundary.tsx): the danger-zone wrapper for every
 * markdown/innerHTML render surface. React still requires a class for
 * boundaries; the default fallback is the inline warning row (warning icon +
 * message + underlined retry), and the content zones use the richer fallback
 * (message + first-500-chars raw preview + retry — upstream's notebook
 * prose fallback). The plugin wraps all THREE innerHTML zones (chat rows,
 * lesson prose, notebook notes) where upstream wrapped only the notebook.
 * @module dsh-plugin-lookatstudy/client/error-boundary
 */

import { Component, createElement } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import { IconWarningOutline16 } from './icons.tsx'
import { tr } from './locale.ts'

interface BoundaryProps {
  children: ReactNode
  /** Render-prop override (upstream signature: error + retry). */
  fallback?: (error: Error, retry: () => void) => ReactNode
}

interface BoundaryState {
  error: Error | null
}

export class ErrorBoundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): BoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[lookatstudy ErrorBoundary]', error, info.componentStack)
  }

  retry = (): void => {
    this.setState({ error: null })
  }

  render(): ReactNode {
    if (this.state.error !== null) {
      if (this.props.fallback !== undefined) return this.props.fallback(this.state.error, this.retry)
      return createElement('div', { className: 'lks-renderfail', role: 'alert' },
        createElement(IconWarningOutline16, { size: 15 }),
        createElement('span', null, tr('error.renderFailed'), ' ',
          createElement('button', { className: 'lks-renderfail-retry', onClick: this.retry }, tr('error.retry'))))
    }
    return this.props.children
  }
}

/** The content-zone wrapper: rich fallback with the raw 500-char preview (upstream NotebookPanel fallback). */
export function ContentBoundary({ content, boundaryKey, children }: {
  content: string
  boundaryKey: string
  children: ReactNode
}): ReactNode {
  return createElement(ErrorBoundary, {
    key: boundaryKey,
    fallback: (_error: Error, retry: () => void) => createElement('div', { className: 'lks-renderfail-rich' },
      createElement('div', { className: 'lks-renderfail-msg' }, tr('note.renderFailed')),
      createElement('pre', { className: 'lks-renderfail-raw' },
        content.slice(0, 500), content.length > 500 ? `\n${tr('note.truncated')}` : ''),
      createElement('button', { className: 'lks-renderfail-retry link', onClick: retry }, tr('note.retryRender'))),
  }, children)
}
