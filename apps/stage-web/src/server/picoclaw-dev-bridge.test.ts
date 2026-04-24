import type { AddressInfo } from 'node:net'

import { createServer } from 'node:http'

import { describe, expect, it } from 'vitest'

import { buildFastLayerSystemPrompt, deriveVisibleStatus, extractTerminalRuntimeStatus, writeSse } from './picoclaw-dev-bridge'

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
    expect(result).toContain('- idle_loop (default idle loop)')
    expect(result).toContain('- VRMA_03 (curious lean-in)')
    expect(result).toContain('Do not invent new motion names.')
    expect(result).toContain('The exact ACT.motion value must stay the motion id itself')
  })
})

describe('writeSse', () => {
  /**
   * @example
   * writeSse(res, 'error', { message: 'docker failed' })
   */
  it('keeps streaming after headers have already been flushed', async () => {
    // ROOT CAUSE:
    //
    // If PicoClaw setup failed after the bridge opened its SSE stream, the
    // error path tried to set CORS headers again inside writeSse.
    //
    // Before the patch, Node threw ERR_HTTP_HEADERS_SENT here and killed Vite.
    //
    // We fixed this by only setting SSE CORS headers while response headers
    // are still mutable, then always writing the event frame.
    const server = createServer((_req, res) => {
      res.statusCode = 200
      res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
      res.flushHeaders()
      writeSse(res, 'error', { message: 'docker failed' })
      res.end()
    })

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, resolve)
    })

    try {
      const { port } = server.address() as AddressInfo
      const response = await fetch(`http://127.0.0.1:${port}`)
      const text = await response.text()

      expect(response.ok).toBe(true)
      expect(text).toContain('event: error')
      expect(text).toContain('data: {"message":"docker failed"}')
    }
    finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error)
            return
          }
          resolve()
        })
      })
    }
  })
})

describe('extractTerminalRuntimeStatus', () => {
  /**
   * @example
   * extractTerminalRuntimeStatus('Error: error processing message: LLM call failed')
   */
  it('normalizes non-zero PicoClaw exits into runtime status text', () => {
    // ROOT CAUSE:
    //
    // PicoClaw can exit non-zero after printing `Error: error processing
    // message:` without emitting the lobster final marker. Before this patch,
    // the bridge sent `done` with an empty final and the UI hid the real cause
    // behind "completed without a final assistant response".
    //
    // We fixed this by carrying the terminal CLI failure through
    // `runtime_status` so the chat surface can show the provider error.
    const result = extractTerminalRuntimeStatus([
      '10:02:16 ERR agent LLM call failed',
      'Error: error processing message: LLM call failed after retries:',
      '  Status: 404',
      '  Body: {"error":{"message":"No endpoints found for elephant-alpha."}}',
    ].join('\n'))

    expect(result).toContain('Error processing message: LLM call failed after retries:')
    expect(result).toContain('Status: 404')
    expect(result).toContain('No endpoints found for elephant-alpha.')
  })
})
