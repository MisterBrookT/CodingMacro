// parseInvocation splits argv into a harness kind + forwarded args. The kind is
// resolved (and validated) later by harnessFor, so parsing stays purely lexical.

import { describe, expect, it } from 'vitest'
import { parseInvocation } from '../src/invocation.js'

describe('parseInvocation', () => {
  it('defaults to claude with no args', () => {
    expect(parseInvocation([])).toEqual({
      kind: 'claude',
      agentArgs: [],
      help: false,
      version: false,
      doctor: false,
      doctorCapture: false,
      simulate: false,
      dashboard: false,
    })
  })

  it('treats a leading flag as claude args, not a harness kind', () => {
    expect(parseInvocation(['--resume', 'x'])).toEqual({
      kind: 'claude',
      agentArgs: ['--resume', 'x'],
      help: false,
      version: false,
      doctor: false,
      doctorCapture: false,
      simulate: false,
      dashboard: false,
    })
  })

  it('takes a leading bare word as the harness kind', () => {
    expect(parseInvocation(['codex', '--foo'])).toEqual({
      kind: 'codex',
      agentArgs: ['--foo'],
      help: false,
      version: false,
      doctor: false,
      doctorCapture: false,
      simulate: false,
      dashboard: false,
    })
  })

  it('passes an unknown bare word through as the kind (cli validates it)', () => {
    expect(parseInvocation(['gemini'])).toEqual({
      kind: 'gemini',
      agentArgs: [],
      help: false,
      version: false,
      doctor: false,
      doctorCapture: false,
      simulate: false,
      dashboard: false,
    })
  })

  it('flags --help', () => {
    expect(parseInvocation(['--help']).help).toBe(true)
    expect(parseInvocation(['-h']).help).toBe(true)
  })

  it('flags the doctor subcommand', () => {
    expect(parseInvocation(['doctor'])).toEqual({
      kind: 'claude',
      agentArgs: [],
      help: false,
      version: false,
      doctor: true,
      doctorCapture: false,
      simulate: false,
      dashboard: false,
    })
  })

  it('flags doctor --capture', () => {
    const parsed = parseInvocation(['doctor', '--capture'])
    expect(parsed.doctor).toBe(true)
    expect(parsed.doctorCapture).toBe(true)
  })

  it('strips global simulator flags before resolving the harness', () => {
    expect(parseInvocation(['--simulate', '--dashboard', 'codex-app'])).toMatchObject({
      kind: 'codex-app',
      agentArgs: [],
      simulate: true,
      dashboard: true,
    })
  })

  it('--simulate implies dashboard and works after the harness name', () => {
    expect(parseInvocation(['codex', '--simulate', '--model', 'gpt-5'])).toMatchObject({
      kind: 'codex',
      agentArgs: ['--model', 'gpt-5'],
      simulate: true,
      dashboard: true,
    })
  })
})

describe('--version', () => {
  it.each([['--version'], ['-V'], ['-v']])('%s reports codingmacro, not the agent', (flag) => {
    const parsed = parseInvocation([flag])
    expect(parsed.version).toBe(true)
    expect(parsed.agentArgs).toEqual([])
  })

  it('passes --version through when a harness is named', () => {
    const parsed = parseInvocation(['claude', '--version'])
    expect(parsed.version).toBe(false)
    expect(parsed.agentArgs).toEqual(['--version'])
  })
})
