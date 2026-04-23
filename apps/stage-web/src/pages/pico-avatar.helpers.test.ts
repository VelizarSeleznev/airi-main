import { describe, expect, it } from 'vitest'

import { parseAvailableVrmMotionNames, parseFastLayerOutput } from './pico-avatar.helpers'

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

describe('parseAvailableVrmMotionNames', () => {
  /**
   * @example
   * parseAvailableVrmMotionNames([
   *   { id: 'preset-vrm-motion-idle-loop', name: 'idle_loop' },
   *   { id: 'preset-vrm-motion-pack-03', name: 'VRMA_03' },
   *   { id: 'custom-motion-1', name: 'Bow' },
   * ], { preferred: ['idle_loop', 'VRMA_03'] })
   */
  it('deduplicates motion names and promotes preferred entries to the front', () => {
    const result = parseAvailableVrmMotionNames([
      { id: 'preset-vrm-motion-pack-03', name: 'VRMA_03' },
      { id: 'preset-vrm-motion-idle-loop', name: 'idle_loop' },
      { id: 'custom-motion-1', name: 'Bow' },
      { id: 'custom-motion-2', name: 'bow' },
      { id: 'fallback-only-id' },
      'VRMA_03',
    ], {
      preferred: ['idle_loop', 'VRMA_03'],
    })

    expect(result).toEqual([
      'idle_loop',
      'VRMA_03',
      'Bow',
      'fallback-only-id',
    ])
  })
})
