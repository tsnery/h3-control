import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

const FOCUSABLE = 'input, button, select, textarea, [href], [tabindex]'

const focusBeforeOpen = new WeakMap<HTMLDialogElement, Element | null>()
const escapeListeners = new WeakMap<HTMLDialogElement, (event: KeyboardEvent) => void>()

function polyfillShowModal(this: HTMLDialogElement) {
  focusBeforeOpen.set(this, document.activeElement)
  this.setAttribute('open', '')
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape') return
    const cancel = new Event('cancel', { cancelable: true })
    this.dispatchEvent(cancel)
    if (!cancel.defaultPrevented) this.close()
  }
  escapeListeners.set(this, onKeyDown)
  document.addEventListener('keydown', onKeyDown)
  this.querySelector<HTMLElement>(FOCUSABLE)?.focus()
}

function polyfillClose(this: HTMLDialogElement) {
  if (!this.hasAttribute('open')) return
  this.removeAttribute('open')
  const onKeyDown = escapeListeners.get(this)
  if (onKeyDown) document.removeEventListener('keydown', onKeyDown)
  const previous = focusBeforeOpen.get(this)
  if (previous instanceof HTMLElement) previous.focus()
  this.dispatchEvent(new Event('close'))
}

if (!HTMLDialogElement.prototype.showModal) {
  HTMLDialogElement.prototype.showModal = polyfillShowModal
  HTMLDialogElement.prototype.close = polyfillClose
}

afterEach(cleanup)
