import { onUnmounted, ref } from 'vue'

export interface UseAudioAnalyzerOptions {
  /**
   * Controls how often the analyser samples the current audio stream.
   *
   * Use when:
   * - A visual meter needs stable updates without running at display refresh rate
   * - Battery usage matters more than frame-perfect waveform updates
   *
   * Expects:
   * - A positive millisecond interval
   *
   * @default 50
   */
  updateIntervalMs?: number
}

/**
 * Creates a throttled audio analyser loop for microphone and playback meters.
 *
 * Use when:
 * - UI needs a coarse volume level from an `AnalyserNode`
 * - Consumers need explicit start/stop control for component cleanup
 *
 * Expects:
 * - `startAnalyzer` receives a live `AudioContext`
 *
 * Returns:
 * - Reactive volume/error state and analyser lifecycle helpers
 */
export function useAudioAnalyzer(options: UseAudioAnalyzerOptions = {}) {
  const analyzer = ref<AnalyserNode>()
  const dataArray = ref<Uint8Array<ArrayBuffer>>()
  const timer = ref<ReturnType<typeof setTimeout>>()

  const onAnalyzerUpdateHooks = ref<Array<(volumeLevel: number) => void | Promise<void>>>([])

  const volumeLevel = ref(0) // 0-100
  const error = ref<string>()

  const amplification = 3 // Amplification factor for volume visualization

  function onAnalyzerUpdate(callback: (volumeLevel: number) => void | Promise<void>) {
    onAnalyzerUpdateHooks.value.push(callback)
    return () => {
      // optional cleanup if consumer wants to unsubscribe
      onAnalyzerUpdateHooks.value = onAnalyzerUpdateHooks.value.filter(cb => cb !== callback)
    }
  }

  function start() {
    if (timer.value)
      return // prevent multiple loops

    const updateIntervalMs = Math.max(16, options.updateIntervalMs ?? 50)

    const analyze = () => {
      if (!analyzer.value || !dataArray.value) {
        timer.value = undefined
        return
      }

      // Get frequency data for volume visualization
      analyzer.value.getByteFrequencyData(dataArray.value)

      // Calculate RMS volume level
      let sum = 0
      for (let i = 0; i < dataArray.value.length; i++) {
        sum += dataArray.value[i] * dataArray.value[i]
      }
      const rms = Math.sqrt(sum / dataArray.value.length)
      volumeLevel.value = Math.min(100, (rms / 255) * 100 * amplification) // Amplify for better visualization

      for (const hook of onAnalyzerUpdateHooks.value) {
        hook(volumeLevel.value)
      }

      // NOTICE:
      // Volume meters do not need display-refresh sampling. A timer keeps UI responsive
      // while avoiding a permanent 60fps RAF loop on battery.
      // Root cause summary: mic indicators previously sampled on every animation frame.
      // Source/context: `indicator-mic-volume.vue` only renders a coarse 0-100 level.
      // Removal condition: delete this throttle only if a consumer needs frame-accurate audio visualization.
      timer.value = setTimeout(analyze, updateIntervalMs)
    }

    analyze()
  }

  function startAnalyzer(audioContext: AudioContext) {
    if (!audioContext) {
      throw new Error('AudioContext is not initialized')
    }

    try {
      // Create analyser for volume detection
      analyzer.value = audioContext.createAnalyser()
      analyzer.value.fftSize = 256
      analyzer.value.smoothingTimeConstant = 0.3

      // Set up data array for analysis
      const bufferLength = analyzer.value.frequencyBinCount
      dataArray.value = new Uint8Array(bufferLength) as Uint8Array<ArrayBuffer>

      // Start audio analysis loop
      start()

      return analyzer.value
    }
    catch (err) {
      console.error('Error setting up audio monitoring:', err)
      error.value = err instanceof Error ? err.message : String(err)
    }
  }

  function stopAnalyzer() {
    // Stop scheduled analysis loop.
    if (timer.value) {
      clearTimeout(timer.value)
      timer.value = undefined
    }

    analyzer.value = undefined
    dataArray.value = undefined
  }

  // Auto-cleanup when used in a component
  onUnmounted(() => {
    stopAnalyzer()
  })

  return {
    volumeLevel,
    error,
    startAnalyzer,
    stopAnalyzer,
    onAnalyzerUpdate,
  }
}
