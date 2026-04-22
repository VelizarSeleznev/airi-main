import { describe, expect, it } from 'vitest'

import { parseFastLayerOutput } from './pico-avatar.helpers'

describe('parseFastLayerOutput', () => {
  /**
   * @example
   * parseFastLayerOutput('[ag')
   */
  it('keeps the stream pending while the agent marker is incomplete', () => {
    const result = parseFastLayerOutput('[ag')

    expect(result.mode).toBe('pending')
    expect(result.spokenText).toBe('')
  })

  /**
   * @example
   * parseFastLayerOutput('[agent] I will check it now.')
   */
  it('detects the agent marker and strips it from spoken text', () => {
    const result = parseFastLayerOutput('[agent] I will check it now.')

    expect(result.mode).toBe('agent')
    expect(result.spokenText).toBe('I will check it now.')
  })

  /**
   * @example
   * parseFastLayerOutput('Hi there!')
   */
  it('treats plain output as chat text', () => {
    const result = parseFastLayerOutput('Hi there!')

    expect(result.mode).toBe('chat')
    expect(result.spokenText).toBe('Hi there!')
  })

  /**
   * @example
   * parseFastLayerOutput('[ag', { done: true })
   */
  it('falls back to chat output when the stream ends with a partial marker', () => {
    const result = parseFastLayerOutput('[ag', { done: true })

    expect(result.mode).toBe('chat')
    expect(result.spokenText).toBe('[ag')
  })
})
