import type { createContext } from '@moeru/eventa/adapters/electron/main'
import type { BrowserWindow } from 'electron'

import type {
  ElectronPicoAvatarInspection,
  ElectronPicoAvatarLauncherStatus,
} from '../../../shared/eventa'

import { spawn } from 'node:child_process'
import { access, readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { defineInvokeHandler } from '@moeru/eventa'
import { errorMessageFrom } from '@moeru/std'
import { shell } from 'electron'

import {
  electronPicoAvatarInspect,
  electronPicoAvatarOpenLatestTrace,
  electronPicoAvatarOpenTraceDir,
  electronPicoAvatarStartBridge,
  electronPicoAvatarStartLauncher,
  electronPicoAvatarStopBridge,
  electronPicoAvatarStopLauncher,
} from '../../../shared/eventa'
import { parsePicoAvatarTrace } from './pico-avatar-trace'

const PICO_AVATAR_PORT = 5174
const PICO_AVATAR_UI_URL = `http://127.0.0.1:${PICO_AVATAR_PORT}/pico-avatar`
const PICO_AVATAR_STATUS_URL = `http://127.0.0.1:${PICO_AVATAR_PORT}/api/picoclaw/status`
const PICOCLAW_LAUNCHER_UI_URL = 'http://127.0.0.1:18800'
const PICOCLAW_LAUNCHER_GATEWAY_URL = 'http://127.0.0.1:18790'
const PICOCLAW_LAUNCHER_CONTAINER = 'airi-pico-avatar-launcher'

function resolveRepoRoot() {
  return resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', '..', '..')
}

function resolvePicoAvatarPaths() {
  const home = homedir()
  const repoRoot = resolveRepoRoot()

  return {
    bridgeScriptPath: join(home, 'bin', 'start-pico-avatar'),
    launcherScriptPath: join(home, 'bin', 'start-picoclaw-launcher'),
    traceDir: join(repoRoot, 'apps', 'stage-web', '.cache', 'picoclaw-bridge-logs'),
    latestTracePointerPath: join(repoRoot, 'apps', 'stage-web', '.cache', 'picoclaw-bridge-logs', 'latest.txt'),
  }
}

async function fileExists(path: string) {
  try {
    await access(path)
    return true
  }
  catch {
    return false
  }
}

async function fetchBridgeStatus() {
  try {
    const response = await fetch(PICO_AVATAR_STATUS_URL)
    if (!response.ok) {
      return {
        reachable: false,
        error: `HTTP ${response.status}`,
      }
    }

    return {
      reachable: true,
      status: await response.json(),
    }
  }
  catch (error) {
    return {
      reachable: false,
      error: errorMessageFrom(error) ?? 'Failed to fetch PicoClaw bridge status',
    }
  }
}

async function spawnDetached(command: string) {
  const child = spawn('/bin/zsh', ['-lc', command], {
    detached: true,
    stdio: 'ignore',
  })

  child.unref()
}

async function execShell(command: string) {
  return await new Promise<{ code: number | null, stdout: string, stderr: string }>((resolveResult) => {
    let stdout = ''
    let stderr = ''
    const child = spawn('/bin/zsh', ['-lc', command], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8')
    })

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8')
    })

    child.on('close', (code) => {
      resolveResult({
        code,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
      })
    })
  })
}

async function inspectLauncher(): Promise<ElectronPicoAvatarLauncherStatus> {
  const result = await execShell(`docker ps -a --filter "name=^/${PICOCLAW_LAUNCHER_CONTAINER}$" --format '{{.Names}}|{{.State}}'`)
  if (result.code !== 0) {
    return {
      running: false,
      exists: false,
      containerName: PICOCLAW_LAUNCHER_CONTAINER,
      uiUrl: PICOCLAW_LAUNCHER_UI_URL,
      gatewayUrl: PICOCLAW_LAUNCHER_GATEWAY_URL,
      error: result.stderr || 'Failed to inspect PicoClaw launcher container',
    }
  }

  const row = result.stdout.split('\n').find(Boolean)
  if (!row) {
    return {
      running: false,
      exists: false,
      containerName: PICOCLAW_LAUNCHER_CONTAINER,
      uiUrl: PICOCLAW_LAUNCHER_UI_URL,
      gatewayUrl: PICOCLAW_LAUNCHER_GATEWAY_URL,
    }
  }

  const [containerName, state] = row.split('|')
  return {
    running: state === 'running',
    exists: true,
    containerName: containerName || PICOCLAW_LAUNCHER_CONTAINER,
    uiUrl: PICOCLAW_LAUNCHER_UI_URL,
    gatewayUrl: PICOCLAW_LAUNCHER_GATEWAY_URL,
  }
}

async function readLatestTrace() {
  const { latestTracePointerPath } = resolvePicoAvatarPaths()
  if (!await fileExists(latestTracePointerPath)) {
    return undefined
  }

  const latestTracePath = (await readFile(latestTracePointerPath, 'utf8')).trim()
  if (!latestTracePath || !await fileExists(latestTracePath)) {
    return undefined
  }

  const [raw, traceStats] = await Promise.all([
    readFile(latestTracePath, 'utf8'),
    stat(latestTracePath),
  ])

  return parsePicoAvatarTrace({
    path: latestTracePath,
    raw,
    updatedAt: traceStats.mtimeMs,
  })
}

/**
 * Collects PicoClaw bridge health, launcher state, and latest trace artifacts.
 *
 * Use when:
 * - Desktop devtools needs a single snapshot for PicoClaw observability
 * - Start/stop actions should return fresh state without extra renderer requests
 *
 * Expects:
 * - Optional local helper scripts in `~/bin`
 * - Bridge traces under `apps/stage-web/.cache/picoclaw-bridge-logs`
 *
 * Returns:
 * - A snapshot that renderer pages can display directly
 */
export async function inspectPicoAvatar(): Promise<ElectronPicoAvatarInspection> {
  const paths = resolvePicoAvatarPaths()
  const [bridge, launcher, latestTrace] = await Promise.all([
    fetchBridgeStatus(),
    inspectLauncher(),
    readLatestTrace(),
  ])

  return {
    checkedAt: Date.now(),
    bridgeUiUrl: PICO_AVATAR_UI_URL,
    bridgeStatusUrl: PICO_AVATAR_STATUS_URL,
    launcherUiUrl: PICOCLAW_LAUNCHER_UI_URL,
    launcherGatewayUrl: PICOCLAW_LAUNCHER_GATEWAY_URL,
    traceDir: paths.traceDir,
    latestTracePath: latestTrace?.path,
    bridgeScriptPath: paths.bridgeScriptPath,
    launcherScriptPath: paths.launcherScriptPath,
    bridge,
    launcher,
    latestTrace,
  }
}

export function createPicoAvatarService(params: {
  context: ReturnType<typeof createContext>['context']
  window: BrowserWindow
}) {
  defineInvokeHandler(params.context, electronPicoAvatarInspect, async () => inspectPicoAvatar())

  defineInvokeHandler(params.context, electronPicoAvatarStartBridge, async () => {
    const { bridgeScriptPath } = resolvePicoAvatarPaths()
    if (!await fileExists(bridgeScriptPath)) {
      throw new Error(`Pico avatar start script not found: ${bridgeScriptPath}`)
    }

    await spawnDetached(`exec ${JSON.stringify(bridgeScriptPath)}`)
    await new Promise(resolve => setTimeout(resolve, 1500))
    return inspectPicoAvatar()
  })

  defineInvokeHandler(params.context, electronPicoAvatarStopBridge, async () => {
    await execShell(`pids=$(lsof -tiTCP:${PICO_AVATAR_PORT} -sTCP:LISTEN 2>/dev/null || true); if [ -n "$pids" ]; then kill -TERM $pids || true; fi`)
    await new Promise(resolve => setTimeout(resolve, 800))
    await execShell(`pids=$(lsof -tiTCP:${PICO_AVATAR_PORT} -sTCP:LISTEN 2>/dev/null || true); if [ -n "$pids" ]; then kill -KILL $pids || true; fi`)
    return inspectPicoAvatar()
  })

  defineInvokeHandler(params.context, electronPicoAvatarStartLauncher, async () => {
    const { launcherScriptPath } = resolvePicoAvatarPaths()
    if (!await fileExists(launcherScriptPath)) {
      throw new Error(`PicoClaw launcher start script not found: ${launcherScriptPath}`)
    }

    await spawnDetached(`exec ${JSON.stringify(launcherScriptPath)}`)
    await new Promise(resolve => setTimeout(resolve, 1200))
    return inspectPicoAvatar()
  })

  defineInvokeHandler(params.context, electronPicoAvatarStopLauncher, async () => {
    await execShell(`docker stop ${PICOCLAW_LAUNCHER_CONTAINER} >/dev/null 2>&1 || true`)
    return inspectPicoAvatar()
  })

  defineInvokeHandler(params.context, electronPicoAvatarOpenTraceDir, async () => {
    const { traceDir } = resolvePicoAvatarPaths()
    const openResult = await shell.openPath(traceDir)
    if (openResult) {
      throw new Error(openResult)
    }
    return { path: traceDir }
  })

  defineInvokeHandler(params.context, electronPicoAvatarOpenLatestTrace, async () => {
    const latestTrace = await readLatestTrace()
    if (!latestTrace) {
      throw new Error('No PicoClaw trace file found yet.')
    }

    const openResult = await shell.openPath(latestTrace.path)
    if (openResult) {
      throw new Error(openResult)
    }
    return { path: latestTrace.path }
  })
}
