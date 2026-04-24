<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'

const props = withDefaults(defineProps<{
  stream?: MediaStream
  bars?: number
  minFreq?: number // Minimum frequency in Hz
  maxFreq?: number // Maximum frequency in Hz
}>(), {
  bars: 32,
  minFreq: 60, // Default human voice lower bound (~85Hz)
  maxFreq: 4000, // Default human voice upper bound (~255Hz)
})

const frequencies = ref<number[]>(Array.from<number>({ length: props.bars }).fill(0))
let audioContext: AudioContext | undefined
let source: MediaStreamAudioSourceNode | undefined
let animationFrame: number | undefined
let lastAnalyzedAt = 0

onMounted(() => {
  handleAnalyze()
})

watch(() => props.stream, handleAnalyze)

onBeforeUnmount(() => {
  stopAnalyze()
})

function stopAnalyze() {
  if (animationFrame) {
    cancelAnimationFrame(animationFrame)
    animationFrame = undefined
  }

  try {
    source?.disconnect()
  }
  catch {

  }

  source = undefined

  void audioContext?.close()
  audioContext = undefined
  lastAnalyzedAt = 0
}

function handleAnalyze() {
  stopAnalyze()

  if (!props.stream) {
    return
  }

  audioContext = new (window.AudioContext || (window as unknown as any).webkitAudioContext)()
  source = audioContext.createMediaStreamSource(props.stream)
  const analyser = audioContext.createAnalyser()

  analyser.fftSize = 2048
  source.connect(analyser)

  const bufferLength = analyser.frequencyBinCount
  const dataArray = new Uint8Array(bufferLength)

  // Calculate frequency resolution (Hz per bin)
  const sampleRate = audioContext.sampleRate
  const frequencyResolution = sampleRate / analyser.fftSize

  // Calculate bin indices for min and max frequencies
  const minBin = Math.floor(props.minFreq / frequencyResolution)
  const maxBin = Math.floor(props.maxFreq / frequencyResolution)
  const usableBins = maxBin - minBin

  // Calculate bins per bar based on the filtered frequency range
  const binsPerBar = Math.floor(usableBins / props.bars)

  const analyze = (now: number) => {
    try {
      animationFrame = requestAnimationFrame(analyze)
      if (now - lastAnalyzedAt < 33)
        return
      lastAnalyzedAt = now

      analyser.getByteFrequencyData(dataArray)

      const bars = Array.from<number>({ length: props.bars }).fill(0)

      for (let i = 0; i < props.bars; i++) {
        let sum = 0
        const startBin = minBin + (i * binsPerBar)

        for (let j = 0; j < binsPerBar; j++) {
          const binIndex = startBin + j
          if (binIndex < maxBin) // Ensure we don't exceed max frequency
            sum += dataArray[binIndex]
        }

        bars[i] = sum / binsPerBar / 255 // Normalize to 0-1
      }

      frequencies.value = bars
    }
    catch (err) {
      console.error(err)
    }
  }

  animationFrame = requestAnimationFrame(analyze)
}
</script>

<template>
  <slot :frequencies="frequencies" />
</template>
