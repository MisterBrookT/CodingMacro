// Xbox Series wired-USB report parsing.
// Ported from the v1 extension (src/extension/hid/xbox-driver.ts in git history).

import type { ButtonId, ControllerEvent } from '../types.js'

export const XBOX_VID = 0x045e
export const XBOX_PIDS = [0x0b12, 0x0b13, 0x02fd, 0x02e0]
// Wired pads that speak GIP over USB (macOS exposes them via HID with the raw
// GIP input frame). Verified against a live Xbox One S (0x02ea) capture.
export const XBOX_GIP_PIDS = [0x02ea]

/** Normalize a signed 16-bit stick value to -1.0..1.0. */
function normalizeAxis(raw: number): number {
  const clamped = Math.max(-32768, Math.min(32767, raw))
  return clamped < 0 ? clamped / 32768 : clamped / 32767
}

/**
 * Parse an Xbox Series USB HID report (64 bytes) into ControllerEvents.
 * Byte 1: system buttons, byte 2: face buttons, byte 3: dpad,
 * bytes 4-7: triggers (16-bit LE, 0-1023), bytes 8-15: sticks (int16 LE).
 * Exact layout varies by firmware; this matches the common wired layout.
 */
/**
 * Parse a GIP input frame from a wired Xbox One pad (18 bytes).
 * Byte 0: 0x20 message type, bytes 1-3: flags/sequence/length,
 * byte 4: menu/view/face buttons, byte 5: dpad/bumpers/stick clicks,
 * bytes 6-9: triggers (uint16 LE, 0-1023), bytes 10-17: sticks (int16 LE).
 * Layout verified against a live Xbox One S (045e:02ea) capture.
 */
export function parseXboxGipReport(data: Buffer): ControllerEvent[] {
  const events: ControllerEvent[] = []
  if (data.length < 18 || data[0] !== 0x20) return events

  const b4 = data[4]!
  const b5 = data[5]!
  const map: Array<[number, number, ButtonId]> = [
    [b4, 0x04, 'menu'],
    [b4, 0x08, 'view'],
    [b4, 0x10, 'south'],
    [b4, 0x20, 'east'],
    [b4, 0x40, 'west'],
    [b4, 0x80, 'north'],
    [b5, 0x01, 'dpad_up'],
    [b5, 0x02, 'dpad_down'],
    [b5, 0x04, 'dpad_left'],
    [b5, 0x08, 'dpad_right'],
    [b5, 0x10, 'l1'],
    [b5, 0x20, 'r1'],
    [b5, 0x40, 'l3'],
    [b5, 0x80, 'r3'],
  ]
  for (const [byte, bit, id] of map) {
    events.push({ kind: 'button', button: id, pressed: (byte & bit) !== 0 })
  }

  const lt = data.readUInt16LE(6) / 1023
  const rt = data.readUInt16LE(8) / 1023
  events.push({ kind: 'axis', axis: 'l2', value: Math.max(0, Math.min(1, lt)) })
  events.push({ kind: 'axis', axis: 'r2', value: Math.max(0, Math.min(1, rt)) })
  events.push({ kind: 'button', button: 'l2', pressed: lt > 0.25 })
  events.push({ kind: 'button', button: 'r2', pressed: rt > 0.25 })

  events.push({ kind: 'axis', axis: 'left_x', value: normalizeAxis(data.readInt16LE(10)) })
  events.push({ kind: 'axis', axis: 'left_y', value: normalizeAxis(data.readInt16LE(12)) })
  events.push({ kind: 'axis', axis: 'right_x', value: normalizeAxis(data.readInt16LE(14)) })
  events.push({ kind: 'axis', axis: 'right_y', value: normalizeAxis(data.readInt16LE(16)) })

  return events
}

export function parseXboxReport(data: Buffer): ControllerEvent[] {
  const events: ControllerEvent[] = []
  if (data.length < 16) return events

  const face = data[2]!
  const faceMap: Array<[number, ButtonId]> = [
    [0x01, 'south'],
    [0x02, 'east'],
    [0x04, 'west'],
    [0x08, 'north'],
  ]
  for (const [bit, id] of faceMap) {
    events.push({ kind: 'button', button: id, pressed: (face & bit) !== 0 })
  }

  const sys = data[1]!
  const sysMap: Array<[number, ButtonId]> = [
    [0x01, 'l1'],
    [0x02, 'r1'],
    [0x04, 'menu'],
    [0x08, 'view'],
    [0x10, 'l3'],
    [0x20, 'r3'],
  ]
  for (const [bit, id] of sysMap) {
    events.push({ kind: 'button', button: id, pressed: (sys & bit) !== 0 })
  }

  // D-pad is a rotary hat value 1-8 clockwise from north (0 = released).
  const dpad = data[3]!
  events.push({
    kind: 'button',
    button: 'dpad_up',
    pressed: dpad === 1 || dpad === 2 || dpad === 8,
  })
  events.push({ kind: 'button', button: 'dpad_right', pressed: dpad >= 2 && dpad <= 4 })
  events.push({ kind: 'button', button: 'dpad_down', pressed: dpad >= 4 && dpad <= 6 })
  events.push({ kind: 'button', button: 'dpad_left', pressed: dpad >= 6 && dpad <= 8 })

  const lt = ((data[5]! << 8) | data[4]!) / 1023
  const rt = ((data[7]! << 8) | data[6]!) / 1023
  events.push({ kind: 'axis', axis: 'l2', value: Math.max(0, Math.min(1, lt)) })
  events.push({ kind: 'axis', axis: 'r2', value: Math.max(0, Math.min(1, rt)) })
  // ponytail: 0.25 single threshold — a half-pull requirement made soft taps
  // miss. Deduper edge-filters chatter; add hysteresis if noise double-fires.
  events.push({ kind: 'button', button: 'l2', pressed: lt > 0.25 })
  events.push({ kind: 'button', button: 'r2', pressed: rt > 0.25 })

  events.push({ kind: 'axis', axis: 'left_x', value: normalizeAxis(data.readInt16LE(8)) })
  events.push({ kind: 'axis', axis: 'left_y', value: normalizeAxis(data.readInt16LE(10)) })
  events.push({ kind: 'axis', axis: 'right_x', value: normalizeAxis(data.readInt16LE(12)) })
  events.push({ kind: 'axis', axis: 'right_y', value: normalizeAxis(data.readInt16LE(14)) })

  return events
}
