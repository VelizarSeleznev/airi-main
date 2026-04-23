export interface PicoAvatarParsedSseEvent {
  event: string
  data: string
}

/**
 * Parses a partially buffered SSE payload into complete events plus the pending tail.
 *
 * Use when:
 * - Pico Avatar bridge streams server-sent events
 * - The caller reads arbitrary chunk boundaries from `ReadableStream`
 *
 * Expects:
 * - `buffer` may contain zero, one, or many `\n\n`-delimited SSE blocks
 *
 * Returns:
 * - Fully parsed events ready for JSON decoding
 * - `pending` tail that must be prepended to the next chunk
 */
export function parsePicoAvatarSseBuffer(buffer: string): {
  events: PicoAvatarParsedSseEvent[]
  pending: string
} {
  const blocks = buffer.split('\n\n')
  const pending = blocks.pop() ?? ''
  const events = blocks.map((block) => {
    let event = 'message'
    const dataLines: string[] = []

    for (const line of block.split('\n')) {
      if (line.startsWith('event:')) {
        event = line.slice('event:'.length).trim()
        continue
      }

      if (line.startsWith('data:'))
        dataLines.push(line.slice('data:'.length).trim())
    }

    return {
      event,
      data: dataLines.join('\n'),
    }
  })

  return { events, pending }
}

export const FAST_LAYER_AGENT_MARKER = '[agent]'

export interface PicoAvatarFastLayerOutputState {
  mode: 'pending' | 'agent' | 'chat'
  spokenText: string
}

/**
 * Minimal motion entry shape used to build fast-layer prompt hints.
 *
 * Use when:
 * - Motion names come from the VRM motion store
 * - A prompt needs a compact allowlist of valid motion ids/names
 *
 * Expects:
 * - `name` and `id` are optional because some callers may only know one of them
 *
 * Returns:
 * - A motion-like object safe to normalize into a prompt allowlist
 */
export interface PicoAvatarFastLayerMotionLike {
  id?: string | null
  name?: string | null
}

function normalizeMotionName(value: string) {
  return value.trim()
}

/**
 * Builds a stable allowlist of VRM motion names for the fast-layer prompt.
 *
 * Use when:
 * - The client knows which VRM motions are currently available
 * - The fast spoken model should be told which `ACT.motion` values are valid
 *
 * Expects:
 * - Motions arrive as strings or motion-like objects with `name` / `id`
 * - `preferred` items should be shown first when present
 *
 * Returns:
 * - A deduplicated list of motion names safe to embed into a prompt
 */
export function getPicoAvatarAvailableMotionNames(
  motions: Array<string | PicoAvatarFastLayerMotionLike>,
  options: { preferred?: string[] } = {},
) {
  const seen = new Set<string>()
  const names: string[] = []

  for (const motion of motions) {
    const rawName = typeof motion === 'string'
      ? motion
      : motion.name || motion.id || ''
    const normalized = normalizeMotionName(rawName)
    if (!normalized)
      continue

    const dedupeKey = normalized.toLowerCase()
    if (seen.has(dedupeKey))
      continue

    seen.add(dedupeKey)
    names.push(normalized)
  }

  if (!options.preferred?.length)
    return names

  const preferredKeys = options.preferred
    .map(item => normalizeMotionName(item))
    .filter(Boolean)
  const preferredLookup = new Set(preferredKeys.map(item => item.toLowerCase()))
  const promoted: string[] = []

  for (const preferred of preferredKeys) {
    const match = names.find(item => item.toLowerCase() === preferred.toLowerCase())
    if (match)
      promoted.push(match)
  }

  return [
    ...promoted,
    ...names.filter(item => !preferredLookup.has(item.toLowerCase())),
  ]
}

/**
 * Normalizes the fast spoken-layer output into agent/chat mode.
 *
 * Use when:
 * - The fast streaming model may prefix its first line with `[agent]`
 * - UI speech/display should hide the control marker from the user
 *
 * Expects:
 * - Raw text in arrival order
 * - `done` set to `true` once the stream has finished
 *
 * Returns:
 * - `pending` while the stream could still be building the `[agent]` marker
 * - `agent` when the marker is complete and should trigger PicoClaw
 * - `chat` when no marker is present and the text should be treated as the final reply
 */
export function parsePicoAvatarFastLayerOutput(
  rawText: string,
  options: { done?: boolean } = {},
): PicoAvatarFastLayerOutputState {
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

export interface PicoAvatarDecodedSseEvent {
  event: string
  payload: Record<string, unknown>
}

/**
 * Normalizes one Pico Avatar debug event into boundary-friendly state transitions.
 *
 * Use when:
 * - The bridge emits assistant, runtime, status, and error events over SSE
 * - UI needs to separate conversational content from debug-only diagnostics
 *
 * Expects:
 * - `current` represents the accumulated state for one request
 * - `nextEvent` is already JSON-decoded
 *
 * Returns:
 * - Updated accumulated state that keeps debug events out of chat content
 */
export function reducePicoAvatarSseEvent(
  current: {
    finalText: string
    runtimeStatus: string
    visibleStatus: string
    traceId: string
    debugEvents: PicoAvatarDecodedSseEvent[]
  },
  nextEvent: PicoAvatarDecodedSseEvent,
) {
  const nextState = {
    ...current,
    debugEvents: [...current.debugEvents],
  }

  if (!nextState.traceId && typeof nextEvent.payload.traceId === 'string')
    nextState.traceId = nextEvent.payload.traceId

  if (nextEvent.event === 'assistant_final') {
    nextState.finalText = typeof nextEvent.payload.text === 'string'
      ? nextEvent.payload.text
      : nextState.finalText
    return nextState
  }

  if (nextEvent.event === 'runtime_status') {
    nextState.runtimeStatus = typeof nextEvent.payload.text === 'string'
      ? nextEvent.payload.text
      : nextState.runtimeStatus
    nextState.debugEvents.push(nextEvent)
    return nextState
  }

  if (nextEvent.event === 'visible_status') {
    nextState.visibleStatus = typeof nextEvent.payload.text === 'string'
      ? nextEvent.payload.text
      : nextState.visibleStatus
    nextState.debugEvents.push(nextEvent)
    return nextState
  }

  if (nextEvent.event === 'done') {
    if (!nextState.finalText && typeof nextEvent.payload.finalText === 'string')
      nextState.finalText = nextEvent.payload.finalText
    if (!nextState.runtimeStatus && typeof nextEvent.payload.runtimeStatus === 'string')
      nextState.runtimeStatus = nextEvent.payload.runtimeStatus
    return nextState
  }

  nextState.debugEvents.push(nextEvent)
  return nextState
}
