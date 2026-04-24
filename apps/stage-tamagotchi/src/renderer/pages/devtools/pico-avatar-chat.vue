<script setup lang="ts">
import PicoAvatarBridgePanel from '../../components/pico-avatar/bridge-panel.vue'
</script>

<template>
  <div :class="['h-full', 'w-full', 'overflow-hidden', 'p-4']">
    <PicoAvatarBridgePanel mode="window" />
  </div>
</template>

<route lang="yaml">
meta:
  layout: settings
  title: PicoClaw Chat
  subtitle: Dedicated PicoClaw chat window
  stageTransition:
    name: slide
</route>
