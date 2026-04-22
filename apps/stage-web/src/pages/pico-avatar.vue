<script setup lang="ts">
import type { ChatHistoryItem, ChatStreamEventContext, StreamingAssistantMessage } from '@proj-airi/stage-ui/types/chat'

import { BackgroundProvider } from '@proj-airi/stage-layouts/components/Backgrounds'
import { useBackgroundThemeColor } from '@proj-airi/stage-layouts/composables/theme-color'
import { useBackgroundStore } from '@proj-airi/stage-layouts/stores/background'
import { getCachedWebGPUCapabilities } from '@proj-airi/stage-shared/webgpu'
import { ChatHistory } from '@proj-airi/stage-ui/components'
import { WidgetStage } from '@proj-airi/stage-ui/components/scenes'
import { useLlmmarkerParser } from '@proj-airi/stage-ui/composables'
import { useChatOrchestratorStore } from '@proj-airi/stage-ui/stores/chat'
import { useChatMaintenanceStore } from '@proj-airi/stage-ui/stores/chat/maintenance'
import { useChatSessionStore } from '@proj-airi/stage-ui/stores/chat/session-store'
import { useChatStreamStore } from '@proj-airi/stage-ui/stores/chat/stream-store'
import { DisplayModelFormat, useDisplayModelsStore } from '@proj-airi/stage-ui/stores/display-models'
import { useLive2d } from '@proj-airi/stage-ui/stores/live2d'
import { useAiriCardStore } from '@proj-airi/stage-ui/stores/modules/airi-card'
import { useConsciousnessStore } from '@proj-airi/stage-ui/stores/modules/consciousness'
import { useSpeechStore } from '@proj-airi/stage-ui/stores/modules/speech'
import { useOnboardingStore } from '@proj-airi/stage-ui/stores/onboarding'
import { useProvidersStore } from '@proj-airi/stage-ui/stores/providers'
import { useSettings } from '@proj-airi/stage-ui/stores/settings'
import { useSpeechRuntimeStore } from '@proj-airi/stage-ui/stores/speech-runtime'
import { useVrmMotionsStore } from '@proj-airi/stage-ui/stores/vrm-motions'
import { getDefaultKokoroModel } from '@proj-airi/stage-ui/workers/kokoro/constants'
import { BasicTextarea } from '@proj-airi/ui'
import { breakpointsTailwind, useBreakpoints, useMouse } from '@vueuse/core'
import { storeToRefs } from 'pinia'
import { computed, onMounted, ref, useTemplateRef, watch } from 'vue'

import { parseFastLayerOutput } from './pico-avatar.helpers'

const LM_STUDIO_PROVIDER_ID = 'lm-studio'
const LM_STUDIO_MODEL = 'google/gemma-4-26b-a4b'
const KOKORO_PROVIDER_ID = 'kokoro-local'
const INWORLD_PROVIDER_ID = 'inworld-tts'
const INWORLD_DEFAULT_BASE_URL = 'https://api.inworld.ai/tts/v1/'
const INWORLD_DEFAULT_MODEL = 'inworld-tts-1.5-max'
const INWORLD_DEFAULT_VOICE = 'Darlene'
const PICOCLAW_SESSION_ID = 'airi:pico-avatar'

interface PicoClawBridgeStatus {
  ok: boolean
  binary?: string
  configSource?: string
  runnerKind?: 'host' | 'docker'
  persistentContainer?: boolean
  containerName?: string
  dockerImage?: string
  traceDir?: string
  providerKind?: 'lmstudio' | 'openrouter' | 'custom'
  modelName?: string
  model?: string
  apiBase?: string
  apiReachable?: boolean
  fullAccess?: boolean
  workspace?: string
  workspaceRestricted?: boolean
  error?: string
}

function getLmStudioBaseUrl() {
  if (typeof window === 'undefined')
    return '/api/lmstudio/v1/'

  return `${window.location.origin}/api/lmstudio/v1/`
}

const backgroundStore = useBackgroundStore()
const { selectedOption, sampledColor } = storeToRefs(backgroundStore)
const backgroundSurface = useTemplateRef<InstanceType<typeof BackgroundProvider>>('backgroundSurface')
const { syncBackgroundTheme } = useBackgroundThemeColor({ backgroundSurface, selectedOption, sampledColor })

const breakpoints = useBreakpoints(breakpointsTailwind)
const isMobile = breakpoints.smaller('md')
const positionCursor = useMouse()
const { scale, position, positionInPercentageString } = storeToRefs(useLive2d())

const providersStore = useProvidersStore()
const chatOrchestrator = useChatOrchestratorStore()
const chatSession = useChatSessionStore()
const chatStream = useChatStreamStore()
const chatMaintenance = useChatMaintenanceStore()
const settingsStore = useSettings()
const onboardingStore = useOnboardingStore()
const airiCardStore = useAiriCardStore()
const consciousnessStore = useConsciousnessStore()
const speechStore = useSpeechStore()
const speechRuntimeStore = useSpeechRuntimeStore()
const displayModelsStore = useDisplayModelsStore()
const vrmMotionsStore = useVrmMotionsStore()
const stageRef = ref<InstanceType<typeof WidgetStage>>()

const { messages } = storeToRefs(chatSession)
const { streamingMessage } = storeToRefs(chatStream)
const { sending } = storeToRefs(chatOrchestrator)
const { activeProvider, activeModel } = storeToRefs(consciousnessStore)
const { activeSpeechProvider, activeSpeechModel, activeSpeechVoiceId, isLoadingSpeechProviderVoices } = storeToRefs(speechStore)
const { providers } = storeToRefs(providersStore)
const { stageModelSelected, stageModelRenderer, stageModelSelectedDisplayModel } = storeToRefs(settingsStore)
const { displayModels } = storeToRefs(displayModelsStore)
const { vrmMotions } = storeToRefs(vrmMotionsStore)
const { activeCard, activeCardId, systemPrompt } = storeToRefs(airiCardStore)

const messageInput = ref('')
const bootstrapPending = ref(true)
const bootstrapError = ref<string | null>(null)
const voiceError = ref<string | null>(null)
const chatError = ref<string | null>(null)
const modelWarning = ref<string | null>(null)
const selectedSpeechProvider = ref(KOKORO_PROVIDER_ID)
const selectedVoiceId = ref('')
const selectedSpeechModel = ref('')
const inworldApiKey = ref('')
const inworldBaseUrl = ref(INWORLD_DEFAULT_BASE_URL)
const inworldSpeed = ref(1)
const voiceInputLanguage = ref('en-US')
const isListening = ref(false)
const voiceInputSupported = ref(false)
const voiceInputError = ref<string | null>(null)
const picoclawBridgeError = ref<string | null>(null)
const picoclawBridgeStatus = ref<PicoClawBridgeStatus | null>(null)
const runtimeLogs = ref<Array<{ at: string, level: 'info' | 'warn' | 'error', message: string }>>([])
const avatarUploadError = ref<string | null>(null)
const avatarUploadPending = ref(false)
const vrmMotionUploadError = ref<string | null>(null)
const vrmMotionUploadPending = ref(false)
const selectedVrmMotionId = ref('')
const fastReplyText = ref('')
const fastReplyMode = ref<'idle' | 'pending' | 'agent' | 'chat'>('idle')
const visibleStatusText = ref('')
const visibleStatusQueue = ref<string[]>([])
const lastVisibleStatusSpoken = ref('')
const llmTraceStatus = ref<'idle' | 'waiting' | 'streaming' | 'done' | 'error'>('idle')
const llmTracePrompt = ref('')
const llmTraceStartedAt = ref<number | null>(null)
const llmTraceFirstTokenAt = ref<number | null>(null)
const llmTraceElapsedMs = ref(0)
const llmTraceFinalChars = ref(0)

let recognition: any
let llmTraceTimer: ReturnType<typeof setInterval> | undefined

const historyMessages = computed(() => messages.value as unknown as ChatHistoryItem[])
const backendProviderLabel = computed(() => {
  const providerKind = picoclawBridgeStatus.value?.providerKind
  if (providerKind === 'openrouter')
    return 'openrouter'
  if (providerKind === 'custom')
    return 'custom backend'
  return 'lmstudio'
})
const backendConnected = computed(() => picoclawBridgeStatus.value?.apiReachable === true)
const picoclawConnected = computed(() => picoclawBridgeStatus.value?.ok === true)
const voiceConfigured = computed(() => {
  return activeSpeechProvider.value !== 'speech-noop'
    && !!activeSpeechModel.value
    && !!activeSpeechVoiceId.value
    && !voiceError.value
})
const availableSpeechVoices = computed(() => speechStore.availableVoices[selectedSpeechProvider.value] || [])
const selectedAvatarName = computed(() => stageModelSelectedDisplayModel.value?.name || stageModelSelected.value || 'none')
const selectedVrmMotionName = computed(() => vrmMotions.value.find(motion => motion.id === selectedVrmMotionId.value)?.name || selectedVrmMotionId.value || 'none')
const activeCardIdleVrmMotionName = computed(() => {
  const idleMotionId = activeCard.value?.extensions?.airi?.modules?.vrmMotion?.idleMotionId
  if (!idleMotionId)
    return 'idle_loop'

  return vrmMotions.value.find(motion => motion.id === idleMotionId)?.name || idleMotionId
})
const logsText = computed(() => runtimeLogs.value.map(log => `[${log.at}] ${log.level.toUpperCase()} ${log.message}`).join('\n'))
const streamingContent = computed(() => streamingMessage.value.content || '')
const streamingPreview = computed(() => (streamingContent.value || fastReplyText.value).slice(-500))
const systemPromptPreview = computed(() => (systemPrompt.value || 'No active AIRI card system prompt.').slice(0, 600))
const picoclawRuntimeSummary = computed(() => {
  const status = picoclawBridgeStatus.value
  if (!status?.ok)
    return 'PicoClaw bridge is offline.'

  return `Real PicoClaw CLI bridge. Runner=${status.runnerKind || 'unknown'}${status.persistentContainer ? ` persistent (${status.containerName || 'unnamed'})` : ''}${status.dockerImage ? ` (${status.dockerImage})` : ''}, provider=${status.providerKind || 'unknown'}, model=${status.modelName || 'unknown'} (${status.model || 'unknown'}), API=${status.apiBase || 'unknown'}, workspace=${status.workspace || 'unknown'}, restricted workspace=${status.workspaceRestricted ? 'yes' : 'no'}.`
})
const llmTraceFirstTokenMs = computed(() => {
  if (llmTraceStartedAt.value == null || llmTraceFirstTokenAt.value == null)
    return null

  return Math.round(llmTraceFirstTokenAt.value - llmTraceStartedAt.value)
})
const llmTraceApproxTokens = computed(() => Math.max(0, Math.ceil((streamingContent.value.length || llmTraceFinalChars.value) / 4)))
const llmTraceLabel = computed(() => {
  if (llmTraceStatus.value === 'idle')
    return 'LLM idle'
  if (llmTraceStatus.value === 'waiting')
    return `Waiting for first token: ${Math.round(llmTraceElapsedMs.value / 1000)}s`
  if (llmTraceStatus.value === 'streaming')
    return `Streaming: ${Math.round(llmTraceElapsedMs.value / 1000)}s, first token ${llmTraceFirstTokenMs.value ?? '?'}ms, ~${llmTraceApproxTokens.value} tokens`
  if (llmTraceStatus.value === 'done')
    return `Done: ${Math.round(llmTraceElapsedMs.value / 1000)}s, first token ${llmTraceFirstTokenMs.value ?? '?'}ms, ~${llmTraceApproxTokens.value} tokens`
  return `LLM error after ${Math.round(llmTraceElapsedMs.value / 1000)}s`
})
const selectedVoiceName = computed(() => {
  return availableSpeechVoices.value.find(voice => voice.id === activeSpeechVoiceId.value)?.name
    || activeSpeechVoiceId.value
    || 'none'
})

const speechProviderOptions = [
  { id: KOKORO_PROVIDER_ID, label: 'Kokoro local' },
  { id: INWORLD_PROVIDER_ID, label: 'Inworld TTS demo' },
]

const inworldModelOptions = [
  { id: 'inworld-tts-1.5-max', label: 'inworld-tts-1.5-max' },
  { id: 'inworld-tts-1.5-mini', label: 'inworld-tts-1.5-mini' },
]

const voiceInputLanguageOptions = [
  { id: 'en-US', label: 'English (US)' },
  { id: 'ru-RU', label: 'Russian' },
  { id: 'ja-JP', label: 'Japanese' },
]

function appendLog(level: 'info' | 'warn' | 'error', message: string) {
  const at = new Date().toLocaleTimeString()
  runtimeLogs.value = [{ at, level, message }, ...runtimeLogs.value].slice(0, 80)
  const method = level === 'error' ? console.error : level === 'warn' ? console.warn : console.info
  method(`[PicoAvatar] ${message}`)
}

function createLocalMessageId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
    return crypto.randomUUID()

  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

async function speakText(text: string, options: { behavior?: 'queue' | 'interrupt', ownerId?: string } = {}) {
  const normalized = text.trim()
  if (!normalized)
    return

  const intent = speechRuntimeStore.openIntent({
    ownerId: options.ownerId || activeCardId.value || 'pico-avatar',
    priority: options.behavior === 'interrupt' ? 'high' : 'normal',
    behavior: options.behavior || 'queue',
  })
  const parser = useLlmmarkerParser({
    onLiteral: async (literal) => {
      if (literal)
        intent.writeLiteral(literal)
    },
    onSpecial: async (special) => {
      if (special)
        intent.writeSpecial(special)
    },
  })

  await parser.consume(normalized)
  await parser.end()
  intent.writeFlush()
  intent.end()
}

function queueVisibleStatus(text: string) {
  const normalized = text.trim()
  if (!normalized)
    return
  if (normalized === lastVisibleStatusSpoken.value)
    return
  if (visibleStatusQueue.value.includes(normalized))
    return

  visibleStatusQueue.value = [...visibleStatusQueue.value, normalized]
}

let visibleStatusDrainPending = false
async function drainVisibleStatusQueue() {
  if (visibleStatusDrainPending)
    return

  visibleStatusDrainPending = true
  try {
    while (visibleStatusQueue.value.length > 0) {
      const [nextStatus, ...rest] = visibleStatusQueue.value
      visibleStatusQueue.value = rest
      visibleStatusText.value = nextStatus
      lastVisibleStatusSpoken.value = nextStatus
      await speakText(nextStatus, { behavior: 'interrupt', ownerId: 'pico-avatar-status' })
    }
  }
  finally {
    visibleStatusDrainPending = false
  }
}

function appendAssistantMessage(sessionId: string, finalText: string) {
  const assistantMessage = {
    role: 'assistant',
    content: finalText,
    slices: [{ type: 'text', text: finalText }],
    tool_results: [],
    createdAt: Date.now(),
    id: createLocalMessageId(),
  } satisfies StreamingAssistantMessage
  chatSession.appendSessionMessage(sessionId, assistantMessage)

  return assistantMessage
}

function startLlmTrace(prompt: string) {
  if (llmTraceTimer)
    clearInterval(llmTraceTimer)

  const now = performance.now()
  llmTraceStatus.value = 'waiting'
  llmTracePrompt.value = prompt
  llmTraceStartedAt.value = now
  llmTraceFirstTokenAt.value = null
  llmTraceElapsedMs.value = 0
  llmTraceFinalChars.value = 0
  llmTraceTimer = setInterval(() => {
    if (llmTraceStartedAt.value != null)
      llmTraceElapsedMs.value = performance.now() - llmTraceStartedAt.value
  }, 250)
}

function finishLlmTrace(status: 'done' | 'error') {
  if (llmTraceTimer) {
    clearInterval(llmTraceTimer)
    llmTraceTimer = undefined
  }

  if (llmTraceStartedAt.value != null)
    llmTraceElapsedMs.value = performance.now() - llmTraceStartedAt.value
  llmTraceFinalChars.value = Math.max(llmTraceFinalChars.value, streamingContent.value.length)
  llmTraceStatus.value = status
}

function setLmStudioDefaults() {
  providersStore.initializeProvider(LM_STUDIO_PROVIDER_ID)
  providersStore.markProviderAdded(LM_STUDIO_PROVIDER_ID)

  const config = providersStore.getProviderConfig(LM_STUDIO_PROVIDER_ID)
  config.baseUrl = getLmStudioBaseUrl()

  activeProvider.value = LM_STUDIO_PROVIDER_ID
  activeModel.value = LM_STUDIO_MODEL
}

async function bootstrapLmStudio() {
  appendLog('info', `Configuring LM Studio via ${getLmStudioBaseUrl()} with ${LM_STUDIO_MODEL}`)
  setLmStudioDefaults()
  const connected = await providersStore.validateProvider(LM_STUDIO_PROVIDER_ID, { force: true }).catch((error) => {
    chatError.value = error instanceof Error ? error.message : String(error)
    appendLog('error', `LM Studio validation failed: ${chatError.value}`)
    return false
  })

  if (!connected) {
    if (!chatError.value) {
      chatError.value = 'LM Studio is not reachable. Start the local server and enable CORS.'
    }
    appendLog('error', chatError.value)
    return
  }

  const models = await providersStore.fetchModelsForProvider(LM_STUDIO_PROVIDER_ID).catch(() => [])
  if (models.length > 0 && !models.some(model => model.id === LM_STUDIO_MODEL)) {
    modelWarning.value = `LM Studio is connected, but ${LM_STUDIO_MODEL} was not reported in the model list.`
    appendLog('warn', modelWarning.value)
  }
  appendLog('info', `LM Studio connected. Models reported: ${models.map(model => model.id).join(', ') || 'none'}`)
}

async function bootstrapPicoClawBridge() {
  picoclawBridgeError.value = null
  picoclawBridgeStatus.value = null

  const response = await fetch('/api/picoclaw/status').catch((error) => {
    picoclawBridgeError.value = error instanceof Error ? error.message : String(error)
    return null
  })

  if (!response) {
    appendLog('error', `PicoClaw bridge status failed: ${picoclawBridgeError.value}`)
    return
  }

  const status = await response.json() as PicoClawBridgeStatus
  if (!response.ok || !status?.ok) {
    picoclawBridgeError.value = status?.error || `PicoClaw bridge status failed with HTTP ${response.status}`
    appendLog('error', picoclawBridgeError.value || 'PicoClaw bridge status failed.')
    return
  }

  picoclawBridgeStatus.value = status
  appendLog('info', `PicoClaw bridge ready: provider=${status.providerKind || 'unknown'}, binary=${status.binary}, model=${status.modelName}, api=${status.apiBase}, traces=${status.traceDir || 'disabled'}`)
}

async function bootstrapModelBackend() {
  const providerKind = picoclawBridgeStatus.value?.providerKind

  if (providerKind === 'openrouter' || providerKind === 'custom') {
    if (!picoclawBridgeStatus.value?.apiReachable) {
      chatError.value = `${backendProviderLabel.value} is not reachable for PicoClaw.`
      appendLog('error', chatError.value)
      return
    }

    appendLog('info', `${backendProviderLabel.value} is ready for PicoClaw via ${picoclawBridgeStatus.value?.apiBase}`)
    return
  }

  await bootstrapLmStudio()
}

async function bootstrapKokoro() {
  providersStore.initializeProvider(KOKORO_PROVIDER_ID)
  providersStore.markProviderAdded(KOKORO_PROVIDER_ID)

  const capabilities = getCachedWebGPUCapabilities()
  const hasWebGPU = capabilities?.supported ?? (typeof navigator !== 'undefined' && !!navigator.gpu)
  const fp16Supported = capabilities?.fp16Supported ?? false
  const config = providersStore.getProviderConfig(KOKORO_PROVIDER_ID)
  if (!config.model)
    config.model = getDefaultKokoroModel(hasWebGPU, fp16Supported)

  const valid = await providersStore.validateProvider(KOKORO_PROVIDER_ID, { force: true }).catch((error) => {
    voiceError.value = error instanceof Error ? error.message : String(error)
    appendLog('error', `Kokoro validation failed: ${voiceError.value}`)
    return false
  })
  if (!valid) {
    if (!voiceError.value)
      voiceError.value = 'Kokoro configuration is invalid.'
    appendLog('error', voiceError.value)
    return
  }

  activeSpeechProvider.value = KOKORO_PROVIDER_ID
  activeSpeechModel.value = config.model as string
  selectedSpeechProvider.value = KOKORO_PROVIDER_ID
  selectedSpeechModel.value = activeSpeechModel.value

  const voices = await speechStore.loadVoicesForProvider(KOKORO_PROVIDER_ID)
  const preferredVoice = voices.find(voice => voice.languages.some(language => language.code.toLowerCase().startsWith('en')))
    ?? voices[0]

  if (!preferredVoice) {
    voiceError.value = 'Kokoro loaded, but no voices are available yet.'
    return
  }

  activeSpeechVoiceId.value = preferredVoice.id
  selectedVoiceId.value = preferredVoice.id
  appendLog('info', `Kokoro ready: model=${activeSpeechModel.value}, voice=${preferredVoice.id}`)
}

function ensureInworldDefaults() {
  providersStore.initializeProvider(INWORLD_PROVIDER_ID)
  providersStore.markProviderAdded(INWORLD_PROVIDER_ID)

  const config = providersStore.getProviderConfig(INWORLD_PROVIDER_ID)
  config.baseUrl = inworldBaseUrl.value || INWORLD_DEFAULT_BASE_URL
  config.model = selectedSpeechModel.value || INWORLD_DEFAULT_MODEL
  config.apiKey = inworldApiKey.value
  config.speed = inworldSpeed.value
  config.voiceSettings = {
    ...(config.voiceSettings as Record<string, unknown> | undefined),
    speed: inworldSpeed.value,
  }
}

async function applySpeechProvider(providerId = selectedSpeechProvider.value) {
  voiceError.value = null
  selectedSpeechProvider.value = providerId

  if (providerId === KOKORO_PROVIDER_ID) {
    await bootstrapKokoro()
    return
  }

  ensureInworldDefaults()
  const config = providersStore.getProviderConfig(INWORLD_PROVIDER_ID)
  if (!config.apiKey) {
    activeSpeechProvider.value = INWORLD_PROVIDER_ID
    activeSpeechModel.value = config.model as string
    activeSpeechVoiceId.value = selectedVoiceId.value || INWORLD_DEFAULT_VOICE
    voiceError.value = 'Inworld demo needs an API key before it can speak.'
    appendLog('warn', voiceError.value)
    return
  }

  const valid = await providersStore.validateProvider(INWORLD_PROVIDER_ID, { force: true }).catch((error) => {
    voiceError.value = error instanceof Error ? error.message : String(error)
    appendLog('error', `Inworld validation failed: ${voiceError.value}`)
    return false
  })
  if (!valid) {
    if (!voiceError.value)
      voiceError.value = 'Inworld demo configuration is invalid.'
    appendLog('error', voiceError.value)
    return
  }

  activeSpeechProvider.value = INWORLD_PROVIDER_ID
  activeSpeechModel.value = config.model as string

  const voices = await speechStore.loadVoicesForProvider(INWORLD_PROVIDER_ID)
  const preferredVoice = voices.find(voice => voice.id === selectedVoiceId.value)
    ?? voices.find(voice => voice.id === INWORLD_DEFAULT_VOICE)
    ?? voices[0]

  if (!preferredVoice) {
    activeSpeechVoiceId.value = selectedVoiceId.value || INWORLD_DEFAULT_VOICE
    voiceError.value = 'Inworld connected, but no voice list was returned. Using the typed fallback voice id.'
    appendLog('warn', voiceError.value)
    return
  }

  activeSpeechVoiceId.value = preferredVoice.id
  selectedVoiceId.value = preferredVoice.id
  appendLog('info', `Inworld ready: model=${activeSpeechModel.value}, voice=${preferredVoice.id}, speed=${inworldSpeed.value}`)
}

async function handleAvatarChange(modelId: string) {
  stageModelSelected.value = modelId
  await settingsStore.updateStageModel()
  appendLog('info', `Avatar selected: ${selectedAvatarName.value} (${stageModelRenderer.value || 'disabled'})`)
}

async function handleAvatarUpload(event: Event, format: DisplayModelFormat) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''

  if (!file)
    return

  avatarUploadError.value = null
  const expectedExtension = format === DisplayModelFormat.Live2dZip ? '.zip' : '.vrm'
  if (!file.name.toLowerCase().endsWith(expectedExtension)) {
    avatarUploadError.value = `Expected ${expectedExtension} file, got ${file.name}.`
    appendLog('error', avatarUploadError.value)
    return
  }

  avatarUploadPending.value = true
  const existingIds = new Set(displayModels.value.map(model => model.id))

  try {
    appendLog('info', `Importing avatar file: ${file.name}`)
    await displayModelsStore.addDisplayModel(format, file)
    const importedModel = displayModels.value.find(model => !existingIds.has(model.id))
      ?? displayModels.value.find(model => model.type === 'file' && model.name === file.name)

    if (!importedModel) {
      throw new Error('Avatar was imported but not found in the display model list.')
    }

    await handleAvatarChange(importedModel.id)
    appendLog('info', `Avatar import applied: ${importedModel.name}`)
  }
  catch (error) {
    avatarUploadError.value = error instanceof Error ? error.message : String(error)
    appendLog('error', `Avatar import failed: ${avatarUploadError.value}`)
  }
  finally {
    avatarUploadPending.value = false
  }
}

async function handleVrmMotionUpload(event: Event) {
  const input = event.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  input.value = ''

  if (files.length === 0)
    return

  vrmMotionUploadError.value = null
  vrmMotionUploadPending.value = true

  try {
    let lastImportedMotionId = ''

    for (const file of files) {
      if (!file.name.toLowerCase().endsWith('.vrma'))
        throw new Error(`Expected .vrma file, got ${file.name}.`)

      appendLog('info', `Importing VRM motion: ${file.name}`)
      const motion = await vrmMotionsStore.addVrmMotion(file)
      lastImportedMotionId = motion.id
    }

    if (lastImportedMotionId) {
      selectedVrmMotionId.value = lastImportedMotionId
      appendLog('info', `VRM motion import applied: ${selectedVrmMotionName.value}`)
    }
  }
  catch (error) {
    vrmMotionUploadError.value = error instanceof Error ? error.message : String(error)
    appendLog('error', `VRM motion import failed: ${vrmMotionUploadError.value}`)
  }
  finally {
    vrmMotionUploadPending.value = false
  }
}

async function handlePlaySelectedVrmMotion() {
  if (!selectedVrmMotionId.value) {
    vrmMotionUploadError.value = 'Select a VRM motion first.'
    appendLog('warn', vrmMotionUploadError.value)
    return
  }

  const played = await stageRef.value?.playMotionById?.(selectedVrmMotionId.value, {
    loop: false,
    restoreIdleOnFinish: true,
  })

  if (!played) {
    vrmMotionUploadError.value = `Failed to play VRM motion: ${selectedVrmMotionName.value}`
    appendLog('error', vrmMotionUploadError.value)
    return
  }

  vrmMotionUploadError.value = null
  appendLog('info', `VRM motion preview started: ${selectedVrmMotionName.value}`)
}

function handleApplySelectedMotionToCard() {
  if (!activeCard.value || !activeCardId.value || !selectedVrmMotionId.value) {
    vrmMotionUploadError.value = 'An active AIRI card and selected VRM motion are required.'
    appendLog('warn', vrmMotionUploadError.value)
    return
  }

  const nextCard = {
    ...activeCard.value,
    extensions: {
      ...activeCard.value.extensions,
      airi: {
        ...activeCard.value.extensions.airi,
        modules: {
          ...activeCard.value.extensions.airi.modules,
          vrmMotion: {
            ...activeCard.value.extensions.airi.modules.vrmMotion,
            idleMotionId: selectedVrmMotionId.value,
          },
        },
      },
    },
  }

  airiCardStore.updateCard(activeCardId.value, nextCard)
  vrmMotionUploadError.value = null
  appendLog('info', `Active AIRI card idle motion set to ${selectedVrmMotionName.value}`)
}

function setupVoiceInputSupport() {
  if (typeof window === 'undefined')
    return

  voiceInputSupported.value = 'webkitSpeechRecognition' in window || 'SpeechRecognition' in window
  if (!voiceInputSupported.value)
    appendLog('warn', 'Browser speech input is not available in this browser.')
}

function stopVoiceInput() {
  if (!recognition)
    return

  recognition.stop()
}

function startVoiceInput() {
  if (!voiceInputSupported.value || typeof window === 'undefined') {
    voiceInputError.value = 'Browser speech input is not available.'
    appendLog('error', voiceInputError.value)
    return
  }

  const Recognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
  recognition = new Recognition()
  recognition.lang = voiceInputLanguage.value
  recognition.continuous = false
  recognition.interimResults = true
  recognition.maxAlternatives = 1

  let finalText = ''
  recognition.onstart = () => {
    isListening.value = true
    voiceInputError.value = null
    appendLog('info', `Voice input started (${voiceInputLanguage.value})`)
  }
  recognition.onerror = (event: any) => {
    voiceInputError.value = event?.error ? `Voice input error: ${event.error}` : 'Voice input error.'
    appendLog('error', voiceInputError.value)
  }
  recognition.onresult = (event: any) => {
    let interimText = ''
    for (let index = event.resultIndex; index < event.results.length; index += 1) {
      const result = event.results[index]
      const transcript = result?.[0]?.transcript || ''
      if (result?.isFinal)
        finalText += transcript
      else
        interimText += transcript
    }

    const nextText = `${finalText}${interimText}`.trim()
    if (nextText)
      messageInput.value = nextText
  }
  recognition.onend = () => {
    isListening.value = false
    appendLog('info', `Voice input stopped. Draft="${messageInput.value.trim() || 'empty'}"`)
  }

  recognition.start()
}

async function bootstrapPrototype() {
  bootstrapPending.value = true
  bootstrapError.value = null
  chatError.value = null
  voiceError.value = null
  modelWarning.value = null

  if (onboardingStore.needsOnboarding)
    onboardingStore.markSetupSkipped()

  if (!stageModelSelected.value)
    stageModelSelected.value = 'preset-live2d-1'
  await displayModelsStore.initialize()
  await displayModelsStore.loadDisplayModelsFromIndexedDB()
  await vrmMotionsStore.loadVrmMotionsFromIndexedDB()
  await settingsStore.initializeStageModel()
  appendLog('info', `Avatar ready: ${selectedAvatarName.value} (${stageModelRenderer.value || 'disabled'})`)

  await bootstrapPicoClawBridge()
  await bootstrapModelBackend()
  await applySpeechProvider(selectedSpeechProvider.value)
  setupVoiceInputSupport()

  bootstrapPending.value = false

  if (chatError.value || voiceError.value || picoclawBridgeError.value) {
    bootstrapError.value = [chatError.value, voiceError.value, picoclawBridgeError.value].filter(Boolean).join(' ')
  }
}

function parseSseEvents(buffer: string) {
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

function appendRuntimeEventLog(event: string, data: Record<string, unknown>) {
  const line = typeof data.line === 'string' ? data.line : typeof data.message === 'string' ? data.message : JSON.stringify(data)
  const phase = typeof data.phase === 'string' ? `${data.phase}: ` : ''
  const level = event === 'error' ? 'error' : event === 'runtime' || event === 'visible_status' ? 'info' : 'warn'
  appendLog(level, `${phase}${line}`)
}

async function readFastLayerStream(response: Response) {
  const reader = response.body?.getReader()
  if (!reader)
    throw new Error('Fast layer did not return a readable stream.')

  const decoder = new TextDecoder()
  let pending = ''
  let rawText = ''
  let spokenText = ''
  let mode: 'pending' | 'agent' | 'chat' = 'pending'
  let spokenCursor = 0
  const intent = speechRuntimeStore.openIntent({
    ownerId: 'pico-avatar-fast',
    priority: 'high',
    behavior: 'interrupt',
  })
  const parser = useLlmmarkerParser({
    onLiteral: async (literal) => {
      if (literal)
        intent.writeLiteral(literal)
    },
    onSpecial: async (special) => {
      if (special)
        intent.writeSpecial(special)
    },
  })

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done)
        break

      const parsed = parseSseEvents(`${pending}${decoder.decode(value, { stream: true })}`)
      pending = parsed.pending

      for (const item of parsed.events) {
        const data = item.data ? JSON.parse(item.data) as Record<string, unknown> : {}

        if (item.event === 'text_delta') {
          rawText += typeof data.text === 'string' ? data.text : ''
          const nextState = parseFastLayerOutput(rawText)
          mode = nextState.mode
          spokenText = nextState.spokenText
          continue
        }

        if (item.event === 'error') {
          throw new Error(typeof data.message === 'string' ? data.message : 'Fast layer failed.')
        }
      }

      const currentState = parseFastLayerOutput(rawText)
      mode = currentState.mode
      spokenText = currentState.spokenText

      if (spokenText.length > spokenCursor) {
        const delta = spokenText.slice(spokenCursor)
        spokenCursor = spokenText.length
        fastReplyText.value = spokenText
        if (delta)
          await parser.consume(delta)
      }
    }

    const finalState = parseFastLayerOutput(rawText, { done: true })
    mode = finalState.mode
    spokenText = finalState.spokenText.trim()
    fastReplyText.value = spokenText
    fastReplyMode.value = mode

    if (spokenText.length > spokenCursor) {
      await parser.consume(spokenText.slice(spokenCursor))
      spokenCursor = spokenText.length
    }

    await parser.end()
    intent.writeFlush()
    intent.end()

    return {
      mode,
      spokenText,
    }
  }
  catch (error) {
    intent.cancel('fast-layer-failed')
    throw error
  }
}

async function readPicoClawStream(response: Response) {
  const reader = response.body?.getReader()
  if (!reader)
    throw new Error('PicoClaw bridge did not return a readable stream.')

  const decoder = new TextDecoder()
  let pending = ''
  let finalText = ''
  let runtimeStatus = ''
  let visibleStatus = ''
  let traceId = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done)
      break

    const parsed = parseSseEvents(`${pending}${decoder.decode(value, { stream: true })}`)
    pending = parsed.pending

    for (const item of parsed.events) {
      const data = item.data ? JSON.parse(item.data) as Record<string, unknown> : {}
      if (!traceId && typeof data.traceId === 'string') {
        traceId = data.traceId
        appendLog('info', `PicoClaw trace id: ${traceId}`)
      }

      if (item.event === 'assistant_final') {
        finalText = typeof data.text === 'string' ? data.text : ''
        continue
      }

      if (item.event === 'runtime_status') {
        runtimeStatus = typeof data.text === 'string' ? data.text : ''
        // NOTICE:
        // Runtime statuses are visible diagnostics, not assistant messages.
        // Keeping them out of chat history prevents the next PicoClaw turn from
        // treating bridge/tool-loop state as conversational context.
        appendLog('warn', `PicoClaw runtime status: ${runtimeStatus}`)
        continue
      }

      if (item.event === 'visible_status') {
        visibleStatus = typeof data.text === 'string' ? data.text : ''
        if (visibleStatus) {
          appendLog('info', `PicoClaw visible status: ${visibleStatus}`)
          queueVisibleStatus(visibleStatus)
          void drainVisibleStatusQueue()
        }
        continue
      }

      if (item.event === 'done') {
        if (!finalText && typeof data.finalText === 'string')
          finalText = data.finalText
        if (!runtimeStatus && typeof data.runtimeStatus === 'string')
          runtimeStatus = data.runtimeStatus
        continue
      }

      appendRuntimeEventLog(item.event, data)
    }
  }

  return {
    finalText: finalText.trim(),
    runtimeStatus: runtimeStatus.trim(),
    visibleStatus: visibleStatus.trim(),
    traceId,
  }
}

async function handleSend() {
  const text = messageInput.value.trim()
  if (!text || sending.value)
    return

  messageInput.value = ''
  chatError.value = null
  fastReplyText.value = ''
  fastReplyMode.value = 'pending'
  visibleStatusText.value = ''
  visibleStatusQueue.value = []
  lastVisibleStatusSpoken.value = ''

  try {
    startLlmTrace(text)
    appendLog('info', `Starting fast spoken layer for: "${text.slice(0, 120)}"`)

    const sessionId = chatSession.activeSessionId
    const userMessage = {
      role: 'user',
      content: text,
      createdAt: Date.now(),
      id: createLocalMessageId(),
    } satisfies ChatHistoryItem
    const context = {
      message: userMessage,
      contexts: {},
      composedMessage: [],
      input: {
        type: 'input:text',
        data: {
          text,
        },
      },
    } satisfies ChatStreamEventContext

    sending.value = true
    await chatOrchestrator.emitBeforeMessageComposedHooks(text, context)
    chatSession.appendSessionMessage(sessionId, userMessage)
    await chatOrchestrator.emitBeforeSendHooks(text, context)
    const fastLayerResponse = await fetch('/api/picoclaw/fast', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: text,
        systemPrompt: systemPrompt.value || '',
      }),
    })

    if (!fastLayerResponse.ok)
      throw new Error(`Fast layer failed with HTTP ${fastLayerResponse.status}: ${await fastLayerResponse.text()}`)

    const fastLayerResult = await readFastLayerStream(fastLayerResponse)

    if (fastLayerResult.mode !== 'agent') {
      const finalText = fastLayerResult.spokenText.trim()
      if (!finalText)
        throw new Error('Fast layer completed without a spoken response.')

      const assistantMessage = appendAssistantMessage(sessionId, finalText)
      await chatOrchestrator.emitStreamEndHooks(context)
      await chatOrchestrator.emitAssistantResponseEndHooks(finalText, context)
      await chatOrchestrator.emitAfterSendHooks(text, context)
      await chatOrchestrator.emitAssistantMessageHooks(assistantMessage, finalText, context)
      await chatOrchestrator.emitChatTurnCompleteHooks({
        output: assistantMessage,
        outputText: finalText,
        toolCalls: [],
      }, context)
      fastReplyMode.value = 'chat'
      finishLlmTrace('done')
      appendLog('info', `Fast spoken layer completed without PicoClaw: ${llmTraceLabel.value}`)
      fastReplyText.value = ''
      return
    }

    appendLog('info', 'Fast layer requested PicoClaw background work.')
    chatStream.beginStream()
    const response = await fetch('/api/picoclaw/agent', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: text,
        session: PICOCLAW_SESSION_ID,
        debug: true,
      }),
    })

    if (!response.ok)
      throw new Error(`PicoClaw bridge failed with HTTP ${response.status}: ${await response.text()}`)

    const { finalText, runtimeStatus, traceId } = await readPicoClawStream(response)
    if (runtimeStatus)
      throw new Error(traceId ? `${runtimeStatus} Trace: ${traceId}` : runtimeStatus)

    if (!finalText)
      throw new Error('PicoClaw completed without a final assistant response.')

    if (llmTraceStatus.value === 'waiting' && llmTraceStartedAt.value != null) {
      llmTraceFirstTokenAt.value = performance.now()
      llmTraceStatus.value = 'streaming'
    }

    chatStream.appendStreamLiteral(finalText)
    const assistantMessage = appendAssistantMessage(sessionId, finalText)
    await speakText(finalText, { behavior: 'queue', ownerId: 'pico-avatar-final' })
    await chatOrchestrator.emitStreamEndHooks(context)
    await chatOrchestrator.emitAssistantResponseEndHooks(finalText, context)
    await chatOrchestrator.emitAfterSendHooks(text, context)
    await chatOrchestrator.emitAssistantMessageHooks(assistantMessage, finalText, context)
    await chatOrchestrator.emitChatTurnCompleteHooks({
      output: assistantMessage,
      outputText: finalText,
      toolCalls: [],
    }, context)
    chatStream.resetStream()
    finishLlmTrace('done')
    appendLog('info', `PicoClaw response completed: ${llmTraceLabel.value}`)
    fastReplyText.value = ''
  }
  catch (error) {
    finishLlmTrace('error')
    chatStream.resetStream()
    messageInput.value = text
    chatError.value = error instanceof Error ? error.message : String(error)
    appendLog('error', `PicoClaw send failed: ${chatError.value}`)
  }
  finally {
    sending.value = false
  }
}

function handleComposerKeydown(event: KeyboardEvent) {
  if (event.key !== 'Enter' || event.shiftKey)
    return

  event.preventDefault()
  void handleSend()
}

onMounted(async () => {
  syncBackgroundTheme()
  const inworldConfig = providers.value[INWORLD_PROVIDER_ID] || {}
  inworldApiKey.value = (inworldConfig.apiKey as string | undefined) || ''
  inworldBaseUrl.value = (inworldConfig.baseUrl as string | undefined) || INWORLD_DEFAULT_BASE_URL
  selectedSpeechProvider.value = activeSpeechProvider.value === INWORLD_PROVIDER_ID ? INWORLD_PROVIDER_ID : KOKORO_PROVIDER_ID
  selectedSpeechModel.value = activeSpeechModel.value || (selectedSpeechProvider.value === INWORLD_PROVIDER_ID ? INWORLD_DEFAULT_MODEL : '')
  selectedVoiceId.value = activeSpeechVoiceId.value
  inworldSpeed.value = Number((inworldConfig.speed as number | undefined) || (inworldConfig.voiceSettings as { speed?: number } | undefined)?.speed || 1)
  await bootstrapPrototype()
})

watch(selectedVoiceId, (voiceId) => {
  if (!voiceId || activeSpeechProvider.value !== selectedSpeechProvider.value)
    return

  activeSpeechVoiceId.value = voiceId
  appendLog('info', `Voice selected: ${voiceId}`)
})

watch([selectedSpeechModel, inworldBaseUrl, inworldApiKey, inworldSpeed], () => {
  if (selectedSpeechProvider.value !== INWORLD_PROVIDER_ID)
    return

  ensureInworldDefaults()
})

watch(streamingContent, (content) => {
  if (!content)
    return
  llmTraceFinalChars.value = content.length

  if (llmTraceStatus.value === 'waiting' && llmTraceStartedAt.value != null) {
    llmTraceFirstTokenAt.value = performance.now()
    llmTraceStatus.value = 'streaming'
    appendLog('info', `First LLM token after ${llmTraceFirstTokenMs.value}ms`)
  }
})

watch(fastReplyText, (content) => {
  if (!content)
    return

  llmTraceFinalChars.value = Math.max(llmTraceFinalChars.value, content.length)

  if (llmTraceStatus.value === 'waiting' && llmTraceStartedAt.value != null) {
    llmTraceFirstTokenAt.value = performance.now()
    llmTraceStatus.value = 'streaming'
    appendLog('info', `First fast-layer token after ${llmTraceFirstTokenMs.value}ms`)
  }
})

watch(vrmMotions, (motions) => {
  if (!selectedVrmMotionId.value && motions.length > 0)
    selectedVrmMotionId.value = motions[0]!.id
}, { immediate: true })
</script>

<template>
  <BackgroundProvider
    ref="backgroundSurface"
    class="widgets top-widgets"
    :background="selectedOption"
    :top-color="sampledColor"
  >
    <div
      :class="[
        'min-h-100dvh w-full p-4 md:p-6',
        'flex gap-4 md:gap-6',
        isMobile ? 'flex-col' : 'flex-row',
      ]"
    >
      <section
        :class="[
          'relative overflow-hidden rounded-4xl border border-white/15 bg-black/20 backdrop-blur-xl',
          'min-h-[52dvh] flex-1',
          isMobile ? 'h-[52dvh]' : 'h-[calc(100dvh-3rem)]',
        ]"
      >
        <div class="pointer-events-none absolute inset-x-0 top-0 z-10 flex flex-wrap gap-2 p-4">
          <span class="rounded-full bg-black/45 px-3 py-1 text-xs text-white/80">
            avatar test
          </span>
          <span class="rounded-full px-3 py-1 text-xs" :class="backendConnected ? 'bg-emerald-500/20 text-emerald-100' : 'bg-amber-500/20 text-amber-100'">
            {{ backendConnected ? `${backendProviderLabel} connected` : `${backendProviderLabel} offline` }}
          </span>
          <span class="rounded-full px-3 py-1 text-xs" :class="picoclawConnected ? 'bg-emerald-500/20 text-emerald-100' : 'bg-red-500/20 text-red-100'">
            {{ picoclawConnected ? 'picoclaw bridge connected' : 'picoclaw bridge offline' }}
          </span>
          <span class="rounded-full px-3 py-1 text-xs" :class="voiceConfigured ? 'bg-sky-500/20 text-sky-100' : 'bg-amber-500/20 text-amber-100'">
            {{ voiceConfigured ? 'voice ready' : 'voice loading' }}
          </span>
        </div>

        <WidgetStage
          ref="stageRef"
          chat-speech-mode="off"
          :paused="false"
          :focus-at="{
            x: positionCursor.x.value,
            y: positionCursor.y.value,
          }"
          :x-offset="`${isMobile ? position.x : position.x - 8}%`"
          :y-offset="positionInPercentageString.y"
          :scale="scale"
        />
      </section>

      <aside
        :class="[
          'flex shrink-0 flex-col overflow-y-auto rounded-4xl border border-white/15 bg-white/75 p-4 text-neutral-900 shadow-2xl backdrop-blur-xl dark:bg-neutral-950/80 dark:text-neutral-100',
          isMobile ? 'min-h-[42dvh]' : 'h-[calc(100dvh-3rem)] w-[26rem] max-w-[32rem]',
        ]"
      >
        <div class="flex items-start justify-between gap-4">
          <div class="space-y-1">
            <p class="text-xs text-neutral-500 tracking-[0.25em] uppercase dark:text-neutral-400">
              AIRI x PicoClaw
            </p>
            <h1 class="text-2xl font-semibold">
              Avatar Chat Test
            </h1>
            <p class="text-sm text-neutral-600 dark:text-neutral-300">
              Fast spoken replies come from the front layer. Agent work runs through real PicoClaw CLI via {{ picoclawBridgeStatus?.modelName || 'bridge model' }}.
            </p>
          </div>

          <div class="flex items-center gap-2">
            <button
              type="button"
              class="border border-neutral-300/70 rounded-full px-3 py-1.5 text-sm text-neutral-700 transition dark:border-neutral-700 hover:bg-neutral-200/70 dark:text-neutral-200 dark:hover:bg-neutral-800"
              @click="void bootstrapPrototype()"
            >
              Retry setup
            </button>
            <button
              type="button"
              class="border border-neutral-300/70 rounded-full px-3 py-1.5 text-sm text-neutral-700 transition dark:border-neutral-700 hover:bg-neutral-200/70 dark:text-neutral-200 dark:hover:bg-neutral-800"
              @click="chatMaintenance.cleanupMessages()"
            >
              Clear
            </button>
          </div>
        </div>

        <div class="mt-4 text-xs space-y-2">
          <p v-if="bootstrapPending" class="rounded-2xl bg-neutral-900/5 px-3 py-2 text-neutral-600 dark:bg-white/5 dark:text-neutral-300">
            Bootstrapping LM Studio and local voice…
          </p>
          <p v-if="modelWarning" class="rounded-2xl bg-amber-500/10 px-3 py-2 text-amber-700 dark:text-amber-200">
            {{ modelWarning }}
          </p>
          <p v-if="bootstrapError" class="rounded-2xl bg-red-500/10 px-3 py-2 text-red-700 dark:text-red-200">
            {{ bootstrapError }}
          </p>
          <p v-else-if="chatError" class="rounded-2xl bg-red-500/10 px-3 py-2 text-red-700 dark:text-red-200">
            {{ chatError }}
          </p>
          <p v-else-if="voiceError" class="rounded-2xl bg-red-500/10 px-3 py-2 text-red-700 dark:text-red-200">
            {{ voiceError }}
          </p>
          <p
            v-else-if="isLoadingSpeechProviderVoices"
            class="rounded-2xl bg-sky-500/10 px-3 py-2 text-sky-700 dark:text-sky-200"
          >
            Loading Kokoro voice list…
          </p>
          <p v-if="voiceInputError" class="rounded-2xl bg-red-500/10 px-3 py-2 text-red-700 dark:text-red-200">
            {{ voiceInputError }}
          </p>
          <p v-if="picoclawBridgeError" class="rounded-2xl bg-red-500/10 px-3 py-2 text-red-700 dark:text-red-200">
            {{ picoclawBridgeError }}
          </p>
          <p v-if="avatarUploadError" class="rounded-2xl bg-red-500/10 px-3 py-2 text-red-700 dark:text-red-200">
            {{ avatarUploadError }}
          </p>
          <p v-if="vrmMotionUploadError" class="rounded-2xl bg-red-500/10 px-3 py-2 text-red-700 dark:text-red-200">
            {{ vrmMotionUploadError }}
          </p>
        </div>

        <div class="grid mt-4 gap-3 border border-neutral-200/70 rounded-3xl bg-white/45 p-3 text-xs dark:border-neutral-800 dark:bg-neutral-900/45">
          <div class="grid grid-cols-2 gap-2">
            <label class="space-y-1">
              <span class="text-neutral-500 dark:text-neutral-400">Avatar</span>
              <select
                v-model="stageModelSelected"
                class="w-full border border-neutral-200 rounded-2xl bg-white/80 px-3 py-2 outline-none dark:border-neutral-800 dark:bg-neutral-950"
                @change="void handleAvatarChange(stageModelSelected)"
              >
                <option
                  v-for="model in displayModels"
                  :key="model.id"
                  :value="model.id"
                >
                  {{ model.name }}
                </option>
              </select>
            </label>

            <label class="space-y-1">
              <span class="text-neutral-500 dark:text-neutral-400">TTS provider</span>
              <select
                v-model="selectedSpeechProvider"
                class="w-full border border-neutral-200 rounded-2xl bg-white/80 px-3 py-2 outline-none dark:border-neutral-800 dark:bg-neutral-950"
                @change="void applySpeechProvider(selectedSpeechProvider)"
              >
                <option
                  v-for="provider in speechProviderOptions"
                  :key="provider.id"
                  :value="provider.id"
                >
                  {{ provider.label }}
                </option>
              </select>
            </label>
          </div>

          <div class="grid grid-cols-2 gap-2">
            <label class="flex cursor-pointer items-center justify-center border border-neutral-300 rounded-2xl border-dashed bg-white/60 px-3 py-2 text-center transition dark:border-neutral-700 dark:bg-neutral-950/70 hover:bg-white/90 dark:hover:bg-neutral-900">
              <input
                type="file"
                accept=".zip"
                class="hidden"
                :disabled="avatarUploadPending"
                @change="event => void handleAvatarUpload(event, DisplayModelFormat.Live2dZip)"
              >
              <span>{{ avatarUploadPending ? 'Importing…' : 'Upload Live2D .zip' }}</span>
            </label>
            <label class="flex cursor-pointer items-center justify-center border border-neutral-300 rounded-2xl border-dashed bg-white/60 px-3 py-2 text-center transition dark:border-neutral-700 dark:bg-neutral-950/70 hover:bg-white/90 dark:hover:bg-neutral-900">
              <input
                type="file"
                accept=".vrm"
                class="hidden"
                :disabled="avatarUploadPending"
                @change="event => void handleAvatarUpload(event, DisplayModelFormat.VRM)"
              >
              <span>{{ avatarUploadPending ? 'Importing…' : 'Upload VRM .vrm' }}</span>
            </label>
          </div>

          <div class="grid gap-3 border border-neutral-200/70 rounded-2xl bg-white/45 p-3 dark:border-neutral-800 dark:bg-neutral-900/45">
            <div class="flex items-center justify-between gap-3">
              <div>
                <p class="text-sm font-medium">
                  VRM motions
                </p>
                <p class="text-[0.7rem] text-neutral-500 dark:text-neutral-400">
                  Preview clips manually or assign the current selection as the active card idle animation.
                </p>
              </div>
              <span class="rounded-full bg-neutral-900/6 px-2.5 py-1 text-[0.65rem] tracking-[0.18em] uppercase dark:bg-white/8">
                card idle: {{ activeCardIdleVrmMotionName }}
              </span>
            </div>

            <label class="space-y-1">
              <span class="text-neutral-500 dark:text-neutral-400">Motion clip</span>
              <select
                v-model="selectedVrmMotionId"
                class="w-full border border-neutral-200 rounded-2xl bg-white/80 px-3 py-2 outline-none dark:border-neutral-800 dark:bg-neutral-950"
              >
                <option
                  v-for="motion in vrmMotions"
                  :key="motion.id"
                  :value="motion.id"
                >
                  {{ motion.name }}
                </option>
              </select>
            </label>

            <div class="grid grid-cols-2 gap-2">
              <button
                type="button"
                class="rounded-2xl bg-neutral-950 px-3 py-2 text-white transition dark:bg-white hover:bg-neutral-800 dark:text-neutral-950 dark:hover:bg-neutral-100"
                @click="void handlePlaySelectedVrmMotion()"
              >
                Preview motion
              </button>
              <button
                type="button"
                class="border border-neutral-300 rounded-2xl px-3 py-2 text-neutral-800 transition dark:border-neutral-700 hover:bg-neutral-100 dark:text-neutral-100 dark:hover:bg-neutral-800"
                @click="handleApplySelectedMotionToCard"
              >
                Use as card idle
              </button>
            </div>

            <label class="flex cursor-pointer items-center justify-center border border-neutral-300 rounded-2xl border-dashed bg-white/60 px-3 py-2 text-center transition dark:border-neutral-700 dark:bg-neutral-950/70 hover:bg-white/90 dark:hover:bg-neutral-900">
              <input
                type="file"
                accept=".vrma"
                multiple
                class="hidden"
                :disabled="vrmMotionUploadPending"
                @change="event => void handleVrmMotionUpload(event)"
              >
              <span>{{ vrmMotionUploadPending ? 'Importing…' : 'Upload VRM .vrma' }}</span>
            </label>
          </div>

          <div v-if="selectedSpeechProvider === INWORLD_PROVIDER_ID" class="grid gap-2 rounded-2xl bg-orange-500/10 p-3 text-orange-950 dark:text-orange-100">
            <div class="flex items-center justify-between gap-3">
              <strong>Inworld demo</strong>
              <span class="text-[0.65rem] tracking-[0.2em] uppercase">local only</span>
            </div>
            <label class="space-y-1">
              <span>API key</span>
              <input
                v-model="inworldApiKey"
                type="password"
                placeholder="Basic key or raw key"
                class="w-full border border-orange-200/70 rounded-2xl bg-white/80 px-3 py-2 outline-none dark:border-orange-900 dark:bg-neutral-950"
              >
            </label>
            <label class="space-y-1">
              <span>Base URL</span>
              <input
                v-model="inworldBaseUrl"
                class="w-full border border-orange-200/70 rounded-2xl bg-white/80 px-3 py-2 outline-none dark:border-orange-900 dark:bg-neutral-950"
              >
            </label>
            <div class="grid grid-cols-2 gap-2">
              <label class="space-y-1">
                <span>Model</span>
                <select
                  v-model="selectedSpeechModel"
                  class="w-full border border-orange-200/70 rounded-2xl bg-white/80 px-3 py-2 outline-none dark:border-orange-900 dark:bg-neutral-950"
                >
                  <option
                    v-for="model in inworldModelOptions"
                    :key="model.id"
                    :value="model.id"
                  >
                    {{ model.label }}
                  </option>
                </select>
              </label>
              <label class="space-y-1">
                <span>Speed {{ inworldSpeed.toFixed(2) }}</span>
                <input
                  v-model.number="inworldSpeed"
                  type="range"
                  min="0.5"
                  max="1.5"
                  step="0.01"
                  class="w-full"
                >
              </label>
            </div>
            <button
              type="button"
              class="w-full rounded-2xl bg-orange-950 px-3 py-2 text-white transition dark:bg-orange-100 hover:bg-orange-900 dark:text-orange-950"
              @click="void applySpeechProvider(INWORLD_PROVIDER_ID)"
            >
              Apply Inworld voice
            </button>
          </div>

          <div class="grid grid-cols-2 gap-2">
            <label class="space-y-1">
              <span class="text-neutral-500 dark:text-neutral-400">Voice</span>
              <select
                v-if="availableSpeechVoices.length > 0"
                v-model="selectedVoiceId"
                class="w-full border border-neutral-200 rounded-2xl bg-white/80 px-3 py-2 outline-none dark:border-neutral-800 dark:bg-neutral-950"
              >
                <option
                  v-for="voice in availableSpeechVoices"
                  :key="voice.id"
                  :value="voice.id"
                >
                  {{ voice.name || voice.id }}
                </option>
              </select>
              <input
                v-else
                v-model="selectedVoiceId"
                placeholder="Voice id"
                class="w-full border border-neutral-200 rounded-2xl bg-white/80 px-3 py-2 outline-none dark:border-neutral-800 dark:bg-neutral-950"
              >
            </label>

            <label class="space-y-1">
              <span class="text-neutral-500 dark:text-neutral-400">Voice input</span>
              <select
                v-model="voiceInputLanguage"
                class="w-full border border-neutral-200 rounded-2xl bg-white/80 px-3 py-2 outline-none dark:border-neutral-800 dark:bg-neutral-950"
              >
                <option
                  v-for="language in voiceInputLanguageOptions"
                  :key="language.id"
                  :value="language.id"
                >
                  {{ language.label }}
                </option>
              </select>
            </label>
          </div>

          <div class="flex items-center justify-between gap-2">
            <p class="text-neutral-500 dark:text-neutral-400">
              Avatar: {{ selectedAvatarName }}. Voice: {{ selectedVoiceName }}.
            </p>
            <button
              type="button"
              class="shrink-0 rounded-full px-3 py-1.5 text-white transition disabled:cursor-not-allowed disabled:opacity-50"
              :class="isListening ? 'bg-red-600 hover:bg-red-700' : 'bg-neutral-950 hover:bg-neutral-800 dark:bg-white dark:text-neutral-950'"
              :disabled="!voiceInputSupported"
              @click="isListening ? stopVoiceInput() : startVoiceInput()"
            >
              {{ isListening ? 'Stop mic' : 'Speak' }}
            </button>
          </div>
        </div>

        <div class="mt-4 border border-neutral-200/70 rounded-3xl bg-neutral-950/5 p-3 text-xs dark:border-neutral-800 dark:bg-white/5">
          <div class="flex items-center justify-between gap-3">
            <strong class="text-neutral-700 dark:text-neutral-200">LLM trace</strong>
            <span
              class="rounded-full px-2 py-1"
              :class="{
                'bg-neutral-500/10 text-neutral-600 dark:text-neutral-300': llmTraceStatus === 'idle',
                'bg-amber-500/10 text-amber-700 dark:text-amber-200': llmTraceStatus === 'waiting',
                'bg-sky-500/10 text-sky-700 dark:text-sky-200': llmTraceStatus === 'streaming',
                'bg-emerald-500/10 text-emerald-700 dark:text-emerald-200': llmTraceStatus === 'done',
                'bg-red-500/10 text-red-700 dark:text-red-200': llmTraceStatus === 'error',
              }"
            >
              {{ llmTraceLabel }}
            </span>
          </div>
          <p v-if="llmTracePrompt" class="mt-2 text-neutral-500 dark:text-neutral-400">
            Prompt: {{ llmTracePrompt }}
          </p>
          <pre v-if="streamingPreview" class="mt-2 max-h-28 overflow-auto whitespace-pre-wrap rounded-2xl bg-white/70 p-3 text-[0.68rem] text-neutral-700 dark:bg-neutral-950 dark:text-neutral-200">{{ streamingPreview }}</pre>
        </div>

        <div
          v-if="fastReplyText || visibleStatusText"
          class="mt-4 border border-neutral-200/70 rounded-3xl bg-white/55 p-3 text-xs dark:border-neutral-800 dark:bg-neutral-900/50"
        >
          <div class="flex items-center justify-between gap-3">
            <strong class="text-neutral-700 dark:text-neutral-200">Live narration</strong>
            <span class="rounded-full bg-neutral-950/8 px-2 py-1 text-[0.68rem] text-neutral-600 dark:bg-white/8 dark:text-neutral-300">
              {{ fastReplyMode === 'agent' ? 'agent handoff' : fastReplyMode === 'chat' ? 'fast reply' : 'speaking' }}
            </span>
          </div>
          <p v-if="fastReplyText" class="mt-2 whitespace-pre-wrap text-neutral-700 dark:text-neutral-200">
            {{ fastReplyText }}
          </p>
          <p v-if="visibleStatusText" class="mt-2 rounded-2xl bg-sky-500/10 px-3 py-2 text-sky-700 dark:text-sky-200">
            {{ visibleStatusText }}
          </p>
        </div>

        <div class="mt-4 min-h-[12rem] flex-1 overflow-hidden border border-neutral-200/70 rounded-3xl bg-white/55 p-3 dark:border-neutral-800 dark:bg-neutral-900/50">
          <ChatHistory
            :messages="historyMessages"
            :streaming-message="streamingMessage"
            :sending="sending"
            assistant-label="PicoClaw"
            :variant="isMobile ? 'mobile' : 'desktop'"
            class="h-full"
          />
        </div>

        <form class="mt-4 flex flex-col gap-3" @submit.prevent="handleSend">
          <BasicTextarea
            v-model="messageInput"
            placeholder="Say something to the avatar…"
            class="min-h-[5.5rem] w-full resize-none border border-neutral-200/70 rounded-3xl bg-white/70 px-4 py-3 text-sm outline-none transition dark:border-neutral-800 focus:border-neutral-400 dark:bg-neutral-900/70"
            @keydown="handleComposerKeydown"
          />

          <div class="flex items-center justify-between gap-3">
            <p class="text-xs text-neutral-500 dark:text-neutral-400">
              Enter to send, Shift+Enter for newline.
            </p>

            <button
              type="submit"
              class="rounded-full bg-neutral-950 px-4 py-2 text-sm text-white font-medium transition disabled:cursor-not-allowed dark:bg-white dark:text-neutral-950 disabled:opacity-50"
              :disabled="sending || bootstrapPending || !messageInput.trim()"
            >
              {{ sending ? 'Thinking…' : 'Send' }}
            </button>
          </div>
        </form>

        <details class="mt-4 border border-neutral-200/70 rounded-3xl bg-neutral-950/5 p-3 text-xs dark:border-neutral-800 dark:bg-white/5" open>
          <summary class="cursor-pointer select-none text-neutral-600 font-medium dark:text-neutral-300">
            PicoClaw runtime logs
          </summary>
          <div class="grid mt-3 gap-2 rounded-2xl bg-white/70 p-3 text-neutral-600 dark:bg-neutral-950 dark:text-neutral-300">
            <p>
              Agent mode: <strong>real PicoClaw CLI</strong>. Backend: <strong>{{ backendProviderLabel }}</strong>. Filesystem/tools: <strong>{{ picoclawBridgeStatus?.workspaceRestricted ? 'workspace restricted' : picoclawBridgeStatus?.fullAccess ? 'full access enabled' : 'see PicoClaw config' }}</strong>. PicoClaw CLI/runtime bridge: <strong>{{ picoclawConnected ? 'connected' : 'offline' }}</strong>.
            </p>
            <p>
              {{ picoclawRuntimeSummary }}
            </p>
            <p>
              Active AIRI card: <strong>{{ activeCardId }}</strong>. AIRI card prompt is used for avatar identity only here; PicoClaw uses its own workspace prompt. AIRI prompt preview:
            </p>
            <pre class="max-h-28 overflow-auto whitespace-pre-wrap text-[0.68rem]">{{ systemPromptPreview }}</pre>
          </div>
          <pre class="mt-3 max-h-48 overflow-auto whitespace-pre-wrap rounded-2xl bg-neutral-950 p-3 text-[0.68rem] text-emerald-100">{{ logsText || 'No logs yet.' }}</pre>
        </details>
      </aside>
    </div>
  </BackgroundProvider>
</template>

<route lang="yaml">
name: PicoAvatarTestPage
meta:
  layout: stage
  stageTransition:
    name: bubble-wave-out
</route>
