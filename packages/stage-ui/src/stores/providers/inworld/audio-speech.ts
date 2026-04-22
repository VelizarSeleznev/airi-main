import type { SpeechProvider } from '@xsai-ext/providers/utils'

import type { ModelInfo, ProviderMetadata, VoiceInfo } from '../../providers'

const DEFAULT_BASE_URL = 'https://api.inworld.ai/tts/v1/'
const DEFAULT_MODEL = 'inworld-tts-1.5-max'
const DEFAULT_LANGUAGE_FILTER = 'EN_US'
const PROVIDER_ID = 'inworld-tts'

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeBaseUrl(value: unknown): string {
  let base = normalizeString(value)
  if (!base)
    base = DEFAULT_BASE_URL
  if (!base.endsWith('/'))
    base += '/'
  return base
}

function normalizeApiKey(value: unknown): string {
  return normalizeString(value).replace(/^Basic\s+/i, '')
}

function decodeBase64Audio(base64: string): Uint8Array {
  const binary = globalThis.atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

function pickAudioContent(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object')
    return null

  const record = payload as Record<string, unknown>
  if (typeof record.audioContent === 'string')
    return record.audioContent

  const result = record.result as Record<string, unknown> | undefined
  if (result && typeof result.audioContent === 'string')
    return result.audioContent

  return null
}

function normalizeLanguageCode(langCode: unknown): string {
  const raw = normalizeString(langCode)
  if (!raw)
    return 'en-US'

  const normalized = raw.replace('_', '-')
  if (normalized.length <= 2)
    return normalized.toLowerCase()

  return `${normalized.slice(0, 2).toLowerCase()}-${normalized.slice(3).toUpperCase()}`
}

function buildVoiceListUrl(baseUrl: string): string {
  return new URL('/voices/v1/voices', baseUrl).toString()
}

function buildTtsUrl(baseUrl: string): string {
  return new URL('voice', baseUrl).toString()
}

function mapAudioEncoding(responseFormat?: string): 'MP3' | 'WAV' {
  if (responseFormat === 'wav')
    return 'WAV'
  return 'MP3'
}

function createInworldFetch(apiKey: string, baseUrl: string) {
  return async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    if (!init?.body || typeof init.body !== 'string')
      throw new Error('Invalid speech request body.')

    const request = JSON.parse(init.body) as {
      input?: string
      model?: string
      response_format?: string
      speed?: number
      voice?: string
    }

    const response = await globalThis.fetch(buildTtsUrl(baseUrl), {
      method: 'POST',
      headers: {
        Authorization: `Basic ${normalizeApiKey(apiKey)}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text: request.input ?? '',
        voiceId: request.voice ?? '',
        modelId: request.model || DEFAULT_MODEL,
        audioConfig: {
          audioEncoding: mapAudioEncoding(request.response_format),
          sampleRateHertz: 22050,
        },
        temperature: 1.0,
        speakingRate: request.speed ?? 1,
        applyTextNormalization: 'ON',
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Inworld TTS request failed: ${response.status} ${errorText}`)
    }

    const json = await response.json() as unknown
    const audioContent = pickAudioContent(json)
    if (!audioContent) {
      throw new Error('Inworld TTS response did not include audio content.')
    }

    const audioBytes = decodeBase64Audio(audioContent)
    const audioBuffer = new ArrayBuffer(audioBytes.byteLength)
    new Uint8Array(audioBuffer).set(audioBytes)
    return new Response(audioBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'audio/mpeg',
      },
    })
  }
}

function createSpeechProvider(apiKey: string, baseUrl: string): SpeechProvider {
  return {
    speech: (model?: string) => ({
      baseURL: baseUrl,
      model: model || DEFAULT_MODEL,
      fetch: createInworldFetch(apiKey, baseUrl),
    }),
  }
}

async function listVoices(apiKey: string, baseUrl: string): Promise<VoiceInfo[]> {
  const response = await globalThis.fetch(`${buildVoiceListUrl(baseUrl)}?languages=${DEFAULT_LANGUAGE_FILTER}`, {
    headers: {
      Authorization: `Basic ${normalizeApiKey(apiKey)}`,
    },
  })

  if (!response.ok)
    return []

  const json = await response.json() as { voices?: Array<Record<string, unknown>> }
  const voices = json.voices || []

  return voices.map((voice) => {
    const voiceId = normalizeString(voice.voiceId || voice.name || voice.displayName)
    const displayName = normalizeString(voice.displayName || voice.name || voice.voiceId) || voiceId
    const langCode = normalizeLanguageCode(voice.langCode)

    return {
      id: voiceId || displayName,
      name: displayName,
      provider: PROVIDER_ID,
      description: normalizeString(voice.description),
      languages: [{
        code: langCode,
        title: langCode.toUpperCase(),
      }],
    } satisfies VoiceInfo
  })
}

/**
 * Builds the demo Inworld TTS provider used by the settings UI.
 *
 * Use when:
 * - You need a lightweight browser demo that routes the speech pipeline into
 *   Inworld's REST API.
 * - You want to keep using `speechStore.speech(...)` without rewriting the
 *   playback path.
 *
 * Expects:
 * - `baseUrlValidator` to accept absolute URLs with trailing slashes.
 * - The runtime to have browser-compatible `fetch` and `atob`.
 *
 * Returns:
 * - A provider metadata object that plugs into the existing speech store.
 * - The provider returns `audio/mpeg` bytes, which keeps Web Audio decoding
 *   working in the current player.
 */
export function buildInworldAudioSpeechProvider(
  baseUrlValidator: (baseUrl: unknown) => { errors: unknown[], reason: string, valid: boolean } | null | undefined,
): ProviderMetadata {
  return {
    id: PROVIDER_ID,
    category: 'speech',
    tasks: ['text-to-speech'],
    nameKey: 'settings.pages.providers.provider.inworld-tts.title',
    name: 'Inworld TTS',
    descriptionKey: 'settings.pages.providers.provider.inworld-tts.description',
    description: 'Demo-only Inworld TTS adapter. Browser-side Basic auth is unsafe for production.',
    icon: 'i-simple-icons:inworld',
    defaultOptions: () => ({
      baseUrl: DEFAULT_BASE_URL,
      model: DEFAULT_MODEL,
    }),
    createProvider: async (config) => {
      const apiKey = normalizeApiKey(config.apiKey)
      const baseUrl = normalizeBaseUrl(config.baseUrl)
      return createSpeechProvider(apiKey, baseUrl)
    },
    capabilities: {
      listModels: async (): Promise<ModelInfo[]> => [
        {
          id: 'inworld-tts-1.5-max',
          name: 'inworld-tts-1.5-max',
          provider: PROVIDER_ID,
          description: 'Higher quality multilingual model',
          contextLength: 0,
          deprecated: false,
        },
        {
          id: 'inworld-tts-1.5-mini',
          name: 'inworld-tts-1.5-mini',
          provider: PROVIDER_ID,
          description: 'Lower latency model',
          contextLength: 0,
          deprecated: false,
        },
      ],
      listVoices: async (config) => {
        const apiKey = normalizeApiKey(config.apiKey)
        const baseUrl = normalizeBaseUrl(config.baseUrl)

        if (!apiKey)
          return []

        try {
          return await listVoices(apiKey, baseUrl)
        }
        catch (error) {
          console.warn('Falling back to static Inworld voice list:', error)
          return [
            {
              id: 'Alex',
              name: 'Alex',
              provider: PROVIDER_ID,
              description: 'Energetic and expressive mid-range male voice.',
              languages: [{ code: 'en-US', title: 'EN-US' }],
            },
            {
              id: 'Darlene',
              name: 'Darlene',
              provider: PROVIDER_ID,
              description: 'Soothing female voice.',
              languages: [{ code: 'en-US', title: 'EN-US' }],
            },
            {
              id: 'Dennis',
              name: 'Dennis',
              provider: PROVIDER_ID,
              description: 'Calm and friendly male voice.',
              languages: [{ code: 'en-US', title: 'EN-US' }],
            },
          ] satisfies VoiceInfo[]
        }
      },
    },
    validators: {
      chatPingCheckAvailable: false,
      validateProviderConfig: (config) => {
        const errors: Error[] = []
        if (!normalizeApiKey(config.apiKey))
          errors.push(new Error('API key is required.'))

        const baseUrlResult = baseUrlValidator(config.baseUrl)
        if (baseUrlResult) {
          return baseUrlResult
        }

        return {
          errors,
          reason: errors.map(error => error.message).join(', '),
          valid: errors.length === 0,
        }
      },
    },
  }
}
