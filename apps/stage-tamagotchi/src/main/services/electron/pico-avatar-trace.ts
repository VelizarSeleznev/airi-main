import type {
  ElectronPicoAvatarTraceEvent,
  ElectronPicoAvatarTraceSnapshot,
} from '../../../shared/eventa'

/**
 * Parses PicoClaw bridge JSONL traces into a renderer-friendly snapshot.
 *
 * Use when:
 * - The desktop devtools page needs the latest PicoClaw bridge activity
 * - You want compact summaries instead of streaming raw JSONL into the renderer
 *
 * Expects:
 * - `path` points to a JSONL file emitted by `picoclaw-dev-bridge.ts`
 * - `raw` contains one JSON object per line, with malformed lines allowed
 *
 * Returns:
 * - A normalized trace snapshot with recent events, LLM-focused events, and raw tail text
 */
export function parsePicoAvatarTrace(params: {
  path: string
  raw: string
  updatedAt: number
}): ElectronPicoAvatarTraceSnapshot | undefined {
  const entries = params.raw
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as Record<string, unknown>]
      }
      catch {
        return []
      }
    })

  if (entries.length === 0) {
    return undefined
  }

  const traceId = typeof entries[0]?.traceId === 'string'
    ? entries[0].traceId
    : params.path.split('/').pop()?.replace(/\.jsonl$/, '') ?? 'unknown'

  let messagePreview: string | undefined
  let finalText: string | undefined
  let runtimeStatusText: string | undefined

  const normalizedEvents = entries.flatMap((entry) => {
    const normalized = normalizeTraceEvent(entry)
    if (!normalized)
      return []

    if (normalized.messagePreview && !messagePreview)
      messagePreview = normalized.messagePreview
    if (normalized.event === 'turn_close' && typeof entry.finalText === 'string')
      finalText = entry.finalText
    if (normalized.event === 'turn_close' && typeof entry.runtimeStatusText === 'string')
      runtimeStatusText = entry.runtimeStatusText
    if (normalized.event === 'cli_final_candidate' && typeof normalized.text === 'string')
      finalText = normalized.text

    return [normalized]
  })

  const llmEvents = normalizedEvents
    .filter((entry) => {
      const searchable = `${entry.event} ${entry.sseEvent ?? ''} ${entry.phase ?? ''} ${entry.line ?? ''}`.toLowerCase()
      return searchable.includes('llm')
        || searchable.includes('reasoning=')
        || searchable.includes('fallback')
        || searchable.includes('assistant_final')
        || searchable.includes('runtime_status')
    })
    .slice(-20)

  const recentEvents = normalizedEvents.slice(-40)
  const rawTail = params.raw.split(/\r?\n/).slice(-80).join('\n')

  return {
    traceId,
    path: params.path,
    updatedAt: params.updatedAt,
    eventCount: normalizedEvents.length,
    messagePreview,
    finalText,
    runtimeStatusText,
    recentEvents,
    llmEvents,
    rawTail,
  }
}

/**
 * Normalizes one PicoClaw bridge trace object into a compact event model.
 *
 * Before:
 * - Raw JSONL objects with optional nested `data`, `line`, `text`, and preview fields
 *
 * After:
 * - A stable event shape used by the Electron devtools surface
 */
export function normalizeTraceEvent(entry: Record<string, unknown>): ElectronPicoAvatarTraceEvent | undefined {
  const event = typeof entry.event === 'string' ? entry.event : undefined
  if (!event)
    return undefined

  const data = isRecord(entry.data) ? entry.data : undefined

  return {
    at: typeof entry.at === 'string' ? entry.at : undefined,
    event,
    seq: typeof entry.seq === 'number' ? entry.seq : undefined,
    sseEvent: typeof entry.sseEvent === 'string' ? entry.sseEvent : undefined,
    source: typeof entry.source === 'string'
      ? entry.source
      : typeof data?.source === 'string'
        ? data.source
        : undefined,
    kind: typeof entry.kind === 'string' ? entry.kind : undefined,
    phase: typeof entry.phase === 'string'
      ? entry.phase
      : typeof data?.phase === 'string'
        ? data.phase
        : undefined,
    line: typeof entry.line === 'string'
      ? entry.line
      : typeof data?.line === 'string'
        ? data.line
        : undefined,
    text: typeof entry.text === 'string'
      ? entry.text
      : typeof data?.text === 'string'
        ? data.text
        : undefined,
    messagePreview: typeof entry.messagePreview === 'string' ? entry.messagePreview : undefined,
    retryBlockedReason: typeof entry.retryBlockedReason === 'string' ? entry.retryBlockedReason : undefined,
    classifiedAsRuntimeStatus: typeof entry.classifiedAsRuntimeStatus === 'boolean' ? entry.classifiedAsRuntimeStatus : undefined,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
