<script setup lang="ts">
import type { SpeechProvider } from '@xsai-ext/providers/utils'

import {
  SpeechPlayground,
  SpeechProviderSettings,
} from '@proj-airi/stage-ui/components'
import { useSpeechStore } from '@proj-airi/stage-ui/stores/modules/speech'
import { useProvidersStore } from '@proj-airi/stage-ui/stores/providers'
import { Callout, FieldCombobox, FieldRange } from '@proj-airi/ui'
import { storeToRefs } from 'pinia'
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

const providerId = 'inworld-tts'
const defaultModel = 'inworld-tts-1.5-max'
const defaultVoiceSettings = {
  speed: 1.0,
}

const speechStore = useSpeechStore()
const providersStore = useProvidersStore()
const { providers } = storeToRefs(providersStore)

const speed = ref<number>(
  (providers.value[providerId] as any)?.voiceSettings?.speed
  || (providers.value[providerId] as any)?.speed
  || defaultVoiceSettings.speed,
)

const model = computed({
  get: () => providers.value[providerId]?.model as string | undefined || defaultModel,
  set: (value) => {
    if (!providers.value[providerId])
      providers.value[providerId] = {}
    providers.value[providerId].model = value
  },
})

const apiKeyConfigured = computed(() => !!providers.value[providerId]?.apiKey)

const providerModels = computed(() => [
  {
    id: 'inworld-tts-1.5-max',
    name: 'inworld-tts-1.5-max',
    provider: providerId,
    description: 'Higher quality multilingual model',
    contextLength: 0,
    deprecated: false,
  },
  {
    id: 'inworld-tts-1.5-mini',
    name: 'inworld-tts-1.5-mini',
    provider: providerId,
    description: 'Lower latency model',
    contextLength: 0,
    deprecated: false,
  },
])

const availableVoices = computed(() => {
  return speechStore.availableVoices[providerId] || []
})

onMounted(async () => {
  providers.value[providerId] ??= {}
  providers.value[providerId].model ??= defaultModel
  providers.value[providerId].baseUrl ??= 'https://api.inworld.ai/tts/v1/'
  providers.value[providerId].voiceSettings ??= { ...defaultVoiceSettings }

  await speechStore.loadVoicesForProvider(providerId)
})

watch(apiKeyConfigured, async (configured) => {
  if (configured)
    await speechStore.loadVoicesForProvider(providerId)
})

async function handleGenerateSpeech(input: string, voiceId: string, _useSSML: boolean) {
  const provider = await providersStore.getProviderInstance<SpeechProvider<string>>(providerId)
  if (!provider) {
    throw new Error('Failed to initialize speech provider')
  }

  const providerConfig = providersStore.getProviderConfig(providerId)
  const modelToUse = model.value || defaultModel

  return await speechStore.speech(
    provider,
    modelToUse,
    input,
    voiceId,
    {
      ...providerConfig,
      ...defaultVoiceSettings,
      speed: speed.value,
    },
  )
}

watch(speed, async () => {
  if (!providers.value[providerId])
    providers.value[providerId] = {}
  const providerConfig = providers.value[providerId] as Record<string, unknown> & {
    speed?: number
    voiceSettings?: { speed?: number }
  }
  providerConfig.speed = speed.value
  providerConfig.voiceSettings ??= { ...defaultVoiceSettings }
  providerConfig.voiceSettings.speed = speed.value
})
</script>

<template>
  <Callout
    theme="orange"
    label="Inworld TTS demo only"
  >
    This page uses the browser directly with a Basic API key and only the synchronous REST path.
    It does not include a secure backend proxy, JWT flow, streaming, timestamps, or other hardening.
    Keep it for local demos. Do not ship the key in a public web build.
  </Callout>

  <SpeechProviderSettings
    :provider-id="providerId"
    :default-model="defaultModel"
    :additional-settings="defaultVoiceSettings"
  >
    <template #voice-settings>
      <FieldCombobox
        v-model="model"
        label="Model"
        description="Select the Inworld TTS model to use for speech generation"
        :options="providerModels.map(m => ({ value: m.id, label: m.name }))"
        placeholder="Select a model..."
      />
      <FieldRange
        v-model="speed"
        :label="t('settings.pages.providers.provider.common.fields.field.speed.label')"
        :description="t('settings.pages.providers.provider.common.fields.field.speed.description')"
        :min="0.5"
        :max="1.5"
        :step="0.01"
      />
    </template>

    <template #playground>
      <SpeechPlayground
        :available-voices="availableVoices"
        :generate-speech="handleGenerateSpeech"
        :api-key-configured="apiKeyConfigured"
        default-text="Hello! This is a test of the Inworld speech synthesis demo."
      />
    </template>
  </SpeechProviderSettings>
</template>

<route lang="yaml">
meta:
  layout: settings
  stageTransition:
    name: slide
</route>
