import type { ChatHistoryItem, ChatStreamEventContext, StreamingAssistantMessage } from '../types/chat'

import { errorMessageFrom } from '@moeru/std'
import { nanoid } from 'nanoid'
import { defineStore, storeToRefs } from 'pinia'
import { computed, ref, watch } from 'vue'

import { useLlmmarkerParser } from '../composables'
import { useChatOrchestratorStore } from './chat'
import { useChatSessionStore } from './chat/session-store'
import { useChatStreamStore } from './chat/stream-store'
import { useAiriCardStore } from './modules/airi-card'
import { useSpeechStore } from './modules/speech'
import {
  getPicoAvatarAvailableMotionNames,
  parsePicoAvatarFastLayerOutput,
  parsePicoAvatarSseBuffer,
  reducePicoAvatarSseEvent,
} from './pico-avatar-bridge-events'
import { useSpeechRuntimeStore } from './speech-runtime'
import { useVrmMotionsStore } from './vrm-motions'

const PICO_AVATAR_ORIGIN = 'http://127.0.0.1:5174'
const PICO_AVATAR_FAST_URL = `${PICO_AVATAR_ORIGIN}/api/picoclaw/fast`
const PICO_AVATAR_AGENT_URL = `${PICO_AVATAR_ORIGIN}/api/picoclaw/agent`
const PICO_AVATAR_SESSION_ID = 'airi:pico-avatar'

/**
 * Compact runtime log item shown in the integrated bridge panel.
 *
 * Use when:
 * - Bridge UI needs a rolling debug timeline
 * - Diagnostics should remain separate from conversational chat history
 *
 * Expects:
 * - `message` is already safe for direct UI rendering
 *
 * Returns:
 * - One renderer-friendly log line with stable metadata
 */
export interface PicoAvatarRuntimeLogEntry {
  at: string
  level: 'info' | 'warn' | 'error'
  message: string
}

/**
 * One normalized bridge trace/debug event.
 *
 * Use when:
 * - UI needs to inspect recent bridge or trace activity
 * - Event boundaries should stay typed in the renderer
 *
 * Expects:
 * - Optional fields may be absent depending on the original trace source
 *
 * Returns:
 * - A serializable event safe for diagnostics panes
 */
export interface PicoAvatarTraceEvent {
  at?: string
  event: string
  seq?: number
  sseEvent?: string
  source?: string
  kind?: string
  phase?: string
  line?: string
  text?: string
  messagePreview?: string
  retryBlockedReason?: string
  classifiedAsRuntimeStatus?: boolean
}

/**
 * Latest parsed trace snapshot returned by the desktop bridge inspector.
 *
 * Use when:
 * - The desktop bridge exposes the latest JSONL trace file
 * - UI needs a structured summary instead of raw file access
 *
 * Expects:
 * - Trace contents are already parsed in the main process
 *
 * Returns:
 * - Snapshot metadata plus recent structured events
 */
export interface PicoAvatarTraceSnapshot {
  traceId: string
  path: string
  updatedAt: number
  eventCount: number
  messagePreview?: string
  finalText?: string
  runtimeStatusText?: string
  recentEvents: PicoAvatarTraceEvent[]
  llmEvents: PicoAvatarTraceEvent[]
  rawTail: string
}

/**
 * Desktop bridge endpoint status returned by the Electron-side inspector.
 *
 * Use when:
 * - Renderer needs current bridge backend/provider/workspace metadata
 * - The status was fetched indirectly through Eventa and main process helpers
 *
 * Expects:
 * - `ok` indicates the backing local web bridge answered successfully
 *
 * Returns:
 * - A typed status snapshot the UI can render directly
 */
export interface PicoAvatarBridgeStatus {
  ok: boolean
  binary: string
  configSource: string
  runnerKind: 'host' | 'docker'
  persistentContainer: boolean
  containerName?: string
  containerRunning?: boolean
  dockerImage?: string
  traceDir: string
  providerKind: 'lmstudio' | 'openrouter' | 'custom'
  modelName: string
  model: string
  apiBase: string
  apiReachable: boolean
  fullAccess: boolean
  workspace: string
  workspaceRestricted: boolean
}

export interface PicoAvatarEndpointInspection {
  reachable: boolean
  status?: PicoAvatarBridgeStatus
  error?: string
}

export interface PicoAvatarLauncherInspection {
  running: boolean
  exists: boolean
  containerName: string
  uiUrl: string
  gatewayUrl: string
  error?: string
}

/**
 * Full desktop inspection snapshot consumed by the shared bridge store.
 *
 * Use when:
 * - Electron main process already knows how to inspect bridge health and traces
 * - Multiple renderer surfaces should render the same high-level status model
 *
 * Expects:
 * - All paths/URLs are local desktop diagnostics only
 *
 * Returns:
 * - One snapshot with bridge, launcher, and latest trace state
 */
export interface PicoAvatarInspection {
  checkedAt: number
  bridgeUiUrl: string
  bridgeStatusUrl: string
  launcherUiUrl: string
  launcherGatewayUrl: string
  traceDir: string
  latestTracePath?: string
  bridgeScriptPath: string
  launcherScriptPath: string
  bridge: PicoAvatarEndpointInspection
  launcher: PicoAvatarLauncherInspection
  latestTrace?: PicoAvatarTraceSnapshot
}

/**
 * Renderer-host adapter for desktop-only bridge inspection commands.
 *
 * Use when:
 * - Shared UI/store code runs in both Electron and non-Electron contexts
 * - Desktop main process owns process management and filesystem actions
 *
 * Expects:
 * - Each method resolves with fresh inspection state or performs a local action
 *
 * Returns:
 * - A runtime-specific bridge implementation injected during renderer bootstrap
 */
export interface PicoAvatarDesktopBridge {
  inspect: () => Promise<PicoAvatarInspection>
  startBridge: () => Promise<PicoAvatarInspection>
  stopBridge: () => Promise<PicoAvatarInspection>
  startLauncher: () => Promise<PicoAvatarInspection>
  stopLauncher: () => Promise<PicoAvatarInspection>
  openTraceDir: () => Promise<unknown>
  openLatestTrace: () => Promise<unknown>
}

function createLocalMessageId() {
  return nanoid()
}

function formatRuntimeTime() {
  return new Date().toLocaleTimeString()
}

function summarizeTraceEvent(event: PicoAvatarTraceEvent) {
  return event.line || event.text || event.messagePreview || event.sseEvent || event.event
}

function traceLevelForEvent(event: string): PicoAvatarRuntimeLogEntry['level'] {
  if (event === 'error')
    return 'error'
  if (event === 'runtime_status' || event === 'log')
    return 'warn'
  return 'info'
}

/**
 * Shared AIRI <-> Pico Avatar bridge runtime for desktop surfaces.
 *
 * Use when:
 * - Main stage and devtools inspector should drive the same bridge workflow
 * - Chat history must stay shared while debug data stays out of conversation state
 *
 * Expects:
 * - Desktop renderer injects a {@link PicoAvatarDesktopBridge} in Electron
 * - Local Pico Avatar web bridge is reachable on `127.0.0.1:5174` when active
 *
 * Returns:
 * - Bridge inspection state, debug timeline, and send actions for integrated UI
 */
export const usePicoAvatarBridgeStore = defineStore('pico-avatar-bridge', () => {
  const chatOrchestrator = useChatOrchestratorStore()
  const chatSession = useChatSessionStore()
  const chatStream = useChatStreamStore()
  const speechStore = useSpeechStore()
  const speechRuntimeStore = useSpeechRuntimeStore()
  const vrmMotionsStore = useVrmMotionsStore()
  const airiCardStore = useAiriCardStore()
  const { activeSessionId } = storeToRefs(chatSession)
  const { streamingMessage } = storeToRefs(chatStream)
  const { sending } = storeToRefs(chatOrchestrator)
  const { activeSpeechProvider, activeSpeechModel, activeSpeechVoiceId } = storeToRefs(speechStore)
  const { activeCardId, systemPrompt, activeCard } = storeToRefs(airiCardStore)
  const { vrmMotions } = storeToRefs(vrmMotionsStore)

  const bridge = ref<PicoAvatarDesktopBridge>()
  const inspection = ref<PicoAvatarInspection>()
  const runtimeLogs = ref<PicoAvatarRuntimeLogEntry[]>([])
  const error = ref<string>()
  const visibleStatusText = ref('')
  const visibleStatusQueue = ref<string[]>([])
  const llmTraceStatus = ref<'idle' | 'waiting' | 'streaming' | 'done' | 'error'>('idle')
  const llmTracePrompt = ref('')
  const llmTraceStartedAt = ref<number | null>(null)
  const llmTraceFirstTokenAt = ref<number | null>(null)
  const llmTraceElapsedMs = ref(0)
  const llmTraceFinalChars = ref(0)
  const fastReplyText = ref('')
  const fastReplyMode = ref<'idle' | 'pending' | 'agent' | 'chat'>('idle')

  let llmTraceTimer: ReturnType<typeof setInterval> | undefined
  let refreshTimer: ReturnType<typeof setInterval> | undefined
  const refreshOwners = new Set<string>()
  let visibleStatusDrainPending = false
  let lastVisibleStatusSpoken = ''

  const bridgeStatus = computed(() => inspection.value?.bridge.status)
  const latestTrace = computed(() => inspection.value?.latestTrace)
  const bridgeOnline = computed(() => inspection.value?.bridge.reachable === true && bridgeStatus.value?.ok === true)
  const launcherRunning = computed(() => {
    return inspection.value?.launcher.running === true
      || bridgeStatus.value?.containerRunning === true
  })
  const bridgeError = computed(() => error.value || inspection.value?.bridge.error || inspection.value?.launcher.error)
  const speechConfigured = computed(() => {
    return activeSpeechProvider.value !== 'speech-noop'
      && Boolean(activeSpeechModel.value)
      && Boolean(activeSpeechVoiceId.value)
  })
  const llmTraceFirstTokenMs = computed(() => {
    if (llmTraceStartedAt.value == null || llmTraceFirstTokenAt.value == null)
      return null

    return Math.round(llmTraceFirstTokenAt.value - llmTraceStartedAt.value)
  })
  const llmTraceApproxTokens = computed(() => Math.max(0, Math.ceil(llmTraceFinalChars.value / 4)))
  const llmTraceLabel = computed(() => {
    if (llmTraceStatus.value === 'idle')
      return 'LLM idle'
    if (llmTraceStatus.value === 'waiting')
      return `Waiting for first token: ${Math.round(llmTraceElapsedMs.value / 1000)}s`
    if (llmTraceStatus.value === 'streaming')
      return `Streaming: ${Math.round(llmTraceElapsedMs.value / 1000)}s, first token ${llmTraceFirstTokenMs.value ?? '?'}ms`
    if (llmTraceStatus.value === 'done')
      return `Done: ${Math.round(llmTraceElapsedMs.value / 1000)}s, ~${llmTraceApproxTokens.value} tokens`
    return `LLM error after ${Math.round(llmTraceElapsedMs.value / 1000)}s`
  })
  const bridgeRuntimeSummary = computed(() => {
    const status = bridgeStatus.value
    if (!status?.ok)
      return 'Pico Avatar bridge is offline.'

    return `Runner=${status.runnerKind}, provider=${status.providerKind}, model=${status.modelName}, API=${status.apiBase}, workspace=${status.workspace}`
  })

  function setBridge(nextBridge: PicoAvatarDesktopBridge) {
    bridge.value = nextBridge
  }

  function clearError() {
    error.value = undefined
  }

  function clearRuntimeLogs() {
    runtimeLogs.value = []
  }

  function clearVisibleStatus() {
    visibleStatusText.value = ''
    visibleStatusQueue.value = []
    lastVisibleStatusSpoken = ''
  }

  function pushRuntimeLog(level: PicoAvatarRuntimeLogEntry['level'], message: string) {
    runtimeLogs.value = [
      {
        at: formatRuntimeTime(),
        level,
        message,
      },
      ...runtimeLogs.value,
    ].slice(0, 200)
  }

  async function speakText(text: string, options: { behavior?: 'queue' | 'interrupt', ownerId?: string } = {}) {
    const normalized = text.trim()
    if (!normalized || !speechConfigured.value)
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
    if (!normalized || normalized === lastVisibleStatusSpoken || visibleStatusQueue.value.includes(normalized))
      return

    visibleStatusQueue.value = [...visibleStatusQueue.value, normalized]
  }

  async function drainVisibleStatusQueue() {
    if (visibleStatusDrainPending)
      return

    visibleStatusDrainPending = true
    try {
      while (visibleStatusQueue.value.length > 0) {
        const [nextStatus, ...rest] = visibleStatusQueue.value
        visibleStatusQueue.value = rest
        visibleStatusText.value = nextStatus
        lastVisibleStatusSpoken = nextStatus
        await speakText(nextStatus, {
          behavior: 'interrupt',
          ownerId: 'pico-avatar-status',
        })
      }
    }
    finally {
      visibleStatusDrainPending = false
    }
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
    llmTraceStatus.value = status
  }

  async function withBridge<T>(run: (activeBridge: PicoAvatarDesktopBridge) => Promise<T>) {
    if (!bridge.value) {
      const message = 'Pico Avatar desktop bridge is not available in this runtime.'
      error.value = message
      throw new Error(message)
    }

    clearError()
    try {
      return await run(bridge.value)
    }
    catch (cause) {
      error.value = errorMessageFrom(cause) ?? 'Pico Avatar bridge request failed.'
      throw cause
    }
  }

  function assignInspection(snapshot: PicoAvatarInspection) {
    inspection.value = snapshot
  }

  async function refreshInspection() {
    const snapshot = await withBridge(activeBridge => activeBridge.inspect())
    assignInspection(snapshot)
    return snapshot
  }

  async function startBridge() {
    const snapshot = await withBridge(activeBridge => activeBridge.startBridge())
    assignInspection(snapshot)
    pushRuntimeLog('info', 'Started Pico Avatar bridge.')
    return snapshot
  }

  async function stopBridge() {
    const snapshot = await withBridge(activeBridge => activeBridge.stopBridge())
    assignInspection(snapshot)
    pushRuntimeLog('warn', 'Stopped Pico Avatar bridge.')
    return snapshot
  }

  async function startLauncher() {
    const snapshot = await withBridge(activeBridge => activeBridge.startLauncher())
    assignInspection(snapshot)
    pushRuntimeLog('info', 'Started PicoClaw launcher.')
    return snapshot
  }

  async function stopLauncher() {
    const snapshot = await withBridge(activeBridge => activeBridge.stopLauncher())
    assignInspection(snapshot)
    pushRuntimeLog('warn', 'Stopped PicoClaw launcher.')
    return snapshot
  }

  async function openTraceDir() {
    await withBridge(activeBridge => activeBridge.openTraceDir())
  }

  async function openLatestTrace() {
    await withBridge(activeBridge => activeBridge.openLatestTrace())
  }

  function updateRefreshTimer() {
    if (refreshTimer) {
      clearInterval(refreshTimer)
      refreshTimer = undefined
    }

    if (refreshOwners.size === 0)
      return

    refreshTimer = setInterval(() => {
      void refreshInspection().catch((cause) => {
        error.value = errorMessageFrom(cause) ?? 'Failed to refresh Pico Avatar inspection.'
      })
    }, 5000)
  }

  function requestAutoRefresh(ownerId: string) {
    refreshOwners.add(ownerId)
    updateRefreshTimer()
  }

  function releaseAutoRefresh(ownerId: string) {
    refreshOwners.delete(ownerId)
    updateRefreshTimer()
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
        intent.writeSpecial(special)
      },
    })

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done)
          break

        const parsed = parsePicoAvatarSseBuffer(`${pending}${decoder.decode(value, { stream: true })}`)
        pending = parsed.pending

        for (const item of parsed.events) {
          const payload = item.data ? JSON.parse(item.data) as Record<string, unknown> : {}

          if (item.event === 'text_delta') {
            rawText += typeof payload.text === 'string' ? payload.text : ''
            const nextState = parsePicoAvatarFastLayerOutput(rawText)
            mode = nextState.mode
            spokenText = nextState.spokenText
            continue
          }

          if (item.event === 'error')
            throw new Error(typeof payload.message === 'string' ? payload.message : 'Fast layer failed.')
        }

        const currentState = parsePicoAvatarFastLayerOutput(rawText)
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

      const finalState = parsePicoAvatarFastLayerOutput(rawText, { done: true })
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
    catch (cause) {
      intent.cancel('fast-layer-failed')
      throw cause
    }
  }

  async function readPicoClawStream(response: Response) {
    const reader = response.body?.getReader()
    if (!reader)
      throw new Error('PicoClaw bridge did not return a readable stream.')

    const decoder = new TextDecoder()
    let pending = ''
    let reducedState = {
      finalText: '',
      runtimeStatus: '',
      visibleStatus: '',
      traceId: '',
      debugEvents: [] as Array<{ event: string, payload: Record<string, unknown> }>,
    }

    while (true) {
      const { done, value } = await reader.read()
      if (done)
        break

      const parsed = parsePicoAvatarSseBuffer(`${pending}${decoder.decode(value, { stream: true })}`)
      pending = parsed.pending

      for (const item of parsed.events) {
        const payload = item.data ? JSON.parse(item.data) as Record<string, unknown> : {}
        reducedState = reducePicoAvatarSseEvent(reducedState, {
          event: item.event,
          payload,
        })

        if (item.event === 'visible_status' && typeof payload.text === 'string') {
          queueVisibleStatus(payload.text)
          void drainVisibleStatusQueue()
        }

        if (item.event !== 'assistant_final' && item.event !== 'done') {
          pushRuntimeLog(traceLevelForEvent(item.event), summarizeTraceEvent({
            event: item.event,
            line: typeof payload.line === 'string' ? payload.line : undefined,
            text: typeof payload.text === 'string' ? payload.text : undefined,
            messagePreview: typeof payload.message === 'string' ? payload.message : undefined,
            sseEvent: typeof payload.sseEvent === 'string' ? payload.sseEvent : undefined,
          }))
        }
      }
    }

    return {
      finalText: reducedState.finalText.trim(),
      runtimeStatus: reducedState.runtimeStatus.trim(),
      visibleStatus: reducedState.visibleStatus.trim(),
      traceId: reducedState.traceId,
    }
  }

  /**
   * Sends one shared-chat turn through Pico Avatar bridge while preserving debug boundaries.
   *
   * Call stack:
   *
   * sendMessageThroughBridge
   *   -> readFastLayerStream
   *     -> readPicoClawStream
   *       -> appendSessionMessage / speech runtime
   */
  async function sendMessageThroughBridge(text: string) {
    const normalized = text.trim()
    if (!normalized || sending.value)
      return

    if (!activeSessionId.value)
      throw new Error('Chat session is not ready.')

    clearError()
    clearVisibleStatus()
    fastReplyText.value = ''
    fastReplyMode.value = 'pending'

    try {
      startLlmTrace(normalized)
      pushRuntimeLog('info', `Sending prompt to Pico Avatar bridge: "${normalized.slice(0, 120)}"`)

      const sessionId = activeSessionId.value
      const userMessage = {
        role: 'user',
        content: normalized,
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
            text: normalized,
          },
        },
      } satisfies ChatStreamEventContext

      sending.value = true
      await chatOrchestrator.emitBeforeMessageComposedHooks(normalized, context)
      chatSession.appendSessionMessage(sessionId, userMessage)
      await chatOrchestrator.emitBeforeSendHooks(normalized, context)

      const fastLayerResponse = await fetch(PICO_AVATAR_FAST_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: normalized,
          systemPrompt: systemPrompt.value || '',
          availableVrmMotions: getPicoAvatarAvailableMotionNames(vrmMotions.value, {
            preferred: [
              activeCard.value?.extensions?.airi?.modules?.vrmMotion?.idleMotionId || '',
            ],
          }),
        }),
      })

      if (!fastLayerResponse.ok) {
        throw new Error(`Fast layer failed with HTTP ${fastLayerResponse.status}: ${await fastLayerResponse.text()}`)
      }

      const fastLayerResult = await readFastLayerStream(fastLayerResponse)
      if (fastLayerResult.spokenText) {
        llmTraceFinalChars.value = Math.max(llmTraceFinalChars.value, fastLayerResult.spokenText.length)
        if (llmTraceStatus.value === 'waiting' && llmTraceStartedAt.value != null) {
          llmTraceFirstTokenAt.value = performance.now()
          llmTraceStatus.value = 'streaming'
        }
      }

      if (fastLayerResult.mode !== 'agent') {
        const finalText = fastLayerResult.spokenText.trim()
        if (!finalText)
          throw new Error('Fast layer completed without a spoken response.')

        const assistantMessage = appendAssistantMessage(sessionId, finalText)
        await chatOrchestrator.emitStreamEndHooks(context)
        await chatOrchestrator.emitAssistantResponseEndHooks(finalText, context)
        await chatOrchestrator.emitAfterSendHooks(normalized, context)
        await chatOrchestrator.emitAssistantMessageHooks(assistantMessage, finalText, context)
        await chatOrchestrator.emitChatTurnCompleteHooks({
          output: assistantMessage,
          outputText: finalText,
          toolCalls: [],
        }, context)
        fastReplyMode.value = 'chat'
        finishLlmTrace('done')
        fastReplyText.value = ''
        pushRuntimeLog('info', 'Fast layer completed without PicoClaw handoff.')
        return
      }

      chatStream.beginStream()
      pushRuntimeLog('info', 'Fast layer escalated to PicoClaw agent mode.')
      const response = await fetch(PICO_AVATAR_AGENT_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: normalized,
          session: PICO_AVATAR_SESSION_ID,
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

      llmTraceFinalChars.value = Math.max(llmTraceFinalChars.value, finalText.length)
      chatStream.appendStreamLiteral(finalText)
      const assistantMessage = appendAssistantMessage(sessionId, finalText)
      await speakText(finalText, { behavior: 'queue', ownerId: 'pico-avatar-final' })
      await chatOrchestrator.emitStreamEndHooks(context)
      await chatOrchestrator.emitAssistantResponseEndHooks(finalText, context)
      await chatOrchestrator.emitAfterSendHooks(normalized, context)
      await chatOrchestrator.emitAssistantMessageHooks(assistantMessage, finalText, context)
      await chatOrchestrator.emitChatTurnCompleteHooks({
        output: assistantMessage,
        outputText: finalText,
        toolCalls: [],
      }, context)
      chatStream.resetStream()
      finishLlmTrace('done')
      fastReplyText.value = ''
      pushRuntimeLog('info', `PicoClaw completed successfully. ${llmTraceLabel.value}`)

      if (bridge.value)
        await refreshInspection().catch(() => undefined)
    }
    catch (cause) {
      finishLlmTrace('error')
      chatStream.resetStream()
      error.value = errorMessageFrom(cause) ?? 'Pico Avatar send failed.'
      pushRuntimeLog('error', `Pico Avatar send failed: ${error.value}`)
      throw cause
    }
    finally {
      sending.value = false
    }
  }

  watch(() => streamingMessage.value.content, (content) => {
    if (!content)
      return

    llmTraceFinalChars.value = Math.max(llmTraceFinalChars.value, content.length)
    if (llmTraceStatus.value === 'waiting' && llmTraceStartedAt.value != null) {
      llmTraceFirstTokenAt.value = performance.now()
      llmTraceStatus.value = 'streaming'
    }
  })

  return {
    inspection,
    runtimeLogs,
    error,
    visibleStatusText,
    visibleStatusQueue,
    llmTraceStatus,
    llmTracePrompt,
    llmTraceElapsedMs,
    llmTraceFinalChars,
    llmTraceFirstTokenAt,
    fastReplyText,
    fastReplyMode,

    bridgeStatus,
    latestTrace,
    bridgeOnline,
    launcherRunning,
    bridgeError,
    speechConfigured,
    llmTraceFirstTokenMs,
    llmTraceApproxTokens,
    llmTraceLabel,
    bridgeRuntimeSummary,

    setBridge,
    clearError,
    clearRuntimeLogs,
    clearVisibleStatus,
    refreshInspection,
    startBridge,
    stopBridge,
    startLauncher,
    stopLauncher,
    openTraceDir,
    openLatestTrace,
    requestAutoRefresh,
    releaseAutoRefresh,
    sendMessageThroughBridge,
  }
})
