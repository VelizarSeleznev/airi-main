import type { InlineQueryResultGif } from 'grammy/types'

import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'

const TENOR_SEARCH_URL = 'https://tenor.googleapis.com/v2/search'
const DEFAULT_LIMIT = 20

interface TenorMediaFormat {
  url: string
  dims?: [number, number]
  duration?: number
  size?: number
}

interface TenorResult {
  id: string
  content_description?: string
  tags?: string[]
  media_formats: Record<string, TenorMediaFormat | undefined>
}

interface TenorSearchResponse {
  next?: string
  results: TenorResult[]
}

export interface TenorSearchOptions {
  /**
   * Tenor API key used for privileged API access.
   *
   * Use when:
   * - Calling Tenor v2 search from Telegram inline mode.
   * - Running integration tests against real Tenor responses.
   *
   * The use case is runtime configuration through `TENOR_API_KEY`.
   */
  apiKey: string

  /**
   * Stable integration identifier sent to Tenor as `client_key`.
   *
   * Use when:
   * - Distinguishing this bot from other apps using the same API key.
   * - Improving Tenor search telemetry for this integration.
   *
   * @default 'otter_sticker_bot'
   */
  clientKey?: string

  /**
   * Locale used by Tenor to interpret the search query.
   *
   * Use when:
   * - Users type non-English queries.
   * - Search relevance should follow a specific language.
   *
   * @default 'ru_RU'
   */
  locale?: string

  /**
   * Country hint sent to Tenor.
   *
   * Use when:
   * - Results should be localized for a specific region.
   *
   * @default 'US'
   */
  country?: string

  /**
   * Tenor content filter level.
   *
   * Use when:
   * - Inline GIF results are shown in arbitrary Telegram chats.
   *
   * @default 'medium'
   */
  contentFilter?: 'off' | 'low' | 'medium' | 'high'

  /**
   * Maximum number of GIFs returned to Telegram.
   *
   * Use when:
   * - Controlling inline-query result size and latency.
   *
   * @default 20
   */
  limit?: number

  /**
   * Tenor pagination cursor from a previous search response.
   *
   * Use when:
   * - Telegram sends the inline query offset for the next page.
   *
   * @default ''
   */
  pos?: string

  /**
   * Fetch implementation for tests and alternate runtimes.
   *
   * Use when:
   * - Mocking Tenor in unit tests.
   *
   * @default globalThis.fetch
   */
  fetchImpl?: typeof fetch
}

export interface TenorInlineSearchResult {
  /**
   * GIF results ready for Telegram `answerInlineQuery`.
   *
   * Use when:
   * - Answering a Telegram inline query.
   *
   * Returns:
   * - At most `limit` Telegram GIF result objects.
   */
  results: InlineQueryResultGif[]

  /**
   * Cursor for Telegram `next_offset`.
   *
   * Use when:
   * - Telegram asks for the next inline result page.
   *
   * Returns:
   * - Empty string when Tenor has no next page.
   */
  nextOffset: string
}

/**
 * Searches Tenor and converts GIFs into Telegram inline results.
 *
 * Use when:
 * - A Telegram inline query should show Tenor GIF previews.
 * - The bot is invoked as `@bot query` from any chat.
 *
 * Expects:
 * - `query` is the user's raw inline query text.
 * - `options.apiKey` is a valid Tenor v2 API key.
 *
 * Returns:
 * - Telegram `InlineQueryResultGif` objects and a Tenor pagination cursor.
 */
export async function searchTenorInlineGifs(query: string, options: TenorSearchOptions): Promise<TenorInlineSearchResult> {
  const trimmedQuery = query.trim()
  if (trimmedQuery.length === 0) {
    return { results: [], nextOffset: '' }
  }

  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  const url = buildTenorSearchUrl(trimmedQuery, options)
  const response = await fetchImpl(url)

  if (!response.ok) {
    throw new Error(`Tenor search failed with HTTP ${response.status}`)
  }

  const payload = parseTenorSearchResponse(await response.json())
  return {
    results: payload.results.map(toInlineGifResult).filter((result): result is InlineQueryResultGif => result != null),
    nextOffset: payload.next ?? '',
  }
}

/**
 * Builds a Tenor v2 search URL with the formats Telegram needs for inline GIFs.
 *
 * Use when:
 * - Testing Tenor request parameters.
 * - Creating the runtime search URL before a fetch call.
 *
 * Expects:
 * - `query` is already trimmed and non-empty.
 *
 * Returns:
 * - A fully qualified Tenor v2 search URL.
 */
export function buildTenorSearchUrl(query: string, options: TenorSearchOptions): string {
  const url = new URL(TENOR_SEARCH_URL)
  url.searchParams.set('q', query)
  url.searchParams.set('key', options.apiKey)
  url.searchParams.set('client_key', options.clientKey ?? 'otter_sticker_bot')
  url.searchParams.set('locale', options.locale ?? 'ru_RU')
  url.searchParams.set('country', options.country ?? 'US')
  url.searchParams.set('contentfilter', options.contentFilter ?? 'medium')
  url.searchParams.set('media_filter', 'tinygif,nanogif,gif')
  url.searchParams.set('limit', String(options.limit ?? DEFAULT_LIMIT))

  if (options.pos) {
    url.searchParams.set('pos', options.pos)
  }

  return url.toString()
}

/**
 * Converts one Tenor response object into a Telegram GIF inline result.
 *
 * Use when:
 * - Mapping Tenor API responses to Bot API inline results.
 *
 * Expects:
 * - `tinygif` or `gif` exists for the sent GIF.
 * - `nanogif`, `tinygif`, or `gif` exists for the preview thumbnail.
 *
 * Returns:
 * - `undefined` when the Tenor item lacks usable media URLs.
 */
export function toInlineGifResult(result: TenorResult): InlineQueryResultGif | undefined {
  const gif = result.media_formats.tinygif ?? result.media_formats.gif
  const thumbnail = result.media_formats.nanogif ?? result.media_formats.tinygif ?? result.media_formats.gif

  if (!gif?.url || !thumbnail?.url) {
    return undefined
  }

  const [gif_width, gif_height] = gif.dims ?? []
  const title = result.content_description || result.tags?.slice(0, 3).join(', ') || 'Tenor GIF'

  return {
    type: 'gif',
    id: telegramInlineResultId(result.id),
    gif_url: gif.url,
    thumbnail_url: thumbnail.url,
    gif_width,
    gif_height,
    gif_duration: gif.duration == null ? undefined : Math.round(gif.duration),
    title,
  }
}

function telegramInlineResultId(tenorId: string): string {
  const id = `tenor-${tenorId}`
  if (Buffer.byteLength(id, 'utf8') <= 64) {
    return id
  }

  return `tenor-${createHash('sha256').update(tenorId).digest('hex').slice(0, 24)}`
}

function parseTenorSearchResponse(value: unknown): TenorSearchResponse {
  if (!isRecord(value)) {
    return { results: [] }
  }

  const rawResults = Array.isArray(value.results) ? value.results : []
  return {
    next: typeof value.next === 'string' ? value.next : '',
    results: rawResults.map(parseTenorResult).filter((result): result is TenorResult => result != null),
  }
}

function parseTenorResult(value: unknown): TenorResult | undefined {
  if (!isRecord(value) || typeof value.id !== 'string' || !isRecord(value.media_formats)) {
    return undefined
  }

  const mediaFormats: Record<string, TenorMediaFormat | undefined> = {}
  for (const [name, format] of Object.entries(value.media_formats)) {
    const parsed = parseTenorMediaFormat(format)
    if (parsed) {
      mediaFormats[name] = parsed
    }
  }

  return {
    id: value.id,
    content_description: typeof value.content_description === 'string' ? value.content_description : undefined,
    tags: Array.isArray(value.tags) ? value.tags.filter((tag): tag is string => typeof tag === 'string') : undefined,
    media_formats: mediaFormats,
  }
}

function parseTenorMediaFormat(value: unknown): TenorMediaFormat | undefined {
  if (!isRecord(value) || typeof value.url !== 'string') {
    return undefined
  }

  return {
    url: value.url,
    dims: parseDims(value.dims),
    duration: typeof value.duration === 'number' ? value.duration : undefined,
    size: typeof value.size === 'number' ? value.size : undefined,
  }
}

function parseDims(value: unknown): [number, number] | undefined {
  if (!Array.isArray(value) || value.length !== 2) {
    return undefined
  }

  const [width, height] = value
  if (typeof width !== 'number' || typeof height !== 'number') {
    return undefined
  }

  return [width, height]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value != null
}
