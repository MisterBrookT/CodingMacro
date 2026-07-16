// File logger. stdout belongs to the claude TUI passthrough, so logs go to
// ~/.open-micro/open-micro.log (tail it with `open-micro --verbose` planned later).

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const LOG_DIR = path.join(os.homedir(), '.open-micro')
const LOG_FILE = path.join(LOG_DIR, 'open-micro.log')

let ready = false

function write(level: string, msg: string, detail?: unknown): void {
  try {
    if (!ready) {
      fs.mkdirSync(LOG_DIR, { recursive: true })
      ready = true
    }
    const suffix =
      detail === undefined
        ? ''
        : ` ${detail instanceof Error ? detail.stack : JSON.stringify(detail)}`
    fs.appendFileSync(LOG_FILE, `${new Date().toISOString()} [${level}] ${msg}${suffix}\n`)
  } catch {
    // Logging must never take the app down.
  }
}

export const logger = {
  info: (msg: string, detail?: unknown): void => write('info', msg, detail),
  warn: (msg: string, detail?: unknown): void => write('warn', msg, detail),
  error: (msg: string, detail?: unknown): void => write('error', msg, detail),
}
