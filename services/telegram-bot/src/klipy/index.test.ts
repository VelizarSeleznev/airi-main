import { describe, expect, it, vi } from 'vitest'

import { buildKlipySearchUrl, searchKlipyInlineGifs, toInlineGifResult } from './index'

describe('buildKlipySearchUrl', () => {
  it('keeps the raw search query and Klipy inline defaults', () => {
    /**
     * @example
     * buildKlipySearchUrl('наши мозги думают', { apiKey: 'key' })
     */
    const url = new URL(buildKlipySearchUrl('наши мозги думают', { apiKey: 'key' }))

    expect(url.origin).toBe('https://api.klipy.com')
    expect(url.pathname).toBe('/v2/search')
    expect(url.searchParams.get('q')).toBe('наши мозги думают')
    expect(url.searchParams.get('key')).toBe('key')
    expect(url.searchParams.get('client_key')).toBe('otter_sticker_bot')
    expect(url.searchParams.get('locale')).toBe('ru_RU')
    expect(url.searchParams.get('contentfilter')).toBe('medium')
    expect(url.searchParams.get('media_filter')).toBe('tinygif,nanogif,gif')
    expect(url.searchParams.get('limit')).toBe('20')
  })

  it('passes Telegram pagination through Klipy pos', () => {
    /**
     * @example
     * buildKlipySearchUrl('cat', { apiKey: 'key', pos: 'next-page' })
     */
    const url = new URL(buildKlipySearchUrl('cat', { apiKey: 'key', pos: 'next-page' }))

    expect(url.searchParams.get('pos')).toBe('next-page')
  })
})

describe('toInlineGifResult', () => {
  it('builds Telegram GIF results from Klipy tinygif media', () => {
    /**
     * @example
     * toInlineGifResult(klipyResult)
     */
    const result = toInlineGifResult({
      id: '123',
      content_description: 'thinking otter',
      tags: ['otter', 'thinking'],
      media_formats: {
        tinygif: {
          url: 'https://media.klipy.com/tiny.gif',
          dims: [220, 160],
          duration: 2.6,
        },
        nanogif: {
          url: 'https://media.klipy.com/nano.gif',
          dims: [90, 66],
          duration: 2.6,
        },
      },
    })

    expect(result?.type).toBe('gif')
    expect(result?.id).toBe('klipy-123')
    expect(result?.gif_url).toBe('https://media.klipy.com/tiny.gif')
    expect(result?.thumbnail_url).toBe('https://media.klipy.com/nano.gif')
    expect(result?.gif_width).toBe(220)
    expect(result?.gif_height).toBe(160)
    expect(result?.gif_duration).toBe(3)
    expect(result?.title).toBe('thinking otter')
  })

  it('skips Klipy results without usable media URLs', () => {
    /**
     * @example
     * toInlineGifResult(klipyResultWithoutMedia)
     */
    const result = toInlineGifResult({
      id: '123',
      media_formats: {},
    })

    expect(result).toBeUndefined()
  })
})

describe('searchKlipyInlineGifs', () => {
  it('returns an empty result for empty inline queries without calling Klipy', async () => {
    /**
     * @example
     * searchKlipyInlineGifs('', { apiKey: 'key', fetchImpl })
     */
    const fetchImpl = vi.fn<typeof fetch>()

    const result = await searchKlipyInlineGifs('   ', { apiKey: 'key', fetchImpl })

    expect(result.results).toEqual([])
    expect(result.nextOffset).toBe('')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('maps Klipy search responses to Telegram inline results', async () => {
    /**
     * @example
     * searchKlipyInlineGifs('thinking', { apiKey: 'key', fetchImpl })
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
              tinygif: { url: 'https://media.klipy.com/tiny.gif', dims: [220, 160] },
              nanogif: { url: 'https://media.klipy.com/nano.gif', dims: [90, 66] },
            },
          },
        ],
      }),
    } as Response)

    const result = await searchKlipyInlineGifs('thinking', { apiKey: 'key', fetchImpl })

    expect(result.nextOffset).toBe('next-cursor')
    expect(result.results).toHaveLength(1)
    expect(result.results[0].gif_url).toBe('https://media.klipy.com/tiny.gif')
  })
})
