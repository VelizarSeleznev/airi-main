<script setup lang="ts">
import type {
  ElectronPicoAvatarInspection,
  ElectronPicoAvatarTraceEvent,
} from '../../../shared/eventa'

import { errorMessageFrom } from '@moeru/std'
import { useElectronEventaInvoke } from '@proj-airi/electron-vueuse'
import { Button, FieldCheckbox, Input } from '@proj-airi/ui'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

import {
  electronPicoAvatarInspect,
  electronPicoAvatarOpenLatestTrace,
  electronPicoAvatarOpenTraceDir,
  electronPicoAvatarStartBridge,
  electronPicoAvatarStartLauncher,
  electronPicoAvatarStopBridge,
  electronPicoAvatarStopLauncher,
} from '../../../shared/eventa'

const inspectPicoAvatar = useElectronEventaInvoke(electronPicoAvatarInspect)
const startBridge = useElectronEventaInvoke(electronPicoAvatarStartBridge)
const stopBridge = useElectronEventaInvoke(electronPicoAvatarStopBridge)
const startLauncher = useElectronEventaInvoke(electronPicoAvatarStartLauncher)
const stopLauncher = useElectronEventaInvoke(electronPicoAvatarStopLauncher)
const openTraceDir = useElectronEventaInvoke(electronPicoAvatarOpenTraceDir)
const openLatestTrace = useElectronEventaInvoke(electronPicoAvatarOpenLatestTrace)

const inspection = ref<ElectronPicoAvatarInspection>()
const isBusy = ref(false)
const errorMessage = ref('')
const filter = ref('')
const showIframe = ref(true)
const autoRefresh = ref(true)
const iframeKey = ref(0)
let refreshTimer: ReturnType<typeof setInterval> | undefined

const bridgeStatus = computed(() => inspection.value?.bridge.status)
const latestTrace = computed(() => inspection.value?.latestTrace)
const recentEvents = computed(() => applyFilter(latestTrace.value?.recentEvents ?? []))
const llmEvents = computed(() => applyFilter(latestTrace.value?.llmEvents ?? []))

function eventSummary(event: ElectronPicoAvatarTraceEvent) {
  return event.line || event.text || event.messagePreview || event.sseEvent || event.event
}

function applyFilter(events: ElectronPicoAvatarTraceEvent[]) {
  const query = filter.value.trim().toLowerCase()
  if (!query)
    return events.slice().reverse()

  return events
    .filter((event) => {
      const haystack = [
        event.event,
        event.sseEvent,
        event.phase,
        event.kind,
        event.source,
        event.line,
        event.text,
        event.messagePreview,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      return haystack.includes(query)
    })
    .reverse()
}

function formatDateTime(value?: number | string) {
  if (!value)
    return '—'

  const date = typeof value === 'number' ? new Date(value) : new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString()
}

async function refresh() {
  inspection.value = await inspectPicoAvatar()
}

async function runAction(action: () => Promise<ElectronPicoAvatarInspection>) {
  isBusy.value = true
  errorMessage.value = ''

  try {
    inspection.value = await action()
    iframeKey.value += 1
  }
  catch (error) {
    errorMessage.value = errorMessageFrom(error) ?? 'Pico avatar action failed.'
  }
  finally {
    isBusy.value = false
  }
}

async function runSimpleAction(action: () => Promise<unknown>) {
  isBusy.value = true
  errorMessage.value = ''

  try {
    await action()
  }
  catch (error) {
    errorMessage.value = errorMessageFrom(error) ?? 'Pico avatar action failed.'
  }
  finally {
    isBusy.value = false
  }
}

function restartPolling() {
  if (refreshTimer)
    clearInterval(refreshTimer)

  if (!autoRefresh.value)
    return

  refreshTimer = setInterval(() => {
    void refresh().catch((error) => {
      errorMessage.value = errorMessageFrom(error) ?? 'Failed to refresh Pico avatar status.'
    })
  }, 5000)
}

onMounted(async () => {
  try {
    await refresh()
  }
  catch (error) {
    errorMessage.value = errorMessageFrom(error) ?? 'Failed to load Pico avatar inspection.'
  }

  restartPolling()
})

onBeforeUnmount(() => {
  if (refreshTimer)
    clearInterval(refreshTimer)
})
</script>

<template>
  <div :class="['h-full', 'flex', 'flex-col', 'gap-4', 'overflow-y-auto', 'p-4']">
    <div :class="['grid', 'gap-3', 'xl:grid-cols-[1.15fr_0.85fr]']">
      <section :class="['rounded-2xl', 'border', 'border-neutral-200/70', 'bg-neutral-50', 'p-4', 'dark:border-neutral-700', 'dark:bg-neutral-900/40']">
        <div :class="['flex', 'flex-wrap', 'items-start', 'justify-between', 'gap-3']">
          <div>
            <h2 :class="['text-lg', 'font-semibold']">
              PicoClaw Desktop Bridge
            </h2>
            <p :class="['text-sm', 'text-neutral-500']">
              Управление `start-pico-avatar`, launcher-контейнером и последними bridge trace прямо из Stage Tamagotchi.
            </p>
          </div>

          <div :class="['flex', 'flex-wrap', 'items-center', 'gap-2']">
            <span :class="['rounded-full', 'px-3', 'py-1', 'text-xs', bridgeStatus?.ok ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300' : 'bg-red-500/15 text-red-600 dark:text-red-300']">
              {{ bridgeStatus?.ok ? 'bridge online' : 'bridge offline' }}
            </span>
            <span :class="['rounded-full', 'px-3', 'py-1', 'text-xs', inspection?.launcher.running ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300' : 'bg-neutral-500/15 text-neutral-600 dark:text-neutral-300']">
              {{ inspection?.launcher.running ? 'launcher running' : 'launcher stopped' }}
            </span>
          </div>
        </div>

        <div :class="['mt-4', 'grid', 'gap-2', 'sm:grid-cols-2', 'xl:grid-cols-4']">
          <div :class="['rounded-xl', 'bg-white/80', 'p-3', 'dark:bg-neutral-950/60']">
            <div :class="['text-xs', 'uppercase', 'opacity-70']">
              Provider
            </div>
            <div :class="['text-sm', 'font-semibold']">
              {{ bridgeStatus?.providerKind || '—' }}
            </div>
            <div :class="['text-xs', 'opacity-70', 'break-all']">
              {{ bridgeStatus?.modelName || '—' }}
            </div>
          </div>

          <div :class="['rounded-xl', 'bg-white/80', 'p-3', 'dark:bg-neutral-950/60']">
            <div :class="['text-xs', 'uppercase', 'opacity-70']">
              API Base
            </div>
            <div :class="['text-sm', 'font-semibold', 'break-all']">
              {{ bridgeStatus?.apiBase || '—' }}
            </div>
            <div :class="['text-xs', bridgeStatus?.apiReachable ? 'text-emerald-600 dark:text-emerald-300' : 'text-red-600 dark:text-red-300']">
              {{ bridgeStatus?.apiReachable ? 'backend reachable' : 'backend unreachable' }}
            </div>
          </div>

          <div :class="['rounded-xl', 'bg-white/80', 'p-3', 'dark:bg-neutral-950/60']">
            <div :class="['text-xs', 'uppercase', 'opacity-70']">
              Workspace
            </div>
            <div :class="['text-sm', 'font-semibold']">
              {{ bridgeStatus?.workspaceRestricted ? 'restricted' : 'full access' }}
            </div>
            <div :class="['text-xs', 'opacity-70', 'break-all']">
              {{ bridgeStatus?.workspace || '—' }}
            </div>
          </div>

          <div :class="['rounded-xl', 'bg-white/80', 'p-3', 'dark:bg-neutral-950/60']">
            <div :class="['text-xs', 'uppercase', 'opacity-70']">
              Last Check
            </div>
            <div :class="['text-sm', 'font-semibold']">
              {{ formatDateTime(inspection?.checkedAt) }}
            </div>
            <div :class="['text-xs', 'opacity-70']">
              Trace events: {{ latestTrace?.eventCount ?? 0 }}
            </div>
          </div>
        </div>

        <div :class="['mt-4', 'flex', 'flex-wrap', 'gap-2']">
          <Button :disabled="isBusy" @click="runAction(startBridge)">
            Start Bridge
          </Button>
          <Button :disabled="isBusy" variant="secondary" @click="runAction(stopBridge)">
            Stop Bridge
          </Button>
          <Button :disabled="isBusy" @click="runAction(startLauncher)">
            Start Launcher
          </Button>
          <Button :disabled="isBusy" variant="secondary" @click="runAction(stopLauncher)">
            Stop Launcher
          </Button>
          <Button :disabled="isBusy" variant="ghost" @click="runAction(inspectPicoAvatar)">
            Refresh
          </Button>
          <Button :disabled="isBusy || !latestTrace" variant="ghost" @click="runSimpleAction(openLatestTrace)">
            Open Latest Trace
          </Button>
          <Button :disabled="isBusy" variant="ghost" @click="runSimpleAction(openTraceDir)">
            Open Trace Dir
          </Button>
        </div>

        <div :class="['mt-4', 'flex', 'flex-wrap', 'items-center', 'gap-4', 'text-sm']">
          <FieldCheckbox v-model="showIframe" label="Embed /pico-avatar" />
          <FieldCheckbox v-model="autoRefresh" label="Auto refresh" @update:model-value="restartPolling" />
          <a :class="['text-sky-600', 'underline', 'dark:text-sky-300']" :href="inspection?.bridgeUiUrl" target="_blank" rel="noreferrer">
            Open bridge UI
          </a>
          <a :class="['text-sky-600', 'underline', 'dark:text-sky-300']" :href="inspection?.launcherUiUrl" target="_blank" rel="noreferrer">
            Open launcher UI
          </a>
        </div>

        <div
          v-if="errorMessage || inspection?.bridge.error || inspection?.launcher.error"
          :class="['mt-4', 'rounded-xl', 'border', 'border-red-300/60', 'bg-red-500/10', 'px-3', 'py-2', 'text-sm', 'text-red-700', 'dark:text-red-200']"
        >
          {{ errorMessage || inspection?.bridge.error || inspection?.launcher.error }}
        </div>
      </section>

      <section :class="['rounded-2xl', 'border', 'border-neutral-200/70', 'bg-neutral-50', 'p-4', 'dark:border-neutral-700', 'dark:bg-neutral-900/40']">
        <h3 :class="['text-base', 'font-semibold']">
          Latest Trace Summary
        </h3>
        <div :class="['mt-3', 'grid', 'gap-3']">
          <div>
            <div :class="['text-xs', 'uppercase', 'opacity-70']">
              Trace File
            </div>
            <div :class="['text-sm', 'break-all']">
              {{ latestTrace?.path || inspection?.latestTracePath || '—' }}
            </div>
          </div>
          <div>
            <div :class="['text-xs', 'uppercase', 'opacity-70']">
              User Message Preview
            </div>
            <div :class="['text-sm', 'whitespace-pre-wrap']">
              {{ latestTrace?.messagePreview || '—' }}
            </div>
          </div>
          <div>
            <div :class="['text-xs', 'uppercase', 'opacity-70']">
              Final Answer
            </div>
            <div :class="['text-sm', 'whitespace-pre-wrap']">
              {{ latestTrace?.finalText || '—' }}
            </div>
          </div>
          <div>
            <div :class="['text-xs', 'uppercase', 'opacity-70']">
              Runtime Status
            </div>
            <div :class="['text-sm', 'whitespace-pre-wrap']">
              {{ latestTrace?.runtimeStatusText || '—' }}
            </div>
          </div>
          <div>
            <div :class="['text-xs', 'uppercase', 'opacity-70']">
              Updated
            </div>
            <div :class="['text-sm']">
              {{ formatDateTime(latestTrace?.updatedAt) }}
            </div>
          </div>
        </div>
      </section>
    </div>

    <section
      v-if="showIframe"
      :class="['rounded-2xl', 'border', 'border-neutral-200/70', 'bg-neutral-50', 'p-3', 'dark:border-neutral-700', 'dark:bg-neutral-900/40']"
    >
      <div :class="['mb-3', 'flex', 'items-center', 'justify-between', 'gap-2']">
        <h3 :class="['text-base', 'font-semibold']">
          Embedded Pico Avatar UI
        </h3>
        <Button variant="ghost" @click="iframeKey += 1">
          Reload Frame
        </Button>
      </div>

      <iframe
        :key="iframeKey"
        :src="inspection?.bridgeUiUrl"
        :class="['h-[720px]', 'w-full', 'rounded-xl', 'border', 'border-neutral-200/70', 'bg-black/5', 'dark:border-neutral-700']"
      />
    </section>

    <section :class="['grid', 'gap-4', 'xl:grid-cols-[0.95fr_1.05fr]']">
      <div :class="['rounded-2xl', 'border', 'border-neutral-200/70', 'bg-neutral-50', 'p-4', 'dark:border-neutral-700', 'dark:bg-neutral-900/40']">
        <div :class="['mb-3', 'flex', 'items-center', 'justify-between', 'gap-2']">
          <h3 :class="['text-base', 'font-semibold']">
            LLM / Reasoning Signals
          </h3>
          <Input v-model="filter" placeholder="Filter trace lines..." class="max-w-[320px]" />
        </div>

        <div v-if="llmEvents.length === 0" :class="['text-sm', 'opacity-70']">
          Нет LLM-событий в текущем trace.
        </div>

        <div v-else :class="['grid', 'gap-2']">
          <div
            v-for="event in llmEvents"
            :key="`${event.seq}-${event.event}-${eventSummary(event)}`"
            :class="['rounded-xl', 'bg-white/80', 'p-3', 'dark:bg-neutral-950/60']"
          >
            <div :class="['flex', 'items-center', 'justify-between', 'gap-3', 'text-xs', 'opacity-70']">
              <span>{{ event.event }}<template v-if="event.phase"> / {{ event.phase }}</template></span>
              <span>{{ formatDateTime(event.at) }}</span>
            </div>
            <pre :class="['mt-2', 'whitespace-pre-wrap', 'break-words', 'text-xs']">{{ eventSummary(event) }}</pre>
          </div>
        </div>
      </div>

      <div :class="['rounded-2xl', 'border', 'border-neutral-200/70', 'bg-neutral-50', 'p-4', 'dark:border-neutral-700', 'dark:bg-neutral-900/40']">
        <h3 :class="['text-base', 'font-semibold']">
          Recent Bridge Events
        </h3>

        <div v-if="recentEvents.length === 0" :class="['mt-3', 'text-sm', 'opacity-70']">
          Нет событий для показа.
        </div>

        <div v-else :class="['mt-3', 'grid', 'gap-2']">
          <details
            v-for="event in recentEvents"
            :key="`${event.seq}-${event.event}-${eventSummary(event)}`"
            :class="['rounded-xl', 'bg-white/80', 'px-3', 'py-2', 'dark:bg-neutral-950/60']"
          >
            <summary :class="['cursor-pointer', 'select-none', 'text-sm', 'font-medium']">
              {{ event.event }}<template v-if="event.sseEvent">
                / {{ event.sseEvent }}
              </template>
              <span :class="['ml-2', 'text-xs', 'opacity-70']">{{ formatDateTime(event.at) }}</span>
            </summary>
            <pre :class="['mt-2', 'whitespace-pre-wrap', 'break-words', 'text-xs']">{{ eventSummary(event) }}</pre>
          </details>
        </div>
      </div>
    </section>

    <section :class="['rounded-2xl', 'border', 'border-neutral-200/70', 'bg-neutral-50', 'p-4', 'dark:border-neutral-700', 'dark:bg-neutral-900/40']">
      <h3 :class="['text-base', 'font-semibold']">
        Raw Trace Tail
      </h3>
      <pre :class="['mt-3', 'max-h-[360px]', 'overflow-auto', 'rounded-xl', 'bg-white/80', 'p-3', 'text-xs', 'whitespace-pre-wrap', 'dark:bg-neutral-950/60']">{{ latestTrace?.rawTail || 'No trace tail available.' }}</pre>
    </section>
  </div>
</template>

<route lang="yaml">
meta:
  layout: settings
  title: Pico Avatar Bridge
  subtitleKey: tamagotchi.settings.devtools.title
</route>
