import { describe, expect, it } from 'vitest'

import { buildFastLayerSystemPrompt, deriveVisibleStatus } from './picoclaw-dev-bridge'

describe('deriveVisibleStatus', () => {
  /**
   * @example
   * deriveVisibleStatus({ kind: 'runtime', line: 'Tool call: read_file(...)', phase: 'trace' })
   */
  it('maps read-file traces into a user-facing inspection status', () => {
    const result = deriveVisibleStatus({
      kind: 'runtime',
      phase: 'trace',
      line: '11:28:23 INF agent Tool call: read_file({"path":"foo"})',
    })

    expect(result).toBe('I am checking the relevant files.')
  })

  /**
   * @example
   * deriveVisibleStatus({ kind: 'log', line: 'ReadFileTool execution completed successfully' })
   */
  it('maps successful file reads into a discovery status', () => {
    const result = deriveVisibleStatus({
      kind: 'log',
      line: '11:28:23 DBG tool ReadFileTool execution completed successfully',
    })

    expect(result).toBe('I found something useful.')
  })

  /**
   * @example
   * deriveVisibleStatus({ kind: 'log', line: 'status: 429' })
   */
  it('maps rate limits into a fallback status', () => {
    const result = deriveVisibleStatus({
      kind: 'log',
      line: 'provider returned error status: 429',
    })

    expect(result).toBe('The current model is rate-limited, trying a fallback.')
  })
})

describe('buildFastLayerSystemPrompt', () => {
  /**
   * @example
   * buildFastLayerSystemPrompt('Stay in character.', ['idle_loop', 'VRMA_03'])
   */
  it('injects the available VRM motion allowlist into the prompt', () => {
    const result = buildFastLayerSystemPrompt('Stay in character.', ['idle_loop', 'VRMA_03'])

    expect(result).toContain('Available VRM motions in the current AIRI setup:')
    expect(result).toContain('- idle_loop')
    expect(result).toContain('- VRMA_03')
    expect(result).toContain('Do not invent new motion names.')
  })
})
