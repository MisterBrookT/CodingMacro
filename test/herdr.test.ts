// Unit tests for the herdr bridge: openmicro state → herdr CLI arg mapping,
// and total error swallowing (herdr absent must never break the host).

import { beforeEach, describe, expect, it, vi } from 'vitest'

const execFile = vi.hoisted(() => vi.fn())
vi.mock('node:child_process', () => ({ execFile }))

import type { AgentState } from '../src/harness/types.js'
import {
  focusAgent,
  focusWorkspace,
  listAgents,
  listWorkspaces,
  releaseAgent,
  reportAgentState,
} from '../src/herdr.js'

beforeEach(() => {
  execFile.mockReset()
})

describe('reportAgentState', () => {
  it.each<[AgentState, string]>([
    ['executing', 'working'],
    ['waiting', 'blocked'],
    ['error', 'blocked'],
    ['idle', 'idle'],
    ['complete', 'idle'],
  ])('maps %s → herdr state %s', (state, herdrState) => {
    reportAgentState('pane-1', state)
    expect(execFile).toHaveBeenCalledWith(
      'herdr',
      [
        'pane',
        'report-agent',
        'pane-1',
        '--source',
        'openmicro',
        '--agent',
        'openmicro',
        '--state',
        herdrState,
        '--seq',
        expect.stringMatching(/^\d+$/),
      ],
      expect.any(Function),
    )
  })

  it('forwards the session id as --agent-session-id when given', () => {
    reportAgentState('pane-2', 'executing', 'sess-9')
    const args = execFile.mock.calls[0]![1] as string[]
    expect(args.slice(-2)).toEqual(['--agent-session-id', 'sess-9'])
  })

  it('emits strictly increasing seqs so herdr never drops a report as stale', () => {
    reportAgentState('pane-1', 'executing')
    reportAgentState('pane-1', 'waiting')
    const seqOf = (call: number): bigint => {
      const args = execFile.mock.calls[call]![1] as string[]
      return BigInt(args[args.indexOf('--seq') + 1]!)
    }
    expect(seqOf(1)).toBeGreaterThan(seqOf(0))
  })

  it('swallows synchronous spawn failures and callback errors', () => {
    execFile.mockImplementationOnce(() => {
      throw new Error('ENOENT')
    })
    expect(() => reportAgentState('pane-1', 'executing')).not.toThrow()

    execFile.mockImplementationOnce((_cmd, _args, cb: (err: Error) => void) =>
      cb(new Error('exit 1')),
    )
    expect(() => reportAgentState('pane-1', 'waiting')).not.toThrow()
  })
})

type ExecCb = (err: Error | null, stdout: string) => void

function mockStdout(stdout: string): void {
  execFile.mockImplementationOnce((_cmd: string, _args: string[], cb: ExecCb) => cb(null, stdout))
}

describe('listWorkspaces / listAgents', () => {
  it('parses the workspace list JSON', async () => {
    mockStdout('{"result":{"workspaces":[{"workspace_id":"w3"},{"workspace_id":"w6"}]}}')
    await expect(listWorkspaces()).resolves.toEqual([
      { workspace_id: 'w3' },
      { workspace_id: 'w6' },
    ])
    expect(execFile.mock.calls[0]!.slice(0, 2)).toEqual(['herdr', ['workspace', 'list']])
  })

  it('parses the agent list JSON', async () => {
    mockStdout('{"result":{"agents":[{"workspace_id":"w3","terminal_id":"term_1"}]}}')
    await expect(listAgents()).resolves.toEqual([{ workspace_id: 'w3', terminal_id: 'term_1' }])
    expect(execFile.mock.calls[0]!.slice(0, 2)).toEqual(['herdr', ['agent', 'list']])
  })

  it.each<[string, () => void]>([
    [
      'spawn throw',
      () =>
        execFile.mockImplementationOnce(() => {
          throw new Error('ENOENT')
        }),
    ],
    [
      'nonzero exit',
      () =>
        execFile.mockImplementationOnce((_c: string, _a: string[], cb: ExecCb) =>
          cb(new Error('exit 1'), ''),
        ),
    ],
    ['bad JSON', () => mockStdout('not json')],
    ['missing shape', () => mockStdout('{"result":{}}')],
  ])('returns [] on %s', async (_name, arm) => {
    arm()
    await expect(listWorkspaces()).resolves.toEqual([])
    arm()
    await expect(listAgents()).resolves.toEqual([])
  })
})

describe('focusWorkspace / focusAgent', () => {
  it('runs the herdr focus commands', async () => {
    mockStdout('{}')
    await focusWorkspace('w3')
    mockStdout('{}')
    await focusAgent('term_1')
    expect(execFile.mock.calls[0]!.slice(0, 2)).toEqual(['herdr', ['workspace', 'focus', 'w3']])
    expect(execFile.mock.calls[1]!.slice(0, 2)).toEqual(['herdr', ['agent', 'focus', 'term_1']])
  })

  it('resolves silently on failure', async () => {
    execFile.mockImplementationOnce(() => {
      throw new Error('ENOENT')
    })
    await expect(focusWorkspace('w3')).resolves.toBeUndefined()
    execFile.mockImplementationOnce((_c: string, _a: string[], cb: ExecCb) =>
      cb(new Error('exit 1'), ''),
    )
    await expect(focusAgent('term_1')).resolves.toBeUndefined()
  })
})

describe('releaseAgent', () => {
  it('releases the pane claim with matching source and agent', () => {
    releaseAgent('pane-3')
    expect(execFile).toHaveBeenCalledWith(
      'herdr',
      [
        'pane',
        'release-agent',
        'pane-3',
        '--source',
        'openmicro',
        '--agent',
        'openmicro',
        '--seq',
        expect.stringMatching(/^\d+$/),
      ],
      expect.any(Function),
    )
  })

  it('swallows spawn failures', () => {
    execFile.mockImplementationOnce(() => {
      throw new Error('ENOENT')
    })
    expect(() => releaseAgent('pane-3')).not.toThrow()
  })
})
