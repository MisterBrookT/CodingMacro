import { describe, expect, it } from 'vitest'
import { nextFocus, SessionTracker } from '../src/state.js'

describe('SessionTracker.aggregate', () => {
  it('plays only when someone is executing and nobody needs attention', () => {
    const t = new SessionTracker()
    expect(t.aggregate().playing).toBe(false) // no sessions at all

    t.apply('s1', 'executing')
    expect(t.aggregate()).toEqual({ playing: true, focusSessionId: null, focusIsAttention: false })

    t.apply('s1', 'complete') // finished, no focusOnStop → not playing, no focus
    expect(t.aggregate()).toEqual({ playing: false, focusSessionId: null, focusIsAttention: false })
  })

  it('any waiting session pauses the game even if another is executing', () => {
    const t = new SessionTracker()
    t.apply('s1', 'executing')
    t.apply('s2', 'executing')
    t.apply('s2', 'waiting')
    expect(t.aggregate()).toEqual({ playing: false, focusSessionId: 's2', focusIsAttention: true })
  })

  it('an error session demands attention just like a waiting one', () => {
    const t = new SessionTracker()
    t.apply('s1', 'executing')
    t.apply('s2', 'error')
    expect(t.aggregate()).toEqual({ playing: false, focusSessionId: 's2', focusIsAttention: true })
  })

  it('focus goes to the most recently attention-needing session', () => {
    const t = new SessionTracker()
    t.apply('s1', 'waiting')
    t.apply('s2', 'waiting')
    expect(t.aggregate().focusSessionId).toBe('s2')
    t.apply('s1', 'waiting')
    expect(t.aggregate().focusSessionId).toBe('s1')
  })

  it('focuses the most recently finished session when all sessions rest', () => {
    const t = new SessionTracker()
    t.apply('s1', 'complete', { focusOnStop: true })
    t.apply('s2', 'complete', { focusOnStop: true })
    expect(t.aggregate()).toEqual({ playing: false, focusSessionId: 's2', focusIsAttention: false })
    t.apply('s1', 'complete', { focusOnStop: true })
    expect(t.aggregate()).toEqual({ playing: false, focusSessionId: 's1', focusIsAttention: false })
  })

  it('attention takes focus over rest, and executing suppresses rest focus', () => {
    const t = new SessionTracker()
    t.apply('resting', 'complete', { focusOnStop: true })
    t.apply('running', 'executing')
    expect(t.aggregate()).toEqual({ playing: true, focusSessionId: null, focusIsAttention: false })
    t.apply('waiting', 'waiting')
    expect(t.aggregate()).toEqual({
      playing: false,
      focusSessionId: 'waiting',
      focusIsAttention: true,
    })
  })

  it('removing a waiter (SessionEnd) resumes the game', () => {
    const t = new SessionTracker()
    t.apply('s1', 'executing')
    t.apply('s2', 'waiting')
    expect(t.aggregate().playing).toBe(false)
    expect(t.remove('s2')).toBe(true)
    expect(t.aggregate()).toEqual({ playing: true, focusSessionId: null, focusIsAttention: false })
  })

  it('reports whether a removed session existed', () => {
    const t = new SessionTracker()
    t.apply('s1', 'complete')
    expect(t.remove('s1')).toBe(true)
    expect(t.remove('s1')).toBe(false)
  })
})

describe('nextFocus', () => {
  const agg = (
    focusSessionId: string | null,
    focusIsAttention: boolean,
  ): { playing: boolean; focusSessionId: string | null; focusIsAttention: boolean } => ({
    playing: false,
    focusSessionId,
    focusIsAttention,
  })

  it('a resting session never steals focus from a manual pick', () => {
    // User touchpad-picked s2; s1 then merely finishes a turn.
    const next = nextFocus('s2', null, agg('s1', false))
    expect(next.focus).toBe('s2')
  })

  it('a session newly demanding attention pulls focus once', () => {
    const first = nextFocus('s2', null, agg('s1', true))
    expect(first.focus).toBe('s1')
    // User touchpads back to s2; the same stale attention id must not re-steal.
    const second = nextFocus('s2', first.lastAttentionId, agg('s1', true))
    expect(second.focus).toBe('s2')
  })

  it('resting focus seeds the very first focus when nothing was picked yet', () => {
    const next = nextFocus(null, null, agg('s1', false))
    expect(next.focus).toBe('s1')
  })
})

describe('SessionTracker complete-decay', () => {
  it('flips complete → idle only after the decay window, and is idempotent', () => {
    let now = 0
    const t = new SessionTracker({ now: () => now })
    t.apply('s1', 'complete', { focusOnStop: true })

    now = 7999
    expect(t.decay()).toBe(false) // not yet

    now = 8000
    expect(t.decay()).toBe(true) // decayed
    expect(t.decay()).toBe(false) // already idle — nothing left to flip

    // idle still rests and keeps focus when nothing else is active
    expect(t.aggregate()).toEqual({ playing: false, focusSessionId: 's1', focusIsAttention: false })
  })

  it('leaves non-complete sessions alone', () => {
    let now = 0
    const t = new SessionTracker({ now: () => now })
    t.apply('s1', 'waiting')
    now = 100000
    expect(t.decay()).toBe(false)
  })
})
