<script setup lang="ts">
import { usePicoAvatarBridgeStore } from '@proj-airi/stage-ui/stores/pico-avatar-bridge'
import { Button, FieldCheckbox, Input } from '@proj-airi/ui'
import { storeToRefs } from 'pinia'
import { computed, onMounted, onUnmounted, ref } from 'vue'

const AUTO_REFRESH_OWNER = 'tamagotchi-devtools-pico-avatar'
const bridgeStore = usePicoAvatarBridgeStore()

const filter = ref('')
const autoRefresh = ref(true)

const {
  inspection,
  bridgeStatus,
  latestTrace,
  runtimeLogs,
  bridgeError,
  bridgeRuntimeSummary,
} = storeToRefs(bridgeStore)

const recentEvents = computed(() => {
  const query = filter.value.trim().toLowerCase()
  const events = latestTrace.value?.recentEvents ?? []
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
})

const llmEvents = computed(() => {
  const query = filter.value.trim().toLowerCase()
  const events = latestTrace.value?.llmEvents ?? []
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
})

function formatDateTime(value?: number | string) {
  if (!value)
    return '—'

  const date = typeof value === 'number' ? new Date(value) : new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString()
}

function summarizeEvent(event: { event: string, line?: string, text?: string, messagePreview?: string, sseEvent?: string }) {
  return event.line || event.text || event.messagePreview || event.sseEvent || event.event
}

function updateAutoRefresh() {
  if (autoRefresh.value) {
    bridgeStore.requestAutoRefresh(AUTO_REFRESH_OWNER)
    return
  }

  bridgeStore.releaseAutoRefresh(AUTO_REFRESH_OWNER)
}

onMounted(() => {
  updateAutoRefresh()
  void bridgeStore.refreshInspection().catch(() => undefined)
})

onUnmounted(() => {
  bridgeStore.releaseAutoRefresh(AUTO_REFRESH_OWNER)
})
</script>

<template>
  <div :class="['h-full', 'flex', 'flex-col', 'gap-4', 'overflow-y-auto', 'p-4']">
    <div :class="['grid', 'gap-3', 'xl:grid-cols-[1.1fr_0.9fr]']">
      <section :class="['rounded-2xl', 'border', 'border-neutral-200/70', 'bg-neutral-50', 'p-4', 'dark:border-neutral-700', 'dark:bg-neutral-900/40']">
        <div :class="['flex', 'flex-wrap', 'items-start', 'justify-between', 'gap-3']">
          <div>
            <h2 :class="['text-lg', 'font-semibold']">
              PicoClaw Desktop Bridge
            </h2>
            <p :class="['text-sm', 'text-neutral-500']">
              Общий инспектор для интегрированного bridge-panel в основном AIRI stage.
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
          <Button @click="void bridgeStore.startBridge()">
            Start Bridge
          </Button>
          <Button variant="secondary" @click="void bridgeStore.stopBridge()">
            Stop Bridge
          </Button>
          <Button @click="void bridgeStore.startLauncher()">
            Start Launcher
          </Button>
          <Button variant="secondary" @click="void bridgeStore.stopLauncher()">
            Stop Launcher
          </Button>
          <Button variant="ghost" @click="void bridgeStore.refreshInspection()">
            Refresh
          </Button>
          <Button :disabled="!latestTrace" variant="ghost" @click="void bridgeStore.openLatestTrace()">
            Open Latest Trace
          </Button>
          <Button variant="ghost" @click="void bridgeStore.openTraceDir()">
            Open Trace Dir
          </Button>
        </div>

        <div :class="['mt-4', 'flex', 'flex-wrap', 'items-center', 'gap-4', 'text-sm']">
          <FieldCheckbox v-model="autoRefresh" label="Auto refresh" @update:model-value="updateAutoRefresh" />
          <a :class="['text-sky-600', 'underline', 'dark:text-sky-300']" :href="inspection?.bridgeUiUrl" target="_blank" rel="noreferrer">
            Open bridge UI
          </a>
          <a :class="['text-sky-600', 'underline', 'dark:text-sky-300']" :href="inspection?.launcherUiUrl" target="_blank" rel="noreferrer">
            Open launcher UI
          </a>
        </div>

        <div
          v-if="bridgeError"
          :class="['mt-4', 'rounded-xl', 'border', 'border-red-300/60', 'bg-red-500/10', 'px-3', 'py-2', 'text-sm', 'text-red-700', 'dark:text-red-200']"
        >
          {{ bridgeError }}
        </div>

        <div :class="['mt-4', 'rounded-xl', 'bg-white/80', 'p-3', 'text-sm', 'dark:bg-neutral-950/60']">
          {{ bridgeRuntimeSummary }}
        </div>
      </section>

      <section :class="['rounded-2xl', 'border', 'border-neutral-200/70', 'bg-neutral-50', 'p-4', 'dark:border-neutral-700', 'dark:bg-neutral-900/40']">
        <div :class="['flex', 'items-center', 'justify-between', 'gap-3']">
          <div>
            <h2 :class="['text-lg', 'font-semibold']">
              Integrated Runtime Logs
            </h2>
            <p :class="['text-sm', 'text-neutral-500']">
              Локальная timeline интегрированного bridge-store в текущем renderer окне.
            </p>
          </div>

          <Button variant="ghost" @click="bridgeStore.clearRuntimeLogs()">
            Clear Logs
          </Button>
        </div>

        <div :class="['mt-4', 'space-y-2']">
          <div
            v-for="log in runtimeLogs.slice(0, 12)"
            :key="`${log.at}-${log.message}`"
            :class="['rounded-xl', 'bg-white/80', 'px-3', 'py-2', 'text-sm', 'dark:bg-neutral-950/60']"
          >
            <div :class="['font-medium']">
              {{ log.at }} · {{ log.level.toUpperCase() }}
            </div>
            <div :class="['mt-1', 'text-neutral-600', 'dark:text-neutral-300']">
              {{ log.message }}
            </div>
          </div>
        </div>
      </section>
    </div>

    <section :class="['rounded-2xl', 'border', 'border-neutral-200/70', 'bg-neutral-50', 'p-4', 'dark:border-neutral-700', 'dark:bg-neutral-900/40']">
      <div :class="['flex', 'flex-wrap', 'items-center', 'justify-between', 'gap-3']">
        <div>
          <h2 :class="['text-lg', 'font-semibold']">
            Latest Trace
          </h2>
          <p :class="['text-sm', 'text-neutral-500']">
            Raw trace summary from the shared desktop inspect API.
          </p>
        </div>

        <Input v-model="filter" placeholder="Filter events" />
      </div>

      <div :class="['mt-4', 'grid', 'gap-4', 'xl:grid-cols-2']">
        <div :class="['space-y-2']">
          <h3 :class="['text-sm', 'font-semibold']">
            Recent Bridge Events
          </h3>
          <div
            v-for="event in recentEvents"
            :key="`${event.seq || event.event}-${event.at || ''}`"
            :class="['rounded-xl', 'bg-white/80', 'px-3', 'py-2', 'text-sm', 'dark:bg-neutral-950/60']"
          >
            <div :class="['font-medium']">
              {{ event.event }}
            </div>
            <div :class="['mt-1', 'text-neutral-600', 'dark:text-neutral-300']">
              {{ summarizeEvent(event) }}
            </div>
          </div>
        </div>

        <div :class="['space-y-2']">
          <h3 :class="['text-sm', 'font-semibold']">
            LLM / Finalization Events
          </h3>
          <div
            v-for="event in llmEvents"
            :key="`${event.seq || event.event}-${event.at || ''}`"
            :class="['rounded-xl', 'bg-white/80', 'px-3', 'py-2', 'text-sm', 'dark:bg-neutral-950/60']"
          >
            <div :class="['font-medium']">
              {{ event.event }}
            </div>
            <div :class="['mt-1', 'text-neutral-600', 'dark:text-neutral-300']">
              {{ summarizeEvent(event) }}
            </div>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<route lang="yaml">
meta:
  layout: settings
  title: Pico Avatar Bridge
  subtitle: Desktop bridge inspector
  stageTransition:
    name: slide
</route>
