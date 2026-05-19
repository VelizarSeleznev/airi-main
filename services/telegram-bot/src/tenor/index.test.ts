import { describe, expect, it, vi } from 'vitest'

import { buildTenorSearchUrl, searchTenorInlineGifs, toInlineGifResult } from './index'

describe('buildTenorSearchUrl', () => {
  it('keeps the raw search query and Tenor inline defaults', () => {
    /**
     * @example
     * buildTenorSearchUrl('наши мозги думают', { apiKey: 'key' })
     */
    const url = new URL(buildTenorSearchUrl('наши мозги думают', { apiKey: 'key' }))

    expect(url.origin).toBe('https://tenor.googleapis.com')
    expect(url.pathname).toBe('/v2/search')
    expect(url.searchParams.get('q')).toBe('наши мозги думают')
    expect(url.searchParams.get('key')).toBe('key')
    expect(url.searchParams.get('client_key')).toBe('otter_sticker_bot')
    expect(url.searchParams.get('locale')).toBe('ru_RU')
    expect(url.searchParams.get('contentfilter')).toBe('medium')
    expect(url.searchParams.get('media_filter')).toBe('tinygif,nanogif,gif')
    expect(url.searchParams.get('limit')).toBe('20')
  })

  it('passes Telegram pagination through Tenor pos', () => {
    /**
     * @example
     * buildTenorSearchUrl('cat', { apiKey: 'key', pos: 'next-page' })
     */
    const url = new URL(buildTenorSearchUrl('cat', { apiKey: 'key', pos: 'next-page' }))

    expect(url.searchParams.get('pos')).toBe('next-page')
  })
})

describe('toInlineGifResult', () => {
  it('builds Telegram GIF results from Tenor tinygif media', () => {
    /**
     * @example
     * toInlineGifResult(tenorResult)
     */
    const result = toInlineGifResult({
      id: '123',
      content_description: 'thinking otter',
      tags: ['otter', 'thinking'],
      media_formats: {
        tinygif: {
          url: 'https://media.tenor.com/tiny.gif',
          dims: [220, 160],
          duration: 2.6,
        },
        nanogif: {
          url: 'https://media.tenor.com/nano.gif',
          dims: [90, 66],
          duration: 2.6,
        },
      },
    })

    expect(result?.type).toBe('gif')
    expect(result?.id).toBe('tenor-123')
    expect(result?.gif_url).toBe('https://media.tenor.com/tiny.gif')
    expect(result?.thumbnail_url).toBe('https://media.tenor.com/nano.gif')
    expect(result?.gif_width).toBe(220)
    expect(result?.gif_height).toBe(160)
    expect(result?.gif_duration).toBe(3)
    expect(result?.title).toBe('thinking otter')
  })

  it('skips Tenor results without usable media URLs', () => {
    /**
     * @example
     * toInlineGifResult(tenorResultWithoutMedia)
     */
    const result = toInlineGifResult({
      id: '123',
      media_formats: {},
    })

    expect(result).toBeUndefined()
  })
})

describe('searchTenorInlineGifs', () => {
  it('returns an empty result for empty inline queries without calling Tenor', async () => {
    /**
     * @example
     * searchTenorInlineGifs('', { apiKey: 'key', fetchImpl })
     */
    const fetchImpl = vi.fn<typeof fetch>()

    const result = await searchTenorInlineGifs('   ', { apiKey: 'key', fetchImpl })

    expect(result.results).toEqual([])
    expect(result.nextOffset).toBe('')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('maps Tenor search responses to Telegram inline results', async () => {
    /**
     * @example
     * searchTenorInlineGifs('thinking', { apiKey: 'key', fetchImpl })
     */
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        next: 'next-cursor',
        results: [
          {
            id: '123',
            content_description: 'thinking',
            media_formats: {
              tinygif: { url: 'https://media.tenor.com/tiny.gif', dims: [220, 160] },
              nanogif: { url: 'https://media.tenor.com/nano.gif', dims: [90, 66] },
            },
          },
        ],
      }),
    } as Response)

    const result = await searchTenorInlineGifs('thinking', { apiKey: 'key', fetchImpl })

    expect(result.nextOffset).toBe('next-cursor')
    expect(result.results).toHaveLength(1)
    expect(result.results[0].gif_url).toBe('https://media.tenor.com/tiny.gif')
  })
})
