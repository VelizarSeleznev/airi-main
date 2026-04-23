import { describe, expect, it } from 'vitest'

import {
  getPicoAvatarAvailableMotionNames,
  parsePicoAvatarFastLayerOutput,
  parsePicoAvatarSseBuffer,
  reducePicoAvatarSseEvent,
} from './pico-avatar-bridge-events'

describe('pico avatar bridge events', () => {
  /**
   * @example
   * expect(parsePicoAvatarSseBuffer('event: log\\ndata: {"a":1}\\n\\n')).toEqual(...)
   */
  it('parses buffered sse events and preserves the unfinished tail', () => {
    const parsed = parsePicoAvatarSseBuffer('event: log\ndata: {"a":1}\n\nevent: runtime\ndata: {"b":2}')

    expect(parsed.events).toHaveLength(1)
    expect(parsed.events[0]?.event).toBe('log')
    expect(parsed.events[0]?.data).toBe('{"a":1}')
    expect(parsed.pending).toBe('event: runtime\ndata: {"b":2}')
  })

  /**
   * @example
   * expect(parsePicoAvatarFastLayerOutput('[agent] hi')).toEqual({ mode: 'agent', spokenText: 'hi' })
   */
  it('keeps the agent marker out of the user-facing spoken text', () => {
    const result = parsePicoAvatarFastLayerOutput('[agent]  hello there')

    expect(result.mode).toBe('agent')
    expect(result.spokenText).toBe('hello there')
  })

  /**
   * @example
   * expect(getPicoAvatarAvailableMotionNames([{ id: 'idle', name: 'Idle' }], { preferred: ['Idle'] })).toEqual(['Idle'])
   */
  it('promotes preferred motion names without duplicates', () => {
    const result = getPicoAvatarAvailableMotionNames([
      { id: 'wave', name: 'Wave' },
      { id: 'idle', name: 'Idle' },
      { id: 'wave-2', name: 'wave' },
    ], {
      preferred: ['Idle'],
    })

    expect(result).toEqual(['Idle', 'Wave'])
  })

  /**
   * @example
   * expect(reducePicoAvatarSseEvent(state, event).runtimeStatus).toBe('tool limit')
   */
  it('keeps runtime status in debug state instead of assistant chat content', () => {
    const nextState = reducePicoAvatarSseEvent({
      finalText: '',
      runtimeStatus: '',
      visibleStatus: '',
      traceId: '',
      debugEvents: [],
    }, {
      event: 'runtime_status',
      payload: {
        text: 'tool limit reached',
        traceId: 'trace-123',
      },
    })

    expect(nextState.finalText).toBe('')
    expect(nextState.runtimeStatus).toBe('tool limit reached')
    expect(nextState.traceId).toBe('trace-123')
    expect(nextState.debugEvents).toHaveLength(1)
    expect(nextState.debugEvents[0]?.event).toBe('runtime_status')
  })

  /**
   * @example
   * expect(reducePicoAvatarSseEvent(state, event).finalText).toBe('done')
   */
  it('keeps assistant_final as the only conversational output', () => {
    const nextState = reducePicoAvatarSseEvent({
      finalText: '',
      runtimeStatus: '',
      visibleStatus: '',
      traceId: '',
      debugEvents: [],
    }, {
      event: 'assistant_final',
      payload: {
        text: 'done',
      },
    })

    expect(nextState.finalText).toBe('done')
    expect(nextState.runtimeStatus).toBe('')
    expect(nextState.debugEvents).toHaveLength(0)
  })
})
