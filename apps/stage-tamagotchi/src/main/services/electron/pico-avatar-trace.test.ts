import { describe, expect, it } from 'vitest'

import { normalizeTraceEvent, parsePicoAvatarTrace } from './pico-avatar-trace'

describe('normalizeTraceEvent', () => {
  /**
   * @example
   * expect(normalizeTraceEvent({ event: 'cli_event', line: 'LLM response' })?.event).toBe('cli_event')
   */
  it('pulls nested SSE payload fields into a flat event shape', () => {
    const event = normalizeTraceEvent({
      at: '2026-04-23T10:00:00.000Z',
      event: 'sse_emit',
      seq: 12,
      sseEvent: 'runtime',
      data: {
        source: 'stdout',
        phase: 'llm_response',
        line: 'LLM response agent_id=main reasoning="keep it short"',
      },
    })

    expect(event?.event).toBe('sse_emit')
    expect(event?.sseEvent).toBe('runtime')
    expect(event?.source).toBe('stdout')
    expect(event?.phase).toBe('llm_response')
    expect(event?.line).toContain('reasoning=')
  })
})

describe('parsePicoAvatarTrace', () => {
  /**
   * @example
   * expect(parsePicoAvatarTrace({ path: '/tmp/trace.jsonl', raw, updatedAt: Date.now() })?.finalText).toContain('done')
   */
  it('extracts the latest prompt preview, LLM activity, and final text', () => {
    const raw = [
      JSON.stringify({
        at: '2026-04-23T10:00:00.000Z',
        traceId: 'trace-1',
        event: 'turn_start',
        seq: 1,
        messagePreview: 'fix the failing build',
      }),
      JSON.stringify({
        at: '2026-04-23T10:00:01.000Z',
        traceId: 'trace-1',
        event: 'cli_event',
        seq: 2,
        kind: 'runtime',
        phase: 'trace',
        line: 'LLM request iteration=1 messages_count=12',
      }),
      JSON.stringify({
        at: '2026-04-23T10:00:02.000Z',
        traceId: 'trace-1',
        event: 'cli_event',
        seq: 3,
        kind: 'runtime',
        phase: 'trace',
        line: 'LLM response reasoning="check the build output first"',
      }),
      JSON.stringify({
        at: '2026-04-23T10:00:03.000Z',
        traceId: 'trace-1',
        event: 'cli_final_candidate',
        seq: 4,
        text: 'Build fixed.',
      }),
      JSON.stringify({
        at: '2026-04-23T10:00:04.000Z',
        traceId: 'trace-1',
        event: 'turn_close',
        seq: 5,
        finalText: 'Build fixed.',
        runtimeStatusText: '',
      }),
    ].join('\n')

    const snapshot = parsePicoAvatarTrace({
      path: '/tmp/trace-1.jsonl',
      raw,
      updatedAt: 123,
    })

    expect(snapshot?.traceId).toBe('trace-1')
    expect(snapshot?.messagePreview).toBe('fix the failing build')
    expect(snapshot?.finalText).toBe('Build fixed.')
    expect(snapshot?.llmEvents).toHaveLength(2)
    expect(snapshot?.recentEvents).toHaveLength(5)
    expect(snapshot?.rawTail).toContain('LLM response')
  })
})
