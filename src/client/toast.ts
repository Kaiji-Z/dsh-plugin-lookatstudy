/**
 * The panel's toast notifications — the upstream Toast.tsx port (0.15.0 P6):
 * severity capsules with per-severity durations (error outlasts success —
 * the learner needs time to read it), an optional action, dismiss, an
 * exit-animation handshake between store and view, and an injected scheduler
 * so all timing logic runs under plain node:test. One subscribable store per
 * panel; the view lives in panel.tsx (StudyToastStack).
 * @module dsh-plugin-lookatstudy/client/toast
 */

export type ToastSeverity = 'default' | 'success' | 'error' | 'warning' | 'info'

export interface ToastAction {
  readonly label: string
  readonly onClick?: () => void
}

export interface ToastItem {
  readonly id: number
  readonly message: string
  readonly severity: ToastSeverity
  readonly duration: number
  readonly action?: ToastAction
  /** The exit animation is playing; the view calls finish() on its end. */
  exiting: boolean
}

export interface ShowToastOpts {
  severity?: ToastSeverity
  duration?: number
  action?: ToastAction
}

/** Per-severity defaults (upstream Toast.tsx): error 6s, warning 5s, rest 4s. */
export const SEVERITY_DURATION: Readonly<Record<ToastSeverity, number>> = {
  default: 4000,
  success: 4000,
  info: 4000,
  warning: 5000,
  error: 6000,
}

/** Schedule a callback; returns its canceller. Tests inject a manual one. */
export type ToastScheduler = (fn: () => void, ms: number) => () => void

const browserScheduler: ToastScheduler = (fn, ms) => {
  const handle = window.setTimeout(fn, ms)
  return () => { window.clearTimeout(handle) }
}

export class ToastStore {
  private items: ToastItem[] = []
  private nextId = 0
  private readonly listeners = new Set<() => void>()
  private readonly cancellers = new Map<number, () => void>()
  private readonly scheduler: ToastScheduler

  constructor(scheduler: ToastScheduler = browserScheduler) {
    this.scheduler = scheduler
  }

  getSnapshot(): readonly ToastItem[] { return this.items }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  private emit(): void {
    for (const listener of this.listeners) listener()
  }

  /** Enqueue one toast; its auto-exit is scheduled at its duration. */
  show(message: string, opts?: ShowToastOpts): number {
    const severity = opts?.severity ?? 'default'
    const id = ++this.nextId
    const item: ToastItem = {
      id,
      message,
      severity,
      duration: opts?.duration ?? SEVERITY_DURATION[severity],
      action: opts?.action,
      exiting: false,
    }
    this.items = [...this.items, item]
    this.cancellers.set(id, this.scheduler(() => this.startExit(id), item.duration))
    this.emit()
    return id
  }

  /** Begin the exit (dismiss click or the duration timer); cancels the timer. */
  startExit(id: number): void {
    const cancel = this.cancellers.get(id)
    if (cancel !== undefined) {
      cancel()
      this.cancellers.delete(id)
    }
    this.items = this.items.map(t => (t.id === id ? { ...t, exiting: true } : t))
    this.emit()
  }

  /** Actually remove — called by the view when the exit animation ends. */
  finish(id: number): void {
    this.items = this.items.filter(t => t.id !== id)
    this.cancellers.delete(id)
    this.emit()
  }

  /** Drop everything now (the panel unmounted — nothing outlives the panel). */
  clear(): void {
    for (const cancel of this.cancellers.values()) cancel()
    this.cancellers.clear()
    this.items = []
    this.emit()
  }
}

/** The panel-wide singleton stack; consumers call showStudyToast. */
export const toastStore = new ToastStore()

export function showStudyToast(message: string, opts?: ShowToastOpts): number {
  return toastStore.show(message, opts)
}
