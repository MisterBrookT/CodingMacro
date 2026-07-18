import type { Action } from './harness/types.js'
import type { ControllerEvent } from './types.js'

export const APPROVAL_HOLD_MS = 500

/** Requires a deliberate hold before accept while an agent needs attention. */
export class ApprovalHoldGate {
  private timer: ReturnType<typeof setTimeout> | null = null

  handle(
    action: Action,
    event: ControllerEvent,
    needsAttention: boolean,
    fire: () => void,
  ): boolean {
    if (action.type !== 'accept' || event.kind !== 'button') return false
    if (!needsAttention) {
      this.cancel()
      return false
    }
    if (!event.pressed) {
      this.cancel()
      return true
    }
    if (!this.timer) {
      this.timer = setTimeout(() => {
        this.timer = null
        fire()
      }, APPROVAL_HOLD_MS)
      this.timer.unref?.()
    }
    return true
  }

  cancel(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }
}
