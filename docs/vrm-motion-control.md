# VRM Motion Control

This document records how AIRI currently handles `.vrma` animation clips for VRM avatars.

## What exists now

- `packages/stage-ui-three` can play bundled and uploaded `.vrma` clips on VRM avatars.
- `packages/stage-ui/src/components/scenes/Stage.vue` routes:
  - manual UI playback through `playMotionById(...)`
  - LLM playback through `ACT.motion`
- AIRI cards can store a per-card idle motion under `extensions.airi.modules.vrmMotion.idleMotionId`.

## Built-in motion presets

Bundled presets live in:

- `packages/stage-ui-three/src/assets/vrm/animations/idle_loop.vrma`
- `packages/stage-ui-three/src/assets/vrm/animations/motion-pack/VRMA_01.vrma`
- `packages/stage-ui-three/src/assets/vrm/animations/motion-pack/VRMA_02.vrma`
- `packages/stage-ui-three/src/assets/vrm/animations/motion-pack/VRMA_03.vrma`
- `packages/stage-ui-three/src/assets/vrm/animations/motion-pack/VRMA_04.vrma`
- `packages/stage-ui-three/src/assets/vrm/animations/motion-pack/VRMA_05.vrma`
- `packages/stage-ui-three/src/assets/vrm/animations/motion-pack/VRMA_06.vrma`
- `packages/stage-ui-three/src/assets/vrm/animations/motion-pack/VRMA_07.vrma`

Source pack verified on 2026-04-22:

- `/Users/velizard/Downloads/VRMA_MotionPack/vrma`

## Runtime contract

The current LLM-facing motion trigger format is:

```text
<|ACT {"motion":"VRMA_03"}|>
<|ACT {"motion":{"name":"VRMA_03","loop":false}}|>
```

Rules:

- `motion` is matched against the VRM motion store by motion `id` or `name`
- one-shot clips restore the configured idle motion after completion
- looped clips stay active until another motion or idle clip replaces them

## UI entry points

- `apps/stage-web/src/pages/pico-avatar.vue`
  - choose a motion
  - preview it on the active avatar
  - upload additional `.vrma` clips
  - set the current motion as the active AIRI card idle clip
- `packages/stage-pages/src/pages/settings/airi-card/components/CardCreationDialog.vue`
  - choose the idle VRM animation for a card

## Storage

- VRM motions are managed in `packages/stage-ui/src/stores/vrm-motions.ts`
- user-imported clips are stored in IndexedDB via `localforage`
- bundled presets are resolved as static asset URLs
