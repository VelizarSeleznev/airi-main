import { useLocalStorageManualReset } from '@proj-airi/stage-shared/composables'
import { defineStore } from 'pinia'

export const useSettingsDeveloper = defineStore('settings-developer', () => {
  const inspectUpdaterDiagnostics = useLocalStorageManualReset<boolean>('settings/developer/inspect-updater-diagnostics', false)
  const picoAvatarBridgePanelEnabled = useLocalStorageManualReset<boolean>('settings/developer/pico-avatar-bridge-panel-enabled', false)

  function resetState() {
    inspectUpdaterDiagnostics.reset()
    picoAvatarBridgePanelEnabled.reset()
  }

  return {
    inspectUpdaterDiagnostics,
    picoAvatarBridgePanelEnabled,
    resetState,
  }
})
