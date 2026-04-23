export const FAST_LAYER_AGENT_MARKER = '[agent]'

export interface FastLayerOutputState {
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
export interface FastLayerMotionLike {
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
export function parseAvailableVrmMotionNames(
  motions: Array<string | FastLayerMotionLike>,
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
