<script setup lang="ts">
import type { ChatProvider, SpeechProvider } from '@xsai-ext/providers/utils'
import type { Message } from '@xsai/shared-chat'

import workletUrl from '@proj-airi/stage-ui/workers/vad/process.worklet?worker&url'

import { useLLM } from '@proj-airi/stage-ui/stores/llm'
import { useConsciousnessStore } from '@proj-airi/stage-ui/stores/modules/consciousness'
import { useProvidersStore } from '@proj-airi/stage-ui/stores/providers'
import {
  Button,
  Callout,
  FieldCheckbox,
  FieldCombobox,
  FieldInput,
  FieldRange,
  FieldTextArea,
} from '@proj-airi/ui'
import { useDevicesList } from '@vueuse/core'
import { generateSpeech } from '@xsai/generate-speech'
import { storeToRefs } from 'pinia'
import { computed, onUnmounted, ref } from 'vue'

const ELEVENLABS_TOKEN_URL = 'https://api.elevenlabs.io/v1/single-use-token/realtime_scribe'
const ELEVENLABS_REALTIME_URL = 'wss://api.elevenlabs.io/v1/speech-to-text/realtime'
const SCRIBE_MODEL_ID = 'scribe_v2_realtime'
const INWORLD_PROVIDER_ID = 'inworld-tts'
const INWORLD_DEFAULT_BASE_URL = 'https://api.inworld.ai/tts/v1/'
const INWORLD_DEFAULT_MODEL = 'inworld-tts-1.5-mini'
const INWORLD_DEFAULT_VOICE = 'Darlene'
const MAX_HISTORY_MESSAGES = 8

interface ConversationTurn {
  role: 'user' | 'assistant'
  text: string
}

const providersStore = useProvidersStore()
const llmStore = useLLM()
const consciousnessStore = useConsciousnessStore()
const { providers } = storeToRefs(providersStore)
const { activeProvider, activeModel } = storeToRefs(consciousnessStore)

const { audioInputs } = useDevicesList({
  constraints: { audio: true },
  requestPermissions: false,
})

const elevenLabsApiKey = ref('')
const selectedAudioInput = ref('')
const selectedLanguage = ref('en')
const autoSpeak = ref(true)
const systemPrompt = ref('You are a concise, friendly voice companion. Keep answers short, natural, and easy to speak aloud.')
const llmProviderId = ref(activeProvider.value || 'lm-studio')
const llmModel = ref(activeModel.value || '')
const inworldApiKey = ref((providers.value[INWORLD_PROVIDER_ID]?.apiKey as string | undefined) || '')
const inworldBaseUrl = ref((providers.value[INWORLD_PROVIDER_ID]?.baseUrl as string | undefined) || INWORLD_DEFAULT_BASE_URL)
const inworldModel = ref((providers.value[INWORLD_PROVIDER_ID]?.model as string | undefined) || INWORLD_DEFAULT_MODEL)
const inworldVoice = ref((providers.value[INWORLD_PROVIDER_ID]?.voice as string | undefined) || INWORLD_DEFAULT_VOICE)
const inworldSpeed = ref(Number((providers.value[INWORLD_PROVIDER_ID]?.speed as number | undefined) || 1))

const isListening = ref(false)
const isGenerating = ref(false)
const isSpeaking = ref(false)
const partialTranscript = ref('')
const committedTranscript = ref('')
const assistantDraft = ref('')
const lastError = ref('')
const logs = ref<string[]>([])
const conversation = ref<ConversationTurn[]>([])

const selectedAudioInputOptions = computed(() => {
  return audioInputs.value.map(device => ({
    label: device.label || `Input ${device.deviceId.slice(0, 8)}`,
    value: device.deviceId,
  }))
})

const languageOptions = [
  { label: 'English', value: 'en' },
  { label: 'Russian', value: 'ru' },
  { label: 'Japanese', value: 'ja' },
]

const llmProviderOptions = computed(() => {
  return providersStore.configuredChatProvidersMetadata.map(provider => ({
    label: provider.localizedName || provider.name || provider.id,
    value: provider.id,
  }))
})

const statusLabel = computed(() => {
  if (isGenerating.value)
    return 'Thinking with local Gemma...'
  if (isSpeaking.value)
    return 'Speaking with Inworld TTS...'
  if (isListening.value)
    return 'Listening with Scribe Realtime...'
  return 'Idle'
})

let mediaStream: MediaStream | null = null
let audioContext: AudioContext | null = null
let mediaSourceNode: MediaStreamAudioSourceNode | null = null
let workletNode: AudioWorkletNode | null = null
let websocket: WebSocket | null = null
let currentAudio: HTMLAudioElement | null = null
let turnQueue = Promise.resolve()
let lastCommittedText = ''

function appendLog(message: string) {
  logs.value = [`${new Date().toLocaleTimeString()} ${message}`, ...logs.value].slice(0, 60)
}

function setError(message: string, error?: unknown) {
  lastError.value = message
  appendLog(`Error: ${message}`)
  if (error)
    console.error(message, error)
}

function clearError() {
  lastError.value = ''
}

function float32ToInt16(buffer: Float32Array) {
  const output = new Int16Array(buffer.length)

  for (let index = 0; index < buffer.length; index += 1) {
    const value = Math.max(-1, Math.min(1, buffer[index]))
    output[index] = value < 0 ? value * 0x8000 : value * 0x7FFF
  }

  return output
}

function int16ToBase64(buffer: Int16Array) {
  const bytes = new Uint8Array(buffer.buffer)
  let binary = ''

  // NOTICE: Browser `btoa` accepts a binary string, so chunk the conversion to
  // avoid blowing the call stack when streaming many PCM frames.
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000))
  }

  return globalThis.btoa(binary)
}

async function createScribeToken() {
  const response = await fetch(ELEVENLABS_TOKEN_URL, {
    method: 'POST',
    headers: {
      'xi-api-key': elevenLabsApiKey.value.trim(),
    },
  })

  if (!response.ok) {
    throw new Error(`Failed to create Scribe token: ${response.status} ${await response.text()}`)
  }

  const payload = await response.json() as { token?: string }
  if (!payload.token)
    throw new Error('Scribe token response did not include a token.')

  return payload.token
}

function buildScribeUrl(token: string) {
  const url = new URL(ELEVENLABS_REALTIME_URL)

  url.searchParams.set('model_id', SCRIBE_MODEL_ID)
  url.searchParams.set('token', token)
  url.searchParams.set('audio_format', 'pcm_16000')
  url.searchParams.set('language_code', selectedLanguage.value)
  url.searchParams.set('commit_strategy', 'vad')
  url.searchParams.set('vad_silence_threshold_secs', '0.7')
  url.searchParams.set('vad_threshold', '0.45')
  url.searchParams.set('min_speech_duration_ms', '120')
  url.searchParams.set('min_silence_duration_ms', '150')

  return url.toString()
}

function stopAudioPlayback() {
  if (!currentAudio)
    return

  currentAudio.pause()
  currentAudio.src = ''
  currentAudio = null
  isSpeaking.value = false
}

async function disposeListeningGraph() {
  if (mediaSourceNode) {
    mediaSourceNode.disconnect()
    mediaSourceNode = null
  }

  if (workletNode) {
    workletNode.port.onmessage = null
    workletNode.disconnect()
    workletNode = null
  }

  if (mediaStream) {
    mediaStream.getTracks().forEach(track => track.stop())
    mediaStream = null
  }

  if (audioContext && audioContext.state !== 'closed') {
    await audioContext.close()
    audioContext = null
  }
}

async function stopListening() {
  isListening.value = false

  if (websocket) {
    websocket.close()
    websocket = null
  }

  await disposeListeningGraph()
}

function enqueueTurn(text: string) {
  turnQueue = turnQueue.finally(async () => {
    await handleCommittedTurn(text)
  })
}

async function handleCommittedTurn(text: string) {
  const trimmed = text.trim()
  if (!trimmed)
    return

  committedTranscript.value = trimmed
  conversation.value.push({ role: 'user', text: trimmed })
  assistantDraft.value = ''
  appendLog(`User: ${trimmed}`)

  try {
    const reply = await generateAssistantReply(trimmed)
    if (!reply.trim())
      return

    conversation.value.push({ role: 'assistant', text: reply })
    appendLog(`Assistant: ${reply}`)

    if (autoSpeak.value)
      await speakWithInworld(reply)
  }
  catch (error) {
    setError('Failed to generate or speak the assistant response.', error)
  }
}

function buildConversationMessages(nextUserText: string): Message[] {
  const historyMessages = conversation.value
    .slice(-MAX_HISTORY_MESSAGES)
    .map(turn => ({
      role: turn.role,
      content: turn.text,
    })) as Message[]

  const messages: Message[] = []
  if (systemPrompt.value.trim()) {
    messages.push({
      role: 'system',
      content: systemPrompt.value.trim(),
    } as Message)
  }

  messages.push(...historyMessages)
  messages.push({
    role: 'user',
    content: nextUserText,
  } as Message)

  return messages
}

async function generateAssistantReply(nextUserText: string) {
  const providerId = llmProviderId.value.trim()
  const model = llmModel.value.trim()
  if (!providerId || !model)
    throw new Error('LLM provider and model are required.')

  const provider = await providersStore.getProviderInstance<ChatProvider>(providerId)
  if (!provider)
    throw new Error(`Failed to initialize LLM provider "${providerId}".`)

  const chunks: string[] = []
  isGenerating.value = true

  try {
    await llmStore.stream(model, provider, buildConversationMessages(nextUserText), {
      waitForTools: false,
      onStreamEvent: async (event) => {
        if (event.type !== 'text-delta')
          return

        chunks.push(event.text)
        assistantDraft.value = chunks.join('')
      },
    })
  }
  finally {
    isGenerating.value = false
  }

  const text = chunks.join('').trim()
  assistantDraft.value = text
  return text
}

function applyInworldProviderConfig() {
  providers.value[INWORLD_PROVIDER_ID] = {
    ...providers.value[INWORLD_PROVIDER_ID],
    apiKey: inworldApiKey.value.trim(),
    baseUrl: inworldBaseUrl.value.trim() || INWORLD_DEFAULT_BASE_URL,
    model: inworldModel.value.trim() || INWORLD_DEFAULT_MODEL,
    voice: inworldVoice.value.trim() || INWORLD_DEFAULT_VOICE,
    speed: inworldSpeed.value,
    voiceSettings: {
      speed: inworldSpeed.value,
    },
  }
}

async function speakWithInworld(text: string) {
  if (!text.trim())
    return

  applyInworldProviderConfig()
  await providersStore.disposeProviderInstance(INWORLD_PROVIDER_ID)

  const provider = await providersStore.getProviderInstance<SpeechProvider<string>>(INWORLD_PROVIDER_ID)
  if (!provider)
    throw new Error('Failed to initialize Inworld TTS provider.')

  const providerConfig = providersStore.getProviderConfig(INWORLD_PROVIDER_ID)
  const audio = await generateSpeech({
    ...provider.speech(inworldModel.value || INWORLD_DEFAULT_MODEL, providerConfig),
    input: text,
    voice: inworldVoice.value || INWORLD_DEFAULT_VOICE,
  })

  stopAudioPlayback()

  const blob = new Blob([audio], { type: 'audio/mpeg' })
  const url = URL.createObjectURL(blob)
  const player = new Audio(url)

  currentAudio = player
  isSpeaking.value = true

  await new Promise<void>((resolve, reject) => {
    player.onended = () => {
      URL.revokeObjectURL(url)
      if (currentAudio === player)
        currentAudio = null
      isSpeaking.value = false
      resolve()
    }

    player.onerror = () => {
      URL.revokeObjectURL(url)
      if (currentAudio === player)
        currentAudio = null
      isSpeaking.value = false
      reject(new Error('Inworld audio playback failed.'))
    }

    void player.play().catch(reject)
  })
}

async function startListening() {
  clearError()

  if (!elevenLabsApiKey.value.trim()) {
    setError('ElevenLabs API key is required.')
    return
  }

  if (!inworldApiKey.value.trim()) {
    setError('Inworld API key is required.')
    return
  }

  if (!llmProviderId.value.trim() || !llmModel.value.trim()) {
    setError('Configure the local Gemma provider and model first.')
    return
  }

  try {
    await stopListening()
    stopAudioPlayback()

    const token = await createScribeToken()
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        deviceId: selectedAudioInput.value ? { exact: selectedAudioInput.value } : undefined,
        echoCancellation: true,
        noiseSuppression: true,
      },
    })

    mediaStream = stream
    audioContext = new AudioContext({
      sampleRate: 16000,
      latencyHint: 'interactive',
    })

    await audioContext.audioWorklet.addModule(workletUrl)
    mediaSourceNode = audioContext.createMediaStreamSource(stream)
    workletNode = new AudioWorkletNode(audioContext, 'vad-audio-worklet-processor')

    const silentGain = audioContext.createGain()
    silentGain.gain.value = 0

    mediaSourceNode.connect(workletNode)
    workletNode.connect(silentGain)
    silentGain.connect(audioContext.destination)

    const connection = new WebSocket(buildScribeUrl(token))
    websocket = connection

    workletNode.port.onmessage = (event: MessageEvent<{ buffer?: Float32Array }>) => {
      const floatBuffer = event.data?.buffer
      if (!floatBuffer || !websocket || websocket.readyState !== WebSocket.OPEN)
        return

      const pcm16 = float32ToInt16(new Float32Array(floatBuffer))
      websocket.send(JSON.stringify({
        message_type: 'input_audio_chunk',
        audio_base_64: int16ToBase64(pcm16),
      }))
    }

    connection.onopen = () => {
      isListening.value = true
      appendLog('Scribe Realtime session started.')
    }

    connection.onclose = () => {
      appendLog('Scribe Realtime session closed.')
      void stopListening()
    }

    connection.onerror = (event) => {
      setError('Scribe Realtime connection failed.', event)
    }

    connection.onmessage = ({ data }) => {
      const payload = JSON.parse(String(data)) as Record<string, unknown>
      const type = String(payload.message_type || '')

      if (type === 'partial_transcript') {
        partialTranscript.value = String(payload.text || '')
        if (partialTranscript.value.trim())
          stopAudioPlayback()
        return
      }

      if (type === 'committed_transcript' || type === 'committed_transcript_with_timestamps') {
        const text = String(payload.text || '').trim()
        partialTranscript.value = ''
        if (!text || text === lastCommittedText)
          return

        lastCommittedText = text
        enqueueTurn(text)
        return
      }

      if (type === 'session_started') {
        appendLog('Scribe session confirmed by server.')
        return
      }

      if (type.endsWith('_error')) {
        setError(`Scribe returned ${type}.`)
      }
    }
  }
  catch (error) {
    setError('Failed to start the voice demo.', error)
    await stopListening()
  }
}

function resetDemo() {
  partialTranscript.value = ''
  committedTranscript.value = ''
  assistantDraft.value = ''
  conversation.value = []
  logs.value = []
  lastCommittedText = ''
  clearError()
  stopAudioPlayback()
}

onUnmounted(async () => {
  stopAudioPlayback()
  await stopListening()
})
</script>

<template>
  <div :class="['mx-auto flex w-full max-w-6xl flex-col gap-6 p-6']">
    <Callout theme="orange" label="Unsafe demo">
      This page is intentionally rough. It creates the ElevenLabs Scribe token in the browser, streams the microphone to Scribe Realtime,
      sends committed transcripts to your currently configured local Gemma provider, and speaks the reply through Inworld TTS.
    </Callout>

    <div :class="['grid gap-6 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)]']">
      <section :class="['flex flex-col gap-4 rounded-2xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900/70']">
        <div :class="['space-y-1']">
          <h1 :class="['text-xl font-semibold']">
            Voice Demo
          </h1>
          <p :class="['text-sm text-neutral-500 dark:text-neutral-400']">
            Scribe Realtime -> local Gemma -> Inworld TTS
          </p>
        </div>

        <FieldInput
          v-model="elevenLabsApiKey"
          label="ElevenLabs API key"
          description="Used only to mint a temporary Scribe token in the browser for this demo."
          placeholder="xi-..."
          type="password"
        />

        <FieldCombobox
          v-model="selectedAudioInput"
          label="Microphone"
          description="Leave empty to use the default device."
          :options="selectedAudioInputOptions"
          placeholder="Default microphone"
        />

        <FieldCombobox
          v-model="selectedLanguage"
          label="Scribe language"
          description="Keep it pinned unless you specifically want mixed-language detection behaviour."
          :options="languageOptions"
        />

        <FieldCombobox
          v-model="llmProviderId"
          label="LLM provider"
          description="Pick your already configured local Gemma provider, for example LM Studio or Ollama."
          :options="llmProviderOptions"
          placeholder="Select a provider"
        />

        <FieldInput
          v-model="llmModel"
          label="LLM model"
          description="This should point at your local Gemma model."
          placeholder="google/gemma-..."
        />

        <FieldInput
          v-model="inworldApiKey"
          label="Inworld API key"
          description="Used directly by the browser-side demo TTS adapter."
          placeholder="Basic ..."
          type="password"
        />

        <FieldInput
          v-model="inworldBaseUrl"
          label="Inworld base URL"
          description="Defaults to the current demo adapter endpoint."
          placeholder="https://api.inworld.ai/tts/v1/"
        />

        <FieldInput
          v-model="inworldModel"
          label="Inworld model"
          description="Mini is lower latency; Max is higher quality."
          placeholder="inworld-tts-1.5-mini"
        />

        <FieldInput
          v-model="inworldVoice"
          label="Inworld voice"
          description="Use a voice ID exposed by your Inworld account. Darlene is a safe demo default."
          placeholder="Darlene"
        />

        <FieldRange
          v-model="inworldSpeed"
          label="Inworld speed"
          description="Lower values sound steadier, higher values feel snappier."
          :min="0.7"
          :max="1.3"
          :step="0.01"
        />

        <FieldCheckbox
          v-model="autoSpeak"
          label="Auto-speak assistant replies"
          description="Turn this off if you only want to inspect the transcript and model output."
        />

        <FieldTextArea
          v-model="systemPrompt"
          label="System prompt"
          description="Keep this short. Voice UX falls apart fast when the prompt encourages long answers."
          placeholder="You are a concise, friendly voice companion..."
        />

        <div :class="['flex flex-wrap gap-3']">
          <Button :disabled="isListening" @click="startListening">
            Start demo
          </Button>
          <Button :disabled="!isListening" @click="stopListening">
            Stop demo
          </Button>
          <Button @click="resetDemo">
            Reset
          </Button>
        </div>

        <div :class="['rounded-xl border border-dashed border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700']">
          <div :class="['font-medium']">
            {{ statusLabel }}
          </div>
          <div v-if="lastError" :class="['mt-1 text-red-500']">
            {{ lastError }}
          </div>
        </div>
      </section>

      <section :class="['grid gap-6']">
        <div :class="['rounded-2xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900/70']">
          <h2 :class="['mb-3 text-lg font-semibold']">
            Live transcription
          </h2>

          <div :class="['grid gap-4 md:grid-cols-2']">
            <div :class="['rounded-xl bg-neutral-50 p-3 dark:bg-neutral-950/60']">
              <div :class="['mb-2 text-xs font-medium uppercase tracking-wide text-neutral-500 dark:text-neutral-400']">
                Partial
              </div>
              <p :class="['min-h-24 whitespace-pre-wrap text-sm']">
                {{ partialTranscript || 'No partial transcript yet.' }}
              </p>
            </div>

            <div :class="['rounded-xl bg-neutral-50 p-3 dark:bg-neutral-950/60']">
              <div :class="['mb-2 text-xs font-medium uppercase tracking-wide text-neutral-500 dark:text-neutral-400']">
                Committed
              </div>
              <p :class="['min-h-24 whitespace-pre-wrap text-sm']">
                {{ committedTranscript || 'No committed transcript yet.' }}
              </p>
            </div>
          </div>
        </div>

        <div :class="['rounded-2xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900/70']">
          <h2 :class="['mb-3 text-lg font-semibold']">
            Assistant draft
          </h2>
          <p :class="['min-h-24 whitespace-pre-wrap rounded-xl bg-neutral-50 p-3 text-sm dark:bg-neutral-950/60']">
            {{ assistantDraft || 'No assistant output yet.' }}
          </p>
        </div>

        <div :class="['rounded-2xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900/70']">
          <h2 :class="['mb-3 text-lg font-semibold']">
            Conversation
          </h2>

          <div :class="['flex max-h-[360px] flex-col gap-3 overflow-y-auto']">
            <div
              v-for="(turn, index) in conversation"
              :key="`${turn.role}-${index}`"
              :class="[
                'rounded-xl p-3 text-sm',
                turn.role === 'user'
                  ? 'bg-sky-50 dark:bg-sky-950/40'
                  : 'bg-emerald-50 dark:bg-emerald-950/40',
              ]"
            >
              <div :class="['mb-1 text-xs font-medium uppercase tracking-wide text-neutral-500 dark:text-neutral-400']">
                {{ turn.role }}
              </div>
              <p :class="['whitespace-pre-wrap']">
                {{ turn.text }}
              </p>
            </div>

            <p v-if="conversation.length === 0" :class="['text-sm text-neutral-500 dark:text-neutral-400']">
              No turns yet.
            </p>
          </div>
        </div>

        <div :class="['rounded-2xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900/70']">
          <h2 :class="['mb-3 text-lg font-semibold']">
            Log
          </h2>

          <div :class="['max-h-[280px] overflow-y-auto rounded-xl bg-neutral-950 p-3 font-mono text-xs text-neutral-100']">
            <div v-for="(line, index) in logs" :key="`${line}-${index}`" :class="['whitespace-pre-wrap']">
              {{ line }}
            </div>
            <div v-if="logs.length === 0">
              No events yet.
            </div>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>

<route lang="yaml">
meta:
  layout: settings
  title: Voice Scribe Inworld Demo
  subtitleKey: tamagotchi.settings.devtools.title
</route>
