export const FAST_LAYER_AGENT_MARKER = '[agent]'

export interface FastLayerOutputState {
  mode: 'pending' | 'agent' | 'chat'
  spokenText: string
}

/**
 * Normalizes the fast spoken-layer output into agent/chat mode.
 *
 * Use when:
 * - The fast streaming model may prefix its first line with `[agent]`.
 * - UI speech/display should hide the control marker from the user.
 *
 * Expects:
 * - Raw text in arrival order.
 * - `done` set to `true` once the stream has finished.
 *
 * Returns:
 * - `pending` while the stream could still be building the `[agent]` marker.
 * - `agent` when the marker is complete and should trigger PicoClaw.
 * - `chat` when no marker is present and the text should be treated as the final reply.
 */
export function parseFastLayerOutput(rawText: string, options: { done?: boolean } = {}): FastLayerOutputState {
  const done = options.done === true
  const trimmedStart = rawText.trimStart()

  if (!trimmedStart) {
    return {
      mode: 'pending',
      spokenText: '',
    }
  }

  if (trimmedStart.startsWith(FAST_LAYER_AGENT_MARKER)) {
    return {
      mode: 'agent',
      spokenText: trimmedStart.slice(FAST_LAYER_AGENT_MARKER.length).trimStart(),
    }
  }

  if (!done && FAST_LAYER_AGENT_MARKER.startsWith(trimmedStart)) {
    return {
      mode: 'pending',
      spokenText: '',
    }
  }

  return {
    mode: 'chat',
    spokenText: rawText,
  }
}
