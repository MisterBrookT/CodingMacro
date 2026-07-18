// Host HTTP server on the singleton port. Receives agent lifecycle hook POSTs
// (/om-hook/<event>), classifies them into an AgentState via the harness that
// owns the reporting session, and forwards terminal keystrokes to client
// instances over SSE. No game/sidebar/static serving — codingmacro drives a
// controller, not a browser tab.

import { EventEmitter } from 'node:events'
import http from 'node:http'
import { harnessFor } from './harness/index.js'
import type { Harness } from './harness/types.js'
import { releaseAgent, reportAgentState } from './herdr.js'
import { logger } from './logger.js'
import { HOOK_PATH, HOST_URL } from './ports.js'
import { SessionTracker } from './state.js'
import { dashboardHtml } from './dashboard.js'
import type { CodingMacroConfig } from './layers.js'
import type { AxisId, ButtonId, ControllerEvent, ControllerType } from './types.js'

// Every wrapped agent's hooks carry this ownership header (the pty exports
// CODINGMACRO_INSTANCE_ID to the agent, and hook commands run with the agent's
// env). Header-less hooks come from sessions codingmacro never wrapped — cwd is
// ambiguous when several sessions share a directory, so they are ignored.
const INSTANCE_HEADERS = ['x-codingmacro-instance-id', 'x-openmicro-instance-id'] as const

// Herdr pane id, echoed back by hook commands when the wrapped agent runs
// inside a herdr-managed pane (HERDR_PANE_ID in its env). Only honored on
// trusted hooks — same gate as the instance header.
const HERDR_PANE_HEADER = 'x-herdr-pane-id'

// Node's fetch (undici) kills a response body that stays silent for 300s
// (default bodyTimeout), which tore down idle client keystroke streams and
// dropped their sessions from the touchpad cycle. A comment frame every 25s
// keeps the stream alive; SSE clients ignore comment lines by spec.
const HEARTBEAT_MS = 25_000

const BUTTON_IDS: ReadonlySet<ButtonId> = new Set([
  'south',
  'east',
  'west',
  'north',
  'dpad_up',
  'dpad_down',
  'dpad_left',
  'dpad_right',
  'l1',
  'r1',
  'l2',
  'r2',
  'l3',
  'r3',
  'menu',
  'view',
  'touchpad',
])
const AXIS_IDS: ReadonlySet<AxisId> = new Set([
  'left_x',
  'left_y',
  'right_x',
  'right_y',
  'l2',
  'r2',
])
const CONTROLLER_TYPES: ReadonlySet<ControllerType> = new Set([
  'xbox',
  'dualsense',
  'ds4',
  'gamesir',
  'generic-hid',
  'simulated',
])

export interface HostServerOptions {
  simulationEnabled?: boolean
  controllerTypeProvider?: () => ControllerType | null
  configProvider?: () => CodingMacroConfig
  configWriter?: (config: CodingMacroConfig) => void
}

function parseControllerEvent(value: unknown): ControllerEvent | null {
  if (!value || typeof value !== 'object') return null
  const event = value as Record<string, unknown>
  if (event.kind === 'button') {
    if (typeof event.button !== 'string' || !BUTTON_IDS.has(event.button as ButtonId)) return null
    if (typeof event.pressed !== 'boolean') return null
    return { kind: 'button', button: event.button as ButtonId, pressed: event.pressed }
  }
  if (event.kind === 'axis') {
    if (typeof event.axis !== 'string' || !AXIS_IDS.has(event.axis as AxisId)) return null
    if (typeof event.value !== 'number' || !Number.isFinite(event.value)) return null
    const min = event.axis === 'l2' || event.axis === 'r2' ? 0 : -1
    if (event.value < min || event.value > 1) return null
    return { kind: 'axis', axis: event.axis as AxisId, value: event.value }
  }
  if (event.kind === 'connected') {
    if (
      typeof event.controllerType !== 'string' ||
      !CONTROLLER_TYPES.has(event.controllerType as ControllerType)
    )
      return null
    return { kind: 'connected', controllerType: event.controllerType as ControllerType }
  }
  if (event.kind === 'disconnected') return { kind: 'disconnected' }
  return null
}

function sse(res: http.ServerResponse): void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  })
  // retry: a leftover client re-attaches to the new host fast after a restart.
  res.write('retry: 1000\n\n')
}

function send(res: http.ServerResponse, payload: unknown): void {
  res.write(`data: ${JSON.stringify(payload)}\n\n`)
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let body = ''
    req.on('data', (chunk: Buffer) => (body += chunk.toString('utf8')))
    req.on('end', () => resolve(body))
    req.on('error', () => resolve(body))
  })
}

function instanceHeader(req: http.IncomingMessage): string | undefined {
  for (const name of INSTANCE_HEADERS) {
    const value = req.headers[name]
    const first = Array.isArray(value) ? value[0] : value
    if (first) return first
  }
  return undefined
}

/**
 * Emits 'aggregate' (Aggregate) whenever hook events (or a background
 * complete→idle decay) may have changed the combined agent state.
 */
export class HostServer extends EventEmitter {
  readonly tracker: SessionTracker
  private controllerType: ControllerType | null = null
  private controllerEventSeq = 0
  private lastControllerEvent: (ControllerEvent & { at: number; seq: number }) | null = null
  private recentControllerEvents: Array<ControllerEvent & { at: number; seq: number }> = []
  /** session_id → wrapper id, learned from hook ownership headers. */
  readonly sessionOwners = new Map<string, string>()
  /** session_id → herdr pane id, learned from hook pane headers — lets herdr agent cycling retarget input routing. */
  readonly sessionPanes = new Map<string, string>()
  /** Which harness classifies a wrapper's hooks, resolved from /register. */
  private wrapperHarness = new Map<string, Harness>()

  private server: http.Server | null = null
  private instances = new Map<
    string,
    { res: http.ServerResponse; cwd: string; wrapperId: string | null }
  >()
  private pendingInstances = new Map<string, { cwd: string; wrapperId: string | null }>()
  private nextInstanceId = 1

  /**
   * hostHarness classifies the host's own session's hooks (and any hook whose
   * wrapper we never saw a /register for). hostWrapperId scopes which sessions
   * are trusted to drive the FSM: globally-installed hooks fire from every
   * agent session on the machine, and a foreign session stuck 'waiting' would
   * otherwise pin state forever. Unset (tests): no filtering.
   */
  constructor(
    private readonly hostHarness: Harness,
    private readonly hostWrapperId?: string,
    private readonly options: HostServerOptions = {},
  ) {
    super()
    this.tracker = new SessionTracker({
      onChange: () => this.emit('aggregate', this.tracker.aggregate()),
    })
    if (hostWrapperId) this.wrapperHarness.set(hostWrapperId, hostHarness)
  }

  /** Port actually bound (differs from HOST_PORT only in tests using port 0). */
  boundPort = 0

  /** Mirror active hardware into the local HUD without exposing raw HID data. */
  setControllerType(controllerType: ControllerType | null): void {
    this.controllerType = controllerType
  }

  /** Feed normalized events to HUD. Never exposes raw HID reports. */
  recordControllerEvent(event: ControllerEvent): void {
    const recorded = { ...event, at: Date.now(), seq: ++this.controllerEventSeq }
    this.lastControllerEvent = recorded
    this.recentControllerEvents.push(recorded)
    if (this.recentControllerEvents.length > 64) this.recentControllerEvents.shift()
    if (event.kind === 'connected') this.controllerType = event.controllerType
    if (event.kind === 'disconnected') this.controllerType = null
  }

  /** Bind the singleton port. Resolves true = we are the host, false = port taken. */
  listen(port: number): Promise<boolean> {
    return new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => {
        this.handle(req, res).catch((err) => {
          logger.error('server request failed', err)
          if (!res.headersSent) res.writeHead(500)
          res.end()
        })
      })
      server.once('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE') resolve(false)
        else reject(err)
      })
      server.listen(port, '127.0.0.1', () => {
        this.server = server
        const address = server.address()
        this.boundPort = typeof address === 'object' && address ? address.port : port
        resolve(true)
      })
    })
  }

  close(): void {
    for (const { res } of this.instances.values()) res.end()
    this.server?.close()
  }

  /** Write keystrokes to a registered client instance's pty. Returns false if unknown. */
  sendKeysToInstance(instanceId: string, bytes: string): boolean {
    const instance = this.instances.get(instanceId)
    if (!instance) return false
    send(instance.res, { type: 'keys', data: Buffer.from(bytes, 'utf8').toString('base64') })
    return true
  }

  private isActiveOwner(wrapperId: string): boolean {
    if (wrapperId === this.hostWrapperId) return true
    for (const instance of this.instances.values()) {
      if (instance.wrapperId === wrapperId) return true
    }
    return false
  }

  /** Find the client instance that owns the given session (null = host's own pty). */
  instanceForSession(sessionId: string): string | null {
    const owner = this.sessionOwners.get(sessionId)
    if (!owner) return null
    for (const [id, instance] of this.instances) {
      if (instance.wrapperId === owner) return id
    }
    return null
  }

  removeSessionsForOwner(wrapperId: string): boolean {
    let removed = false
    for (const [sessionId, owner] of this.sessionOwners) {
      if (owner !== wrapperId) continue
      removed = this.tracker.remove(sessionId) || removed
      this.sessionOwners.delete(sessionId)
      this.sessionPanes.delete(sessionId)
    }
    return removed
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', HOST_URL)
    const { pathname } = url

    if (pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ app: 'codingmacro', simulation: this.simulationEnabled }))
      return
    }

    if (req.method === 'GET' && (pathname === '/' || pathname === '/dashboard')) {
      res.writeHead(pathname === '/' ? 302 : 200, {
        ...(pathname === '/'
          ? { Location: '/dashboard' }
          : { 'Content-Type': 'text/html; charset=utf-8' }),
        'Cache-Control': 'no-store',
        'Content-Security-Policy':
          "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'",
      })
      res.end(pathname === '/' ? undefined : dashboardHtml(this.simulationEnabled))
      return
    }

    if (req.method === 'GET' && pathname === '/api/status') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
      res.end(
        JSON.stringify({
          app: 'codingmacro',
          simulation: this.simulationEnabled,
          controllerType: this.options.controllerTypeProvider?.() ?? this.controllerType,
          lastControllerEvent: this.lastControllerEvent,
          recentControllerEvents: this.recentControllerEvents,
          sessions: this.tracker.list(),
          aggregate: this.tracker.aggregate(),
        }),
      )
      return
    }

    if (req.method === 'GET' && pathname === '/api/config') {
      const config = this.options.configProvider?.()
      if (!config) {
        res.writeHead(404)
        res.end()
        return
      }
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
      res.end(JSON.stringify(config))
      return
    }

    if (req.method === 'PUT' && pathname === '/api/config') {
      if (!this.isTrustedMutationOrigin(req)) {
        res.writeHead(403)
        res.end()
        return
      }
      if (!this.options.configWriter) {
        res.writeHead(404)
        res.end()
        return
      }
      try {
        const config = JSON.parse(await readBody(req)) as CodingMacroConfig
        this.options.configWriter(config)
        res.writeHead(204)
        res.end()
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: (err as Error).message }))
      }
      return
    }

    if (req.method === 'POST' && pathname === '/api/simulate') {
      if (!this.simulationEnabled || !this.isTrustedMutationOrigin(req)) {
        res.writeHead(403)
        res.end()
        return
      }
      const body = await readBody(req)
      let event: ControllerEvent | null = null
      try {
        event = parseControllerEvent(JSON.parse(body))
      } catch {
        // Invalid JSON is a bad simulated event.
      }
      if (!event) {
        res.writeHead(400)
        res.end()
        return
      }
      this.emit('controller-event', event)
      res.writeHead(204)
      res.end()
      return
    }

    if (req.method === 'POST' && pathname.startsWith(HOOK_PATH)) {
      await this.handleHook(pathname.slice(HOOK_PATH.length), req, res)
      return
    }

    if (req.method === 'POST' && pathname === '/register') {
      await this.handleRegister(req, res)
      return
    }

    // Terminal window/pane focus changes, observed by each wrapper's pty from
    // mode-1004 focus reporting. The host uses focus-out to disengage voice.
    if (req.method === 'POST' && pathname === '/focus') {
      const body = await readBody(req)
      try {
        const { wrapperId, focused } = JSON.parse(body) as { wrapperId: string; focused: boolean }
        if (typeof wrapperId === 'string' && typeof focused === 'boolean')
          this.emit('terminal-focus', { wrapperId, focused })
      } catch {
        // malformed focus report — ignore
      }
      res.writeHead(200)
      res.end()
      return
    }

    if (pathname.startsWith('/instance/')) {
      this.handleInstanceStream(pathname.slice('/instance/'.length), req, res)
      return
    }

    res.writeHead(404)
    res.end()
  }

  private get simulationEnabled(): boolean {
    return this.options.simulationEnabled === true
  }

  private isTrustedMutationOrigin(req: http.IncomingMessage): boolean {
    const origin = req.headers.origin
    if (!origin) return true // native client or curl
    return (
      origin === `http://127.0.0.1:${this.boundPort}` ||
      origin === `http://localhost:${this.boundPort}`
    )
  }

  private async handleHook(
    event: string,
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    const body = await readBody(req)
    let sessionId = 'unknown'
    let payload: unknown
    try {
      payload = JSON.parse(body)
      sessionId = (payload as { session_id?: string }).session_id ?? 'unknown'
    } catch {
      // Payload shape is the harness's internal contract — event name alone still works.
    }

    let wrapperId = instanceHeader(req)
    // GUI host fallback: a usesPty:false host drives a desktop app that has no
    // CODINGMACRO_INSTANCE_ID env, so its hooks arrive with an empty/missing
    // header — attribute them to the host wrapper so state reaches the
    // tracker. usesPty defaults true, so this is a no-op for CLI harnesses.
    // Claude-origin hooks also arrive header-less (any unwrapped Claude Code
    // session posts here); their transcript_path lives under ~/.claude — skip
    // them, or foreign sessions become phantom "agents" that steal focus.
    const claudeOrigin =
      typeof (payload as { transcript_path?: unknown })?.transcript_path === 'string' &&
      ((payload as { transcript_path: string }).transcript_path.includes('/.claude/') ||
        (payload as { transcript_path: string }).transcript_path.includes('/.config/claude/'))
    if (!wrapperId && !claudeOrigin && this.hostWrapperId && this.hostHarness.usesPty === false)
      wrapperId = this.hostWrapperId

    // Only sessions owned by an active wrapper (the host's own agent or a
    // registered client) drive the FSM. Header-less hooks come from agent
    // sessions codingmacro never wrapped; when scoping is on they are ignored —
    // cwd cannot disambiguate sessions sharing a directory.
    let trusted: boolean
    let harness: Harness = this.hostHarness
    if (wrapperId) {
      trusted = this.isActiveOwner(wrapperId)
      harness = this.wrapperHarness.get(wrapperId) ?? this.hostHarness
      if (trusted) this.sessionOwners.set(sessionId, wrapperId)
    } else {
      trusted = !this.hostWrapperId // filtering off (bare server in tests)
    }

    const paneHeader = req.headers[HERDR_PANE_HEADER]
    const herdrPaneId = Array.isArray(paneHeader) ? paneHeader[0] : paneHeader

    if (trusted) {
      // Ground truth that dictation ended without a controller press: tap-mode
      // auto-submit fires this hook the instant the transcript is sent. The
      // host uses it to drop stale voice tracking (a stale Space toggle sent
      // into the now-empty prompt would START a new recording).
      if (event === 'UserPromptSubmit')
        this.emit('prompt-submit', { sessionId, hostOwned: wrapperId === this.hostWrapperId })
      let changed = false
      if (event === 'SessionEnd') {
        // Harnesses classify SessionEnd as null (caller removes) — a dead waiter
        // must not pin the FSM.
        changed = this.tracker.remove(sessionId)
        this.sessionPanes.delete(sessionId)
        if (herdrPaneId) releaseAgent(herdrPaneId)
      } else {
        const state = harness.stateForHookEvent(event, payload)
        if (state !== null) {
          changed = this.tracker.apply(sessionId, state, { focusOnStop: Boolean(wrapperId) })
          if (herdrPaneId) {
            this.sessionPanes.set(sessionId, herdrPaneId)
            reportAgentState(herdrPaneId, state, sessionId)
          }
        }
      }
      if (changed) this.emit('aggregate', this.tracker.aggregate())
    }
    res.writeHead(200)
    res.end()
  }

  private async handleRegister(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const body = await readBody(req)
    let cwd = ''
    let wrapperId: string | null = null
    let kind: string | undefined
    try {
      const registration = JSON.parse(body) as { cwd?: string; wrapperId?: string; kind?: string }
      cwd = registration.cwd ?? ''
      wrapperId = registration.wrapperId ?? null
      kind = registration.kind
    } catch {
      // cwd stays unmatched; keystrokes just won't route to this instance.
    }
    let harness = this.hostHarness
    if (kind) {
      try {
        harness = harnessFor(kind)
      } catch {
        // Unknown kind from a client — classify with the host harness as a fallback.
      }
    }
    if (wrapperId) this.wrapperHarness.set(wrapperId, harness)
    const id = String(this.nextInstanceId++)
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ instanceId: id, cwd, wrapperId }))
    logger.info('client instance registered', { id, cwd, wrapperId, kind })
    // The SSE connection on /instance/<id> completes registration.
    this.pendingInstances.set(id, { cwd, wrapperId })
  }

  private handleInstanceStream(
    id: string,
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): void {
    sse(res)
    const pending = this.pendingInstances.get(id) ?? { cwd: '', wrapperId: null }
    this.instances.set(id, { res, ...pending })
    this.pendingInstances.delete(id)
    const heartbeat = setInterval(() => res.write(': hb\n\n'), HEARTBEAT_MS)
    heartbeat.unref?.()
    req.on('close', () => {
      clearInterval(heartbeat)
      const instance = this.instances.get(id)
      if (!instance) return
      this.instances.delete(id)
      if (instance.wrapperId && this.removeSessionsForOwner(instance.wrapperId)) {
        this.emit('aggregate', this.tracker.aggregate())
      }
    })
  }
}
