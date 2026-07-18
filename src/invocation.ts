// Command-line parsing: `codingmacro [claude|codex] [...userArgs]`.
//
// The first token is a harness kind only when it is a bare word (not a flag);
// otherwise everything is passed straight to the default harness (claude). The
// kind is NOT validated here — the cli resolves it via harnessFor, which throws
// a clear "unknown harness" error listing the registered kinds.

export interface ParsedInvocation {
  /** Harness kind to run. Defaults to 'claude'. Validated later by harnessFor. */
  kind: string
  /** Arguments forwarded verbatim to the agent CLI. */
  agentArgs: string[]
  /** True when `--help`/`-h` was requested (cli prints usage and exits). */
  help: boolean
  /** True when `--version`/`-V` was requested (cli prints codingmacro's version and exits). */
  version: boolean
  /** True when the `doctor` subcommand was requested (cli runs the diagnostic and exits). */
  doctor: boolean
  /** True when `doctor --capture` was requested (force raw capture-only mode). */
  doctorCapture: boolean
  /** Enable localhost controller-event injection from the dashboard. */
  simulate: boolean
  /** Open the local visual dashboard after startup. */
  dashboard: boolean
}

const DEFAULT_KIND = 'claude'

/**
 * Parse process argv (already sliced past node + script).
 *
 * Args:
 *     args (string[]): Raw user arguments.
 *
 * Returns:
 *     ParsedInvocation: kind + forwarded args + help flag.
 */
export function parseInvocation(args: string[]): ParsedInvocation {
  const simulate = args.includes('--simulate')
  const dashboard = simulate || args.includes('--dashboard')
  const filteredArgs = args.filter((arg) => arg !== '--simulate' && arg !== '--dashboard')
  const base = {
    kind: DEFAULT_KIND,
    agentArgs: [],
    help: false,
    version: false,
    doctor: false,
    doctorCapture: false,
    simulate,
    dashboard,
  }
  if (filteredArgs[0] === '--help' || filteredArgs[0] === '-h') {
    return { ...base, help: true }
  }
  // Leading --version/-V reports codingmacro's own version. To query the agent's
  // instead, name it: `codingmacro claude --version`.
  if (filteredArgs[0] === '--version' || filteredArgs[0] === '-V' || filteredArgs[0] === '-v') {
    return { ...base, version: true }
  }
  if (filteredArgs[0] === 'doctor') {
    return { ...base, doctor: true, doctorCapture: filteredArgs.includes('--capture') }
  }
  // A leading bare word names the harness; a leading flag (or nothing) means
  // "default harness, these are its args".
  if (
    filteredArgs.length > 0 &&
    filteredArgs[0] !== undefined &&
    !filteredArgs[0].startsWith('-')
  ) {
    return { ...base, kind: filteredArgs[0], agentArgs: filteredArgs.slice(1) }
  }
  return { ...base, agentArgs: filteredArgs }
}

export const USAGE = `codingmacro — drive an AI agent CLI with a game controller.

Usage:
  codingmacro [--dashboard] [--simulate] [claude|codex|codex-app] [...agent args]
                                             Wrap the agent CLI (default: claude);
                                             codex-app drives the Codex desktop app
  codingmacro doctor [--capture]               Diagnose your controller, write a report
                                             (--capture: record raw reports only,
                                             for pads the parsers misread)
  codingmacro --version                        Show codingmacro's version
  codingmacro --help                           Show this message

  --dashboard                                  Open visual local dashboard
  --simulate                                   Enable dashboard controls; no pad required

The first instance to start becomes the host: it owns the controller and
aggregates agent state. Later instances register as clients and receive
forwarded keystrokes. Remap controls in ~/.codingmacro/config.json.`
