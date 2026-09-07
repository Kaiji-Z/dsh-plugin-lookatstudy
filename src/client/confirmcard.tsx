/**
 * ConfirmCard (C15, upstream ConfirmCard port): a small anchored confirmation
 * popover — flips left/up when clipped, outside click and Escape cancel,
 * Enter confirms, focus starts on the confirm button. Pure placement fold
 * test-frozen below.
 * @module dsh-plugin-lookatstudy/client/confirmcard
 */

import { createElement, useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { tr } from './locale.ts'

/**
 * Anchor placement (pure): the card sits at the trigger's top-right, flipping
 * left when it would overflow the viewport width, up when it would overflow
 * the height.
 */
export function anchorPlacement(trigger: { left: number; top: number; right: number; bottom: number }, vw: number, vh: number, w = 220, h = 96): { left: number; top: number } {
  return {
    left: trigger.right + w + 12 > vw ? Math.max(8, trigger.left - w) : Math.max(8, trigger.right - w),
    top: trigger.bottom + h + 12 > vh ? Math.max(8, trigger.top - h - 8) : trigger.bottom + 8,
  }
}

export function ConfirmCard({ anchor, message, danger, confirmLabel, onConfirm, onCancel }: {
  anchor: { left: number; top: number; right: number; bottom: number }
  message: string
  danger?: boolean
  confirmLabel: string
  onConfirm: () => void
  onCancel: () => void
}): ReactNode {
  const confirmRef = useRef<HTMLButtonElement | null>(null)
  useEffect(() => {
    confirmRef.current?.focus()
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onCancel()
      if (e.key === 'Enter') onConfirm()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('click', onCancel)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('click', onCancel)
    }
  }, [onConfirm, onCancel])
  const place = anchorPlacement(anchor, window.innerWidth, window.innerHeight)
  return createElement('div', {
    className: `lks-confirmcard${danger === true ? ' danger' : ''}`,
    style: { left: `${String(place.left)}px`, top: `${String(place.top)}px` },
    role: 'alertdialog',
    'aria-label': message,
    onClick: (e: { stopPropagation: () => void }) => { e.stopPropagation() },
  },
  createElement('div', { className: 'lks-confirmcard-msg' }, message),
  createElement('div', { className: 'lks-confirmcard-row' },
    createElement('button', { className: 'lks-btn ghost', onClick: onCancel }, tr('confirm.cancel')),
    createElement('button', {
      ref: confirmRef,
      className: danger === true ? 'lks-btn primary' : 'lks-btn primary',
      onClick: onConfirm,
    }, confirmLabel)))
}
