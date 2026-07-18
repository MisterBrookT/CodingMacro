import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApprovalHoldGate, APPROVAL_HOLD_MS } from '../src/safety.js'

describe('ApprovalHoldGate', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('does not gate normal submit', () => {
    const gate = new ApprovalHoldGate()
    const fire = vi.fn()
    expect(
      gate.handle(
        { type: 'accept' },
        { kind: 'button', button: 'south', pressed: true },
        false,
        fire,
      ),
    ).toBe(false)
    expect(fire).not.toHaveBeenCalled()
  })

  it('fires approval only after a deliberate hold', () => {
    const gate = new ApprovalHoldGate()
    const fire = vi.fn()
    expect(
      gate.handle(
        { type: 'accept' },
        { kind: 'button', button: 'south', pressed: true },
        true,
        fire,
      ),
    ).toBe(true)
    vi.advanceTimersByTime(APPROVAL_HOLD_MS - 1)
    expect(fire).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(fire).toHaveBeenCalledOnce()
  })

  it('cancels approval when released early', () => {
    const gate = new ApprovalHoldGate()
    const fire = vi.fn()
    gate.handle({ type: 'accept' }, { kind: 'button', button: 'south', pressed: true }, true, fire)
    gate.handle({ type: 'accept' }, { kind: 'button', button: 'south', pressed: false }, true, fire)
    vi.advanceTimersByTime(APPROVAL_HOLD_MS)
    expect(fire).not.toHaveBeenCalled()
  })

  it('does not gate unrelated actions', () => {
    const gate = new ApprovalHoldGate()
    expect(
      gate.handle(
        { type: 'reject' },
        { kind: 'button', button: 'east', pressed: true },
        true,
        vi.fn(),
      ),
    ).toBe(false)
  })
})
