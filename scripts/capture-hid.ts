// Raw HID capture for controller debugging — the data-gathering half of the
// "add a new controller" loop in CONTROLLERS.md. Opens a pad, logs every input
// report as hex (deduped), and exits after the window. Run it in the
// background while pressing controls in a known order, then decode the bytes.
//
// Usage:
//   npm run capture                    # first gamepad-looking HID device, 60s
//   npm run capture -- 045e 02ea       # by VID PID (hex)
//   npm run capture -- 045e 02ea 30    # ... with a 30s window
//
// Gotchas (also listed in CONTROLLERS.md): "cannot open device" means
// something else holds the pad (a running doctor/codingmacro session, Steam) —
// close it and retry. Zero reports at idle is normal; many pads only report
// on change.

import { devices, HID } from 'node-hid'
import type { Device } from 'node-hid'

const [vidArg, pidArg, secondsArg] = process.argv.slice(2)
const seconds = Number(secondsArg ?? '60') || 60

function findTarget(): Device | undefined {
  const all = devices()
  if (vidArg && pidArg) {
    const vid = parseInt(vidArg, 16)
    const pid = parseInt(pidArg, 16)
    return all.find((d) => d.vendorId === vid && d.productId === pid && d.path)
  }
  return all.find((d) => d.usagePage === 0x01 && (d.usage === 0x04 || d.usage === 0x05) && d.path)
}

const target = findTarget()
if (!target?.path) {
  console.error(
    vidArg
      ? `No HID device found for ${vidArg}:${pidArg}.`
      : 'No gamepad-looking HID device found. Pass VID PID (hex) explicitly.',
  )
  process.exit(1)
}

console.log(
  JSON.stringify({
    product: target.product,
    vid: '0x' + target.vendorId.toString(16).padStart(4, '0'),
    pid: '0x' + target.productId.toString(16).padStart(4, '0'),
    usagePage: target.usagePage,
    usage: target.usage,
    interface: target.interface,
  }),
)

const hid = new HID(target.path)
let previous = ''
let count = 0
hid.on('data', (buf: Buffer) => {
  count += 1
  const hex = buf.toString('hex')
  if (hex !== previous) {
    console.log(`len=${buf.length} ${hex}`)
    previous = hex
  }
})
hid.on('error', (err: Error) => {
  console.error('read error:', err.message)
  process.exit(1)
})
console.log(`Capturing for ${seconds}s — press controls one at a time, ~1s apart…`)
setTimeout(() => {
  console.log(`total reports: ${count}`)
  hid.close()
  process.exit(0)
}, seconds * 1000)
