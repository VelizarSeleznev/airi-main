import localforage from 'localforage'

import { animations } from '@proj-airi/stage-ui-three/assets/vrm'
import { until } from '@vueuse/core'
import { nanoid } from 'nanoid'
import { defineStore } from 'pinia'
import { ref } from 'vue'

export type VRMMotion = VRMMotionFile | VRMMotionURL

/**
 * Stored VRM animation clip imported from a local `.vrma` file.
 *
 * Use when:
 * - The user uploads custom motion clips in the browser
 * - A card needs to point at a persistent local motion id
 *
 * Expects:
 * - `file` is a `.vrma` animation clip
 *
 * Returns:
 * - A persistent motion record backed by IndexedDB
 */
export interface VRMMotionFile {
  id: string
  type: 'file'
  file: File
  name: string
  importedAt: number
}

/**
 * Built-in VRM animation clip resolved from a bundled asset URL.
 *
 * Use when:
 * - The motion ships with AIRI
 * - The app should resolve motion clips without user upload
 *
 * Expects:
 * - `url` points to a `.vrma` asset available to the renderer
 *
 * Returns:
 * - A reusable preset motion entry
 */
export interface VRMMotionURL {
  id: string
  type: 'url'
  url: string
  name: string
  importedAt: number
}

const vrmMotionPresets: VRMMotion[] = [
  { id: 'preset-vrm-motion-idle-loop', type: 'url', url: animations.idleLoop.toString(), name: 'idle_loop', importedAt: 1733113886840 },
  { id: 'preset-vrm-motion-pack-01', type: 'url', url: animations.motionPack01.toString(), name: 'VRMA_01', importedAt: 1733113886841 },
  { id: 'preset-vrm-motion-pack-02', type: 'url', url: animations.motionPack02.toString(), name: 'VRMA_02', importedAt: 1733113886842 },
  { id: 'preset-vrm-motion-pack-03', type: 'url', url: animations.motionPack03.toString(), name: 'VRMA_03', importedAt: 1733113886843 },
  { id: 'preset-vrm-motion-pack-04', type: 'url', url: animations.motionPack04.toString(), name: 'VRMA_04', importedAt: 1733113886844 },
  { id: 'preset-vrm-motion-pack-05', type: 'url', url: animations.motionPack05.toString(), name: 'VRMA_05', importedAt: 1733113886845 },
  { id: 'preset-vrm-motion-pack-06', type: 'url', url: animations.motionPack06.toString(), name: 'VRMA_06', importedAt: 1733113886846 },
  { id: 'preset-vrm-motion-pack-07', type: 'url', url: animations.motionPack07.toString(), name: 'VRMA_07', importedAt: 1733113886847 },
]

/**
 * Manages bundled and user-imported VRM animation clips.
 *
 * Use when:
 * - UI needs to list available `.vrma` motions
 * - Stage runtime needs to resolve a motion id or name into a playable URL
 *
 * Expects:
 * - User motions are stored under `vrm-motion-*` keys in IndexedDB
 *
 * Returns:
 * - Motion records, CRUD helpers, and stable URL resolution for runtime playback
 */
export const useVrmMotionsStore = defineStore('vrm-motions', () => {
  const vrmMotions = ref<VRMMotion[]>([])
  const vrmMotionsFromIndexedDBLoading = ref(false)
  const motionObjectUrls = new Map<string, string>()

  function normalizeMotionLookup(value: string) {
    return value.trim().toLowerCase()
  }

  function findMotionSync(query?: string | null) {
    if (!query)
      return undefined

    const normalized = normalizeMotionLookup(query)
    return vrmMotions.value.find(motion =>
      normalizeMotionLookup(motion.id) === normalized
      || normalizeMotionLookup(motion.name) === normalized,
    )
  }

  function revokeMotionUrl(id: string) {
    const objectUrl = motionObjectUrls.get(id)
    if (!objectUrl)
      return

    URL.revokeObjectURL(objectUrl)
    motionObjectUrls.delete(id)
  }

  async function loadVrmMotionsFromIndexedDB() {
    await until(vrmMotionsFromIndexedDBLoading).toBe(false)

    vrmMotionsFromIndexedDBLoading.value = true
    const motions = [...vrmMotionPresets]

    try {
      await localforage.iterate<VRMMotionFile, void>((value, key) => {
        if (key.startsWith('vrm-motion-'))
          motions.push(value)
      })
    }
    catch (error) {
      console.error(error)
    }

    vrmMotions.value = motions.sort((a, b) => b.importedAt - a.importedAt)
    vrmMotionsFromIndexedDBLoading.value = false
  }

  async function getVrmMotion(id: string) {
    await until(vrmMotionsFromIndexedDBLoading).toBe(false)
    const motionFromFile = await localforage.getItem<VRMMotionFile>(id)
    if (motionFromFile)
      return motionFromFile

    return vrmMotionPresets.find(motion => motion.id === id)
  }

  async function addVrmMotion(file: File) {
    await until(vrmMotionsFromIndexedDBLoading).toBe(false)
    const motion: VRMMotionFile = {
      id: `vrm-motion-${nanoid()}`,
      type: 'file',
      file,
      name: file.name.replace(/\.vrma$/i, ''),
      importedAt: Date.now(),
    }

    vrmMotions.value.unshift(motion)
    await localforage.setItem<VRMMotionFile>(motion.id, motion)
    return motion
  }

  async function renameVrmMotion(id: string, name: string) {
    await until(vrmMotionsFromIndexedDBLoading).toBe(false)
    const motion = await localforage.getItem<VRMMotionFile>(id)
    if (!motion)
      return

    motion.name = name
    await localforage.setItem<VRMMotionFile>(id, motion)
    vrmMotions.value = vrmMotions.value.map(item => item.id === id ? motion : item)
  }

  async function removeVrmMotion(id: string) {
    await until(vrmMotionsFromIndexedDBLoading).toBe(false)
    revokeMotionUrl(id)
    await localforage.removeItem(id)
    vrmMotions.value = vrmMotions.value.filter(motion => motion.id !== id)
  }

  async function getVrmMotionUrl(idOrName?: string | null) {
    await until(vrmMotionsFromIndexedDBLoading).toBe(false)
    const motion = findMotionSync(idOrName)
    if (!motion)
      return undefined

    if (motion.type === 'url')
      return motion.url

    const currentObjectUrl = motionObjectUrls.get(motion.id)
    if (currentObjectUrl)
      return currentObjectUrl

    const nextObjectUrl = URL.createObjectURL(motion.file)
    motionObjectUrls.set(motion.id, nextObjectUrl)
    return nextObjectUrl
  }

  async function resetVrmMotions() {
    await loadVrmMotionsFromIndexedDB()
    const userMotionIds = vrmMotions.value.filter(motion => motion.type === 'file').map(motion => motion.id)
    for (const id of userMotionIds) {
      await removeVrmMotion(id)
    }

    vrmMotions.value = [...vrmMotionPresets].sort((a, b) => b.importedAt - a.importedAt)
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('unload', () => {
      for (const id of motionObjectUrls.keys())
        revokeMotionUrl(id)
    })
  }

  return {
    vrmMotions,
    vrmMotionsFromIndexedDBLoading,

    loadVrmMotionsFromIndexedDB,
    getVrmMotion,
    addVrmMotion,
    renameVrmMotion,
    removeVrmMotion,
    getVrmMotionUrl,
    findMotionSync,
    resetVrmMotions,
  }
})
