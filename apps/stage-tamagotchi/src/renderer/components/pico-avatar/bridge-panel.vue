<script setup lang="ts">
import type { ChatHistoryItem } from '@proj-airi/stage-ui/types/chat'

import { useElectronEventaInvoke } from '@proj-airi/electron-vueuse'
import { ChatHistory } from '@proj-airi/stage-ui/components'
import { useChatOrchestratorStore } from '@proj-airi/stage-ui/stores/chat'
import { useChatMaintenanceStore } from '@proj-airi/stage-ui/stores/chat/maintenance'
import { useChatSessionStore } from '@proj-airi/stage-ui/stores/chat/session-store'
import { useChatStreamStore } from '@proj-airi/stage-ui/stores/chat/stream-store'
import { useConsciousnessStore } from '@proj-airi/stage-ui/stores/modules/consciousness'
import { useSpeechStore } from '@proj-airi/stage-ui/stores/modules/speech'
import { usePicoAvatarBridgeStore } from '@proj-airi/stage-ui/stores/pico-avatar-bridge'
import { Button, useDeferredMount } from '@proj-airi/ui'
import { storeToRefs } from 'pinia'
import { computed, onMounted, onUnmounted, ref } from 'vue'

import { electronOpenDevtoolsWindow } from '../../../shared/eventa'

const props = withDefaults(defineProps<{
  mode?: 'overlay' | 'window'
}>(), {
  mode: 'overlay',
})
const AUTO_REFRESH_OWNER = 'tamagotchi-main-stage'
const { isReady } = useDeferredMount()
const bridgeStore = usePicoAvatarBridgeStore()
const chatOrchestratorStore = useChatOrchestratorStore()
const chatMaintenanceStore = useChatMaintenanceStore()
const chatSessionStore = useChatSessionStore()
const chatStreamStore = useChatStreamStore()
const consciousnessStore = useConsciousnessStore()
const speechStore = useSpeechStore()
const openDevtoolsWindow = useElectronEventaInvoke(electronOpenDevtoolsWindow)

const { messages } = storeToRefs(chatSessionStore)
const { streamingMessage } = storeToRefs(chatStreamStore)
const { sending } = storeToRefs(chatOrchestratorStore)
const { activeProvider, activeModel } = storeToRefs(consciousnessStore)
const { activeSpeechProvider, activeSpeechModel, activeSpeechVoiceId } = storeToRefs(speechStore)
const {
  bridgeStatus,
  latestTrace,
  bridgeOnline,
  launcherRunning,
  bridgeError,
  runtimeLogs,
  visibleStatusText,
  llmTraceLabel,
  bridgeRuntimeSummary,
} = storeToRefs(bridgeStore)

const composerText = ref('')
const historyMessages = computed(() => messages.value as unknown as ChatHistoryItem[])
const recentTraceEvents = computed(() => latestTrace.value?.recentEvents.slice().reverse().slice(0, 8) ?? [])

function formatDateTime(value?: number) {
  if (!value)
    return '—'

  return new Date(value).toLocaleString()
}

function summarizeEvent(event: { event: string, line?: string, text?: string, messagePreview?: string, sseEvent?: string }) {
  return event.line || event.text || event.messagePreview || event.sseEvent || event.event
}

async function handleSend() {
  const text = composerText.value.trim()
  if (!text)
    return

  composerText.value = ''
  try {
    await bridgeStore.sendMessageThroughBridge(text)
  }
  catch {
    composerText.value = text
  }
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key !== 'Enter' || event.shiftKey)
    return

  event.preventDefault()
  void handleSend()
}

function handleClearChat() {
  chatMaintenanceStore.cleanupMessages()
  bridgeStore.clearVisibleStatus()
}

onMounted(() => {
  bridgeStore.requestAutoRefresh(AUTO_REFRESH_OWNER)
  void bridgeStore.refreshInspection().catch(() => undefined)
})

onUnmounted(() => {
  bridgeStore.releaseAutoRefresh(AUTO_REFRESH_OWNER)
})
</script>

<template>
  <aside
    :class="[
      props.mode === 'overlay'
        ? 'absolute right-4 top-4 z-20 h-[calc(100%-2rem)] w-[25rem] max-w-[calc(100vw-2rem)]'
        : 'relative z-0 h-full w-full max-w-none',
      'flex flex-col gap-3',
      'rounded-3xl border border-neutral-200/70 bg-white/92 p-3 shadow-2xl backdrop-blur-xl',
      'dark:border-neutral-700/70 dark:bg-neutral-950/88',
    ]"
  >
    <div :class="['flex items-start justify-between gap-3']">
      <div :class="['min-w-0 space-y-1']">
        <p :class="['text-xs uppercase tracking-[0.25em] text-neutral-500 dark:text-neutral-400']">
          AIRI x Pico Avatar
        </p>
        <h2 :class="['text-lg font-semibold']">
          Bridge Panel
        </h2>
        <p :class="['text-xs text-neutral-600 dark:text-neutral-300']">
          {{ bridgeRuntimeSummary }}
        </p>
      </div>

      <div :class="['flex items-center gap-2']">
        <Button size="sm" variant="ghost" @click="void bridgeStore.refreshInspection()">
          Refresh
        </Button>
        <Button
          size="sm"
          variant="ghost"
          @click="() => openDevtoolsWindow({ key: 'pico-avatar', route: '/devtools/pico-avatar', width: 1200, height: 900 })"
        >
          Inspector
        </Button>
      </div>
    </div>

    <div :class="['flex flex-wrap gap-2 text-xs']">
      <span :class="['rounded-full px-3 py-1', bridgeOnline ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' : 'bg-red-500/15 text-red-700 dark:text-red-300']">
        {{ bridgeOnline ? 'bridge online' : 'bridge offline' }}
      </span>
      <span :class="['rounded-full px-3 py-1', launcherRunning ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' : 'bg-neutral-500/15 text-neutral-700 dark:text-neutral-300']">
        {{ launcherRunning ? 'launcher running' : 'launcher stopped' }}
      </span>
      <span :class="['rounded-full bg-sky-500/15 px-3 py-1 text-sky-700 dark:text-sky-300']">
        {{ llmTraceLabel }}
      </span>
    </div>

    <div
      v-if="bridgeError"
      :class="['rounded-2xl border border-red-300/60 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-200']"
    >
      {{ bridgeError }}
    </div>

    <div
      v-if="visibleStatusText"
      :class="['rounded-2xl border border-sky-300/60 bg-sky-500/10 px-3 py-2 text-sm text-sky-700 dark:text-sky-200']"
    >
      {{ visibleStatusText }}
    </div>

    <div :class="['grid gap-2 rounded-2xl border border-neutral-200/70 bg-neutral-50/80 p-3 text-xs dark:border-neutral-800 dark:bg-neutral-900/60']">
      <div :class="['grid grid-cols-2 gap-2']">
        <div :class="['rounded-xl bg-white/80 px-3 py-2 dark:bg-neutral-950/80']">
          <div :class="['text-neutral-500 dark:text-neutral-400']">
            AIRI chat model
          </div>
          <div :class="['mt-1 font-medium break-all']">
            {{ activeProvider || 'not selected' }} / {{ activeModel || '—' }}
          </div>
        </div>

        <div :class="['rounded-xl bg-white/80 px-3 py-2 dark:bg-neutral-950/80']">
          <div :class="['text-neutral-500 dark:text-neutral-400']">
            AIRI voice
          </div>
          <div :class="['mt-1 font-medium break-all']">
            {{ activeSpeechProvider || 'speech-noop' }} / {{ activeSpeechModel || '—' }}
          </div>
          <div :class="['mt-1 text-neutral-500 dark:text-neutral-400']">
            Voice: {{ activeSpeechVoiceId || '—' }}
          </div>
        </div>
      </div>

      <div :class="['rounded-xl bg-white/80 px-3 py-2 dark:bg-neutral-950/80']">
        <div :class="['text-neutral-500 dark:text-neutral-400']">
          Bridge backend
        </div>
        <div :class="['mt-1 font-medium break-all']">
          {{ bridgeStatus?.providerKind || '—' }} / {{ bridgeStatus?.modelName || '—' }}
        </div>
        <div :class="['mt-1 text-neutral-500 dark:text-neutral-400 break-all']">
          {{ bridgeStatus?.apiBase || 'No API base reported' }}
        </div>
      </div>
    </div>

    <div :class="['min-h-0 flex-1 overflow-hidden rounded-2xl border border-neutral-200/70 bg-neutral-50/80 dark:border-neutral-800 dark:bg-neutral-900/60']">
      <div :class="['flex items-center justify-between gap-2 border-b border-neutral-200/70 px-3 py-2 dark:border-neutral-800']">
        <div :class="['text-sm font-medium']">
          Shared Chat
        </div>
        <Button
          size="sm"
          variant="ghost"
          :disabled="sending"
          @click="handleClearChat"
        >
          Clear
        </Button>
      </div>
      <div :class="['h-full min-h-0 px-2 py-2']">
        <ChatHistory
          v-if="isReady"
          :messages="historyMessages"
          :sending="sending"
          :streaming-message="streamingMessage"
          h-full
          variant="desktop"
        />
      </div>
    </div>

    <div :class="['rounded-2xl border border-neutral-200/70 bg-neutral-50/80 p-3 dark:border-neutral-800 dark:bg-neutral-900/60']">
      <textarea
        v-model="composerText"
        :class="[
          'min-h-24 w-full resize-none rounded-2xl border border-neutral-200 bg-white/90 px-3 py-2 text-sm outline-none',
          'dark:border-neutral-800 dark:bg-neutral-950/90',
        ]"
        placeholder="Send a shared AIRI chat turn through Pico Avatar bridge…"
        @keydown="handleKeydown"
      />
      <div :class="['mt-2 flex items-center justify-between gap-2']">
        <span :class="['text-xs text-neutral-500 dark:text-neutral-400']">
          Runtime and status messages stay out of chat history.
        </span>
        <Button size="sm" @click="void handleSend()">
          Send
        </Button>
      </div>
    </div>

    <div :class="['grid max-h-[28dvh] gap-2 overflow-y-auto rounded-2xl border border-neutral-200/70 bg-neutral-50/80 p-3 text-xs dark:border-neutral-800 dark:bg-neutral-900/60']">
      <div :class="['flex items-center justify-between gap-2']">
        <div :class="['font-medium']">
          Debug
        </div>
        <div :class="['text-neutral-500 dark:text-neutral-400']">
          Trace updated: {{ formatDateTime(latestTrace?.updatedAt) }}
        </div>
      </div>

      <div v-if="recentTraceEvents.length > 0" :class="['space-y-2']">
        <div
          v-for="event in recentTraceEvents"
          :key="`${event.seq || event.event}-${event.at || ''}`"
          :class="['rounded-xl bg-white/80 px-3 py-2 dark:bg-neutral-950/80']"
        >
          <div :class="['font-medium']">
            {{ event.event }}
          </div>
          <div :class="['mt-1 text-neutral-600 dark:text-neutral-300']">
            {{ summarizeEvent(event) }}
          </div>
        </div>
      </div>

      <div v-if="runtimeLogs.length > 0" :class="['space-y-2']">
        <div
          v-for="log in runtimeLogs.slice(0, 8)"
          :key="`${log.at}-${log.message}`"
          :class="['rounded-xl bg-white/80 px-3 py-2 dark:bg-neutral-950/80']"
        >
          <div :class="['font-medium']">
            {{ log.at }} · {{ log.level.toUpperCase() }}
          </div>
          <div :class="['mt-1 text-neutral-600 dark:text-neutral-300']">
            {{ log.message }}
          </div>
        </div>
      </div>
    </div>
  </aside>
</template>
