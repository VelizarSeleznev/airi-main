import type { Buffer } from 'node:buffer'
import type { IncomingMessage, ServerResponse } from 'node:http'

import type { Plugin } from 'vite'

import process from 'node:process'

import { spawn } from 'node:child_process'
import { access, appendFile, cp, mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const DEFAULT_PICOCLAW_BIN = '/Users/velizard/Downloads/picoclaw_Darwin_arm64/picoclaw'
const DEFAULT_PICOCLAW_CONFIG = '/Users/velizard/.picoclaw/config.json'
const DEFAULT_LM_STUDIO_BASE_URL = 'http://127.0.0.1:1234/v1'
const DEFAULT_FAST_MODEL_ID = 'unsloth/gemma-4-26b-a4b-it'
const DEFAULT_FAST_TEMPERATURE = 0.4
const DEFAULT_OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1'
const DEFAULT_OPENROUTER_MODEL_ID = 'openrouter/free'
const DEFAULT_OPENROUTER_RECOMMENDATION_URL = 'https://shir-man-com.pages.dev/api/free-llm/recommendation'
const DEFAULT_OPENROUTER_RECOMMENDED_MODEL = 'openrouter/elephant-alpha'
const DEFAULT_OPENROUTER_PREFERRED_MODELS = [
  DEFAULT_OPENROUTER_RECOMMENDED_MODEL,
  'nvidia/nemotron-3-super-120b-a12b:free',
  'openai/gpt-oss-120b:free',
  'openai/gpt-oss-20b:free',
  'nvidia/nemotron-nano-9b-v2:free',
  'nvidia/nemotron-nano-12b-v2-vl:free',
  'google/gemma-4-26b-a4b-it:free',
  'google/gemma-4-31b-it:free',
  'minimax/minimax-m2.5:free',
  'qwen/qwen3-next-80b-a3b-instruct:free',
] as const
const DEFAULT_DOCKER_IMAGE = 'docker.io/sipeed/picoclaw:latest'
const CONTAINER_PICOCLAW_HOME = '/root/.picoclaw'
const CONTAINER_WORKSPACE = `${CONTAINER_PICOCLAW_HOME}/workspace`
const DEFAULT_DOCKER_CONTAINER_NAME = 'airi-pico-avatar'
const DEFAULT_DOCKER_PORTS = [
  '3000-3010:3000-3010',
  '4173-4175:4173-4175',
  '8000-8010:8000-8010',
  '8080-8090:8080-8090',
] as const
const LM_STUDIO_FALLBACK_BASE_URLS = [
  'http://127.0.0.1:1234/v1',
  'http://localhost:1234/v1',
  'http://host.docker.internal:1234/v1',
  'http://10.29.0.58:1234/v1',
] as const
const DEFAULT_MODEL_NAME = 'airi-lmstudio-gemma4'
const DEFAULT_MODEL_ID = 'openai/google/gemma-4-26b-a4b'
const DEFAULT_SESSION = 'airi:pico-avatar'
// NOTICE:
// PicoClaw prints final answers and some terminal runtime statuses through the
// same CLI marker. The bridge must split those before the browser receives
// them, otherwise infrastructure statuses become assistant chat history.
// See docs/picoclaw-avatar-bridge.md for the event boundary contract.
const TOOL_LIMIT_RESPONSE_PREFIX = 'I\'ve reached `max_tool_iterations` without a final response.'
const PROCESSING_ERROR_PREFIX = 'Error processing message:'
const VISIBLE_STATUS_MIN_INTERVAL_MS = 2500

interface VisibleStatusState {
  lastStatus: string
  lastStatusAt: number
}

interface PicoClawAgentRequest {
  message?: string
  session?: string
  debug?: boolean
}

interface FastLayerRequest {
  message?: string
  systemPrompt?: string
  availableVrmMotions?: string[]
}

interface PicoClawConfig {
  agents?: {
    defaults?: {
      provider?: string
      model_name?: string
      workspace?: string
      restrict_to_workspace?: boolean
      allow_read_outside_workspace?: boolean
    }
  }
  model_list?: Array<{
    model_name?: string
    model?: string
    api_base?: string
    api_keys?: string[] | string
  }>
}

interface RuntimeConfigResult {
  config: PicoClawConfig
  runnerKind: 'host' | 'docker'
  persistentContainer: boolean
  providerKind: 'lmstudio' | 'openrouter' | 'custom'
  modelSelectedAutomatically: boolean
  modelName: string
  model: string
  apiBase: string
  apiReachable: boolean
  runtimeHome?: string
  containerName?: string
  workspace: string | undefined
  workspaceRestricted: boolean
}

function resolveRepoRoot() {
  return resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..')
}

function resolveDockerRuntimeHome() {
  return process.env.STAGE_WEB_PICOCLAW_DOCKER_HOME
    || resolve(join(resolveRepoRoot(), 'apps', 'stage-web', '.cache', 'picoclaw-docker-home'))
}

function useDockerRunner() {
  return process.env.STAGE_WEB_PICOCLAW_RUNNER === 'docker'
    || process.env.STAGE_WEB_PICOCLAW_USE_DOCKER === 'true'
}

function usePersistentDockerRunner() {
  return process.env.STAGE_WEB_PICOCLAW_DOCKER_PERSISTENT !== 'false'
}

function stripAnsi(value: string) {
  return value.replace(/\u001B\[[\d;]*m/g, '')
}

function resolveBridgeTraceDir() {
  return process.env.STAGE_WEB_PICOCLAW_TRACE_DIR
    || resolve(join(resolveRepoRoot(), 'apps', 'stage-web', '.cache', 'picoclaw-bridge-logs'))
}

function createBridgeTraceId() {
  return `${new Date().toISOString().replace(/[:.]/g, '-')}-${Math.random().toString(36).slice(2, 8)}`
}

function truncateTraceText(value: string, maxLength = 4000) {
  return value.length > maxLength ? `${value.slice(0, maxLength)}...<truncated ${value.length - maxLength} chars>` : value
}

function sanitizeTraceValue(value: unknown): unknown {
  if (typeof value === 'string') {
    return truncateTraceText(value)
      .replace(/sk-or-v1-\w+/gi, 'sk-or-v1-<redacted>')
      .replace(/Bearer\s+[\w.-]+/gi, 'Bearer <redacted>')
  }

  if (Array.isArray(value))
    return value.map(item => sanitizeTraceValue(item))

  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => {
      if (key.toLowerCase().includes('key') || key.toLowerCase().includes('token'))
        return [key, '<redacted>']

      return [key, sanitizeTraceValue(item)]
    }))
  }

  return value
}

async function writeBridgeTrace(traceId: string, event: string, data: Record<string, unknown>) {
  const traceDir = resolveBridgeTraceDir()
  const logPath = join(traceDir, `${traceId}.jsonl`)
  const sanitizedData = sanitizeTraceValue(data) as Record<string, unknown>
  const payload = {
    at: new Date().toISOString(),
    traceId,
    event,
    ...sanitizedData,
  }

  await mkdir(traceDir, { recursive: true })
  await appendFile(logPath, `${JSON.stringify(payload)}\n`, 'utf8')
  await writeFile(join(traceDir, 'latest.txt'), `${logPath}\n`, 'utf8')
}

function writeJson(res: ServerResponse, statusCode: number, data: unknown) {
  res.statusCode = statusCode
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(data))
}

function writeSse(res: ServerResponse, event: string, data: unknown) {
  res.write(`event: ${event}\n`)
  res.write(`data: ${JSON.stringify(data)}\n\n`)
}

function readRequestJson<T>(req: IncomingMessage): Promise<T> {
  return new Promise((resolve, reject) => {
    let body = ''
    req.setEncoding('utf8')
    req.on('data', (chunk: string) => {
      body += chunk
    })
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) as T : {} as T)
      }
      catch (error) {
        reject(error)
      }
    })
    req.on('error', reject)
  })
}

async function isApiReachable(apiBase: string, apiKey?: string) {
  try {
    const headers = new Headers()

    if (apiKey)
      headers.set('Authorization', `Bearer ${apiKey}`)

    const response = await fetch(`${apiBase.replace(/\/$/, '')}/models`, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(4000),
    })

    return response.ok
  }
  catch {
    return false
  }
}

async function resolveLmStudioApiBase() {
  const configuredBase = process.env.STAGE_WEB_LM_STUDIO_TARGET
    || process.env.STAGE_WEB_PICOCLAW_API_BASE

  if (configuredBase) {
    const apiBase = configuredBase.endsWith('/v1')
      ? configuredBase
      : `${configuredBase.replace(/\/$/, '')}/v1`
    return {
      apiBase,
      reachable: await isApiReachable(apiBase, process.env.STAGE_WEB_PICOCLAW_API_KEY),
    }
  }

  for (const candidate of LM_STUDIO_FALLBACK_BASE_URLS) {
    if (await isApiReachable(candidate)) {
      return {
        apiBase: candidate,
        reachable: true,
      }
    }
  }

  return {
    apiBase: DEFAULT_LM_STUDIO_BASE_URL,
    reachable: false,
  }
}

function buildAvailableVrmMotionsPrompt(availableVrmMotions?: string[]) {
  const normalized = Array.from(new Set(
    (availableVrmMotions ?? [])
      .map(item => item.trim())
      .filter(Boolean),
  ))

  if (normalized.length === 0)
    return ''

  const builtInMotionLabels: Record<string, string> = {
    idle_loop: 'default idle loop',
    VRMA_01: 'friendly greeting',
    VRMA_02: 'thinking shift',
    VRMA_03: 'curious lean-in',
    VRMA_04: 'cheerful emphasis',
    VRMA_05: 'soft acknowledgment',
    VRMA_06: 'surprised reaction',
    VRMA_07: 'confident finish',
  }

  return [
    'Available VRM motions in the current AIRI setup:',
    ...normalized.map((motion) => {
      const label = builtInMotionLabels[motion]
      return label ? `- ${motion} (${label})` : `- ${motion}`
    }),
    'For ACT.motion:',
    '- Only use motion names from the list above.',
    '- Do not invent new motion names.',
    '- If none fit, omit the motion field.',
    '- The exact ACT.motion value must stay the motion id itself, for example `VRMA_03`, not the human-readable label.',
  ].join('\n')
}

export function buildFastLayerSystemPrompt(roleplayPrompt?: string, availableVrmMotions?: string[]) {
  const personaPrompt = roleplayPrompt?.trim()
  const availableVrmMotionsPrompt = buildAvailableVrmMotionsPrompt(availableVrmMotions)

  return [
    personaPrompt || 'You are the speaking front layer for AIRI.',
    availableVrmMotionsPrompt,
    'Reply in the same language as the user when practical.',
    'Keep the reply short and immediately speakable.',
    'If the user is asking for tool usage, filesystem inspection, coding work, or a longer background task, start the first line with [agent].',
    'If no background task is needed, do not use [agent].',
    'Do not explain the marker. Do not output any other tags or structured data.',
  ].filter(Boolean).join('\n\n')
}

async function streamFastLayer(
  req: IncomingMessage,
  res: ServerResponse,
) {
  const body = await readRequestJson<FastLayerRequest>(req)
  const message = body.message?.trim()

  if (!message) {
    writeJson(res, 400, { error: 'message is required' })
    return
  }

  const apiBase = process.env.STAGE_WEB_FAST_API_BASE || (await resolveLmStudioApiBase()).apiBase
  const model = process.env.STAGE_WEB_FAST_MODEL || DEFAULT_FAST_MODEL_ID
  const systemPrompt = buildFastLayerSystemPrompt(body.systemPrompt, body.availableVrmMotions)

  const upstream = await fetch(`${apiBase.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(process.env.STAGE_WEB_FAST_API_KEY ? { Authorization: `Bearer ${process.env.STAGE_WEB_FAST_API_KEY}` } : {}),
    },
    body: JSON.stringify({
      model,
      stream: true,
      temperature: DEFAULT_FAST_TEMPERATURE,
      messages: [
        {
          role: 'system',
          content: systemPrompt,
        },
        {
          role: 'user',
          content: message,
        },
      ],
    }),
  })

  if (!upstream.ok || !upstream.body) {
    writeJson(res, upstream.status || 500, {
      error: `Fast layer failed with HTTP ${upstream.status}`,
    })
    return
  }

  res.statusCode = 200
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders?.()

  const reader = upstream.body.getReader()
  const decoder = new TextDecoder()
  let pending = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done)
      break

    pending += decoder.decode(value, { stream: true })
    const blocks = pending.split('\n\n')
    pending = blocks.pop() ?? ''

    for (const block of blocks) {
      const lines = block.split('\n')
      for (const line of lines) {
        if (!line.startsWith('data:'))
          continue

        const payload = line.slice('data:'.length).trim()
        if (!payload || payload === '[DONE]')
          continue

        const chunk = JSON.parse(payload) as {
          choices?: Array<{
            delta?: { content?: string }
            finish_reason?: string | null
          }>
        }
        const delta = chunk.choices?.[0]?.delta?.content
        if (delta) {
          writeSse(res, 'text_delta', { text: delta, model })
        }
      }
    }
  }

  writeSse(res, 'done', { model })
  res.end()
}

function resolveWorkspaceAccess(config: PicoClawConfig) {
  const defaults = config.agents?.defaults ?? {}
  const explicitWorkspace = process.env.STAGE_WEB_PICOCLAW_WORKSPACE
  const fullAccess = process.env.STAGE_WEB_PICOCLAW_FULL_ACCESS === 'true'

  if (explicitWorkspace)
    defaults.workspace = explicitWorkspace

  if (fullAccess) {
    defaults.restrict_to_workspace = false
    defaults.allow_read_outside_workspace = true
  }

  config.agents ??= {}
  config.agents.defaults = defaults

  return {
    workspace: defaults.workspace,
    workspaceRestricted: defaults.restrict_to_workspace !== false,
  }
}

/**
 * Converts runtime/log lines into short user-facing narration updates.
 *
 * Use when:
 * - PicoClaw should expose progress without leaking raw logs into the spoken UI.
 * - The browser needs sparse, stable status text instead of tool-level traces.
 *
 * Expects:
 * - One parsed bridge event at a time.
 * - Throttling and dedupe handled by the caller with the returned text.
 *
 * Returns:
 * - A short visible status string, or `null` when the line is not narration-worthy.
 */
export function deriveVisibleStatus(
  event: { kind: 'runtime' | 'log', phase?: string, line: string },
): string | null {
  const line = event.line

  if (event.kind === 'runtime') {
    if (event.phase === 'start')
      return 'Starting to work on it.'

    if (line.includes('Processing message'))
      return 'I am looking through the request.'

    if (line.includes('Tool call: read_file') || line.includes('Tool call: list_dir'))
      return 'I am checking the relevant files.'

    if (line.includes('Tool call: exec'))
      return 'I am running a local check.'

    if (line.includes('Tool call: web_search'))
      return 'I am looking up the relevant information.'

    if (line.includes('Agent event: tool_start'))
      return 'I am working through the next step.'
  }

  if (event.kind === 'log') {
    if (line.includes('execution completed successfully') && line.includes('ReadFileTool'))
      return 'I found something useful.'

    if (line.includes('status: 429') || line.includes('"code":429') || line.includes('rate limit'))
      return 'The current model is rate-limited, trying a fallback.'

    if (line.includes('Tool execution failed') || line.includes('Error processing message'))
      return 'I hit a blocker and am checking another way.'
  }

  return null
}

async function fetchOpenRouterModelIds(apiBase: string, apiKey: string) {
  try {
    const response = await fetch(`${apiBase.replace(/\/$/, '')}/models`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      signal: AbortSignal.timeout(6000),
    })

    if (!response.ok)
      return []

    const payload = await response.json() as {
      data?: Array<{ id?: string }>
    }

    return payload.data?.map(item => item.id).filter((id): id is string => Boolean(id)) || []
  }
  catch {
    return []
  }
}

async function fetchOpenRouterRecommendation() {
  const recommendationUrl = process.env.STAGE_WEB_PICOCLAW_OPENROUTER_RECOMMENDATION_URL || DEFAULT_OPENROUTER_RECOMMENDATION_URL

  try {
    const response = await fetch(recommendationUrl, {
      method: 'GET',
      signal: AbortSignal.timeout(5000),
    })

    if (!response.ok)
      return null

    return await response.json() as {
      primary?: { id?: string }
      alternatives?: Array<{ id?: string }>
      fallback?: { id?: string }
      updatedAt?: string
    }
  }
  catch {
    return null
  }
}

function sanitizeModelName(model: string) {
  return model
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
}

function getPreferredOpenRouterModels() {
  const configuredModels = process.env.STAGE_WEB_PICOCLAW_OPENROUTER_PREFERRED_MODELS
  if (!configuredModels)
    return [...DEFAULT_OPENROUTER_PREFERRED_MODELS]

  return configuredModels
    .split(',')
    .map(item => item.trim())
    .filter(Boolean)
}

async function resolveOpenRouterModel(apiBase: string, apiKey: string) {
  const explicitModel = process.env.STAGE_WEB_PICOCLAW_OPENROUTER_MODEL
  if (explicitModel) {
    return {
      modelSelectedAutomatically: false,
      model: explicitModel,
      modelName: process.env.STAGE_WEB_PICOCLAW_OPENROUTER_MODEL_NAME || `airi-openrouter-${sanitizeModelName(explicitModel)}`,
    }
  }

  const availableModels = await fetchOpenRouterModelIds(apiBase, apiKey)
  const recommendation = await fetchOpenRouterRecommendation()
  const preferredModels = [
    recommendation?.primary?.id,
    ...(recommendation?.alternatives?.map(item => item.id) || []),
    ...getPreferredOpenRouterModels(),
    recommendation?.fallback?.id,
  ].filter((item): item is string => Boolean(item))
  const selectedModel = preferredModels.find(model => availableModels.includes(model)) || DEFAULT_OPENROUTER_MODEL_ID

  return {
    modelSelectedAutomatically: true,
    model: selectedModel,
    modelName: process.env.STAGE_WEB_PICOCLAW_OPENROUTER_MODEL_NAME || `airi-openrouter-${sanitizeModelName(selectedModel)}`,
  }
}

function resolveConfiguredDefaultModel(config: PicoClawConfig) {
  const configuredModelName = config.agents?.defaults?.model_name?.trim()
  if (!configuredModelName)
    return null

  const configuredModel = config.model_list?.find(item => item.model_name === configuredModelName)
  if (!configuredModel?.model)
    return null

  return {
    modelName: configuredModelName,
    model: configuredModel.model,
    apiBase: configuredModel.api_base,
  }
}

function isOpenRouterModel(model: string, apiBase?: string) {
  return model === DEFAULT_OPENROUTER_MODEL_ID
    || model.startsWith('openrouter/')
    || Boolean(apiBase?.includes('openrouter.ai'))
}

async function pathExists(path: string) {
  try {
    await access(path)
    return true
  }
  catch {
    return false
  }
}

async function directoryHasEntries(path: string) {
  try {
    const entries = await readdir(path)
    return entries.length > 0
  }
  catch {
    return false
  }
}

async function resolveProviderConfig(config: PicoClawConfig) {
  const explicitApiBase = process.env.STAGE_WEB_PICOCLAW_API_BASE
  const explicitModel = process.env.STAGE_WEB_PICOCLAW_MODEL
  const explicitModelName = process.env.STAGE_WEB_PICOCLAW_MODEL_NAME
  const explicitApiKey = process.env.STAGE_WEB_PICOCLAW_API_KEY
  const openRouterApiKey = process.env.STAGE_WEB_PICOCLAW_OPENROUTER_API_KEY || process.env.OPENROUTER_API_KEY

  if (explicitApiBase || explicitModel || explicitModelName || explicitApiKey) {
    return {
      providerKind: 'custom' as const,
      modelSelectedAutomatically: false,
      modelName: explicitModelName || DEFAULT_MODEL_NAME,
      model: explicitModel || DEFAULT_MODEL_ID,
      apiBase: explicitApiBase || DEFAULT_LM_STUDIO_BASE_URL,
      apiKey: explicitApiKey || 'lm-studio',
      reachable: await isApiReachable(explicitApiBase || DEFAULT_LM_STUDIO_BASE_URL, explicitApiKey),
    }
  }

  if (openRouterApiKey) {
    const apiBase = process.env.STAGE_WEB_PICOCLAW_OPENROUTER_API_BASE || DEFAULT_OPENROUTER_BASE_URL
    const configuredDefault = resolveConfiguredDefaultModel(config)
    if (configuredDefault && isOpenRouterModel(configuredDefault.model, configuredDefault.apiBase)) {
      return {
        providerKind: 'openrouter' as const,
        modelSelectedAutomatically: false,
        modelName: configuredDefault.modelName,
        model: configuredDefault.model,
        apiBase: configuredDefault.apiBase || apiBase,
        apiKey: openRouterApiKey,
        reachable: await isApiReachable(configuredDefault.apiBase || apiBase, openRouterApiKey),
      }
    }

    const { modelSelectedAutomatically, model, modelName } = await resolveOpenRouterModel(apiBase, openRouterApiKey)

    return {
      providerKind: 'openrouter' as const,
      modelSelectedAutomatically,
      modelName,
      model,
      apiBase,
      apiKey: openRouterApiKey,
      reachable: await isApiReachable(apiBase, openRouterApiKey),
    }
  }

  const { apiBase, reachable } = await resolveLmStudioApiBase()

  return {
    providerKind: 'lmstudio' as const,
    modelSelectedAutomatically: false,
    modelName: DEFAULT_MODEL_NAME,
    model: DEFAULT_MODEL_ID,
    apiBase,
    apiKey: 'lm-studio',
    reachable,
  }
}

async function normalizeConfig(config: PicoClawConfig): Promise<RuntimeConfigResult> {
  config.agents ??= {}
  config.agents.defaults ??= {}
  config.model_list ??= []

  const runnerKind = useDockerRunner() ? 'docker' as const : 'host' as const
  const { providerKind, modelSelectedAutomatically, modelName, model, apiBase, apiKey, reachable } = await resolveProviderConfig(config)
  const existingModel = config.model_list.find(item => item.model_name === modelName)
  const { workspace, workspaceRestricted } = resolveWorkspaceAccess(config)

  const modelConfig = {
    model_name: modelName,
    model,
    api_base: apiBase,
    api_keys: [apiKey],
  }

  if (existingModel) {
    Object.assign(existingModel, modelConfig)
  }
  else {
    config.model_list.push(modelConfig)
  }

  config.agents.defaults.model_name = modelName

  return {
    config,
    runnerKind,
    persistentContainer: runnerKind === 'docker' && usePersistentDockerRunner(),
    providerKind,
    modelSelectedAutomatically,
    modelName,
    model,
    apiBase,
    apiReachable: reachable,
    workspace,
    workspaceRestricted,
  }
}

async function createRuntimeConfig() {
  const dockerRuntimeConfigPath = join(resolveDockerRuntimeHome(), 'config.json')
  const sourcePath = process.env.STAGE_WEB_PICOCLAW_CONFIG
    || (useDockerRunner() && await pathExists(dockerRuntimeConfigPath) ? dockerRuntimeConfigPath : DEFAULT_PICOCLAW_CONFIG)
  const rawConfig = await readFile(sourcePath, 'utf8')
  const parsed = JSON.parse(rawConfig) as PicoClawConfig
  const normalized = await normalizeConfig(parsed)

  if (normalized.runnerKind === 'docker') {
    const runtimeHome = resolveDockerRuntimeHome()
    const sourceWorkspace = parsed.agents?.defaults?.workspace
    const runtimeWorkspace = join(runtimeHome, 'workspace')

    normalized.config.agents ??= {}
    normalized.config.agents.defaults ??= {}
    normalized.config.agents.defaults.workspace = CONTAINER_WORKSPACE

    await mkdir(runtimeWorkspace, { recursive: true })

    if (sourceWorkspace && await pathExists(sourceWorkspace) && !await directoryHasEntries(runtimeWorkspace)) {
      await cp(sourceWorkspace, runtimeWorkspace, {
        recursive: true,
        force: false,
        errorOnExist: false,
      })
    }

    const configPath = join(runtimeHome, 'config.json')
    await writeFile(configPath, JSON.stringify(normalized.config, null, 2))

    return {
      ...normalized,
      configPath,
      runtimeHome,
      containerName: process.env.STAGE_WEB_PICOCLAW_DOCKER_CONTAINER_NAME || DEFAULT_DOCKER_CONTAINER_NAME,
      sourcePath,
      workspace: CONTAINER_WORKSPACE,
    }
  }

  const dir = await mkdtemp(join(tmpdir(), 'airi-picoclaw-'))
  const configPath = join(dir, 'config.json')
  await writeFile(configPath, JSON.stringify(normalized.config, null, 2))

  return {
    ...normalized,
    configPath,
    sourcePath,
  }
}

function getDockerPortMappings() {
  const configuredPorts = process.env.STAGE_WEB_PICOCLAW_DOCKER_PORTS
  if (!configuredPorts)
    return [...DEFAULT_DOCKER_PORTS]

  return configuredPorts
    .split(',')
    .map(item => item.trim())
    .filter(Boolean)
}

function runDockerCommand(args: string[]) {
  return new Promise<{ code: number | null, stdout: string, stderr: string }>((resolve) => {
    const child = spawn('docker', args, {
      cwd: resolveRepoRoot(),
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8')
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8')
    })
    child.on('close', code => resolve({ code, stdout: stdout.trim(), stderr: stderr.trim() }))
    child.on('error', error => resolve({ code: -1, stdout, stderr: error.message }))
  })
}

async function inspectDockerContainer(name: string) {
  const result = await runDockerCommand(['inspect', '-f', '{{.State.Running}}', name])
  if (result.code !== 0)
    return { exists: false, running: false }

  return {
    exists: true,
    running: result.stdout.trim() === 'true',
  }
}

async function ensurePersistentDockerContainer(runtimeConfig: Awaited<ReturnType<typeof createRuntimeConfig>>, dockerImage: string) {
  if (!runtimeConfig.runtimeHome || !runtimeConfig.containerName)
    throw new Error('Docker runtime home or container name is missing.')

  const inspect = await inspectDockerContainer(runtimeConfig.containerName)
  if (inspect.running)
    return

  if (inspect.exists) {
    const started = await runDockerCommand(['start', runtimeConfig.containerName])
    if (started.code !== 0)
      throw new Error(started.stderr || `Failed to start Docker container ${runtimeConfig.containerName}.`)
    return
  }

  const portArgs = getDockerPortMappings().flatMap(port => ['-p', port])
  const created = await runDockerCommand([
    'run',
    '-d',
    '--name',
    runtimeConfig.containerName,
    '-v',
    `${runtimeConfig.runtimeHome}:${CONTAINER_PICOCLAW_HOME}`,
    ...portArgs,
    '--entrypoint',
    'sh',
    dockerImage,
    '-lc',
    'trap "exit 0" TERM INT; while :; do sleep 3600; done',
  ])

  if (created.code !== 0)
    throw new Error(created.stderr || `Failed to create Docker container ${runtimeConfig.containerName}.`)
}

function parseRuntimeLine(line: string) {
  const clean = stripAnsi(line).trim()
  if (!clean)
    return null

  if (clean.startsWith('🦞 '))
    return { kind: 'final' as const, text: clean.replace(/^🦞\s*/, '') }

  if (clean.includes('████') || clean.includes('██╔') || clean.includes('██║') || clean.includes('╚═╝') || clean === '🔍 Debug mode enabled')
    return null

  if (clean.includes('Registered core tool name='))
    return null

  const eventMatch = clean.match(/Agent event: ([a-z_]+)/)
  if (eventMatch) {
    return {
      kind: 'runtime' as const,
      phase: eventMatch[1],
      line: clean,
    }
  }

  if (clean.includes('Tool call:') || clean.includes('tool_calls=') || clean.includes('LLM request') || clean.includes('LLM response'))
    return { kind: 'runtime' as const, phase: 'trace', line: clean }

  if (clean.includes('Agent initialized') || clean.includes('Processing message') || clean.includes('Routed message') || clean.includes('System prompt built'))
    return { kind: 'runtime' as const, phase: 'trace', line: clean }

  if (clean.includes('DBG ') || clean.includes('INF ') || clean.includes('WRN ') || clean.includes('ERR '))
    return { kind: 'log' as const, line: clean }

  return null
}

function streamProcessLines(
  chunk: Buffer,
  state: { pending: string },
  onLine: (line: string) => void,
) {
  state.pending += chunk.toString('utf8')
  const lines = state.pending.split(/\r?\n/)
  state.pending = lines.pop() ?? ''

  for (const line of lines)
    onLine(line)
}

function shouldRetryWithOpenRouterFree(runtimeConfig: Awaited<ReturnType<typeof createRuntimeConfig>>, output: string) {
  if (runtimeConfig.providerKind !== 'openrouter')
    return false
  if (!runtimeConfig.modelSelectedAutomatically)
    return false
  if (runtimeConfig.model === DEFAULT_OPENROUTER_MODEL_ID)
    return false

  const normalizedOutput = output.toLowerCase()
  return normalizedOutput.includes('status: 429')
    || normalizedOutput.includes('"code":429')
    || normalizedOutput.includes('temporarily rate-limit')
    || normalizedOutput.includes('provider returned error')
    || normalizedOutput.includes('rate limit')
}

function isRuntimeStatusFinal(text: string) {
  return text.startsWith(TOOL_LIMIT_RESPONSE_PREFIX)
    || text.startsWith(PROCESSING_ERROR_PREFIX)
}

async function createFallbackRuntimeConfig(sourcePath: string, runtimeConfig: Awaited<ReturnType<typeof createRuntimeConfig>>) {
  const rawConfig = await readFile(sourcePath, 'utf8')
  const parsed = JSON.parse(rawConfig) as PicoClawConfig
  parsed.agents ??= {}
  parsed.agents.defaults ??= {}
  parsed.model_list ??= []

  const fallbackModelName = 'airi-openrouter-free-fallback'
  const apiKey = process.env.STAGE_WEB_PICOCLAW_OPENROUTER_API_KEY || process.env.OPENROUTER_API_KEY

  const existingModel = parsed.model_list.find(item => item.model_name === fallbackModelName)
  const fallbackModel = {
    model_name: fallbackModelName,
    model: DEFAULT_OPENROUTER_MODEL_ID,
    api_base: runtimeConfig.apiBase,
    api_keys: [apiKey || ''],
  }

  if (existingModel) {
    Object.assign(existingModel, fallbackModel)
  }
  else {
    parsed.model_list.push(fallbackModel)
  }

  parsed.agents.defaults.model_name = fallbackModelName

  if (runtimeConfig.runnerKind === 'docker') {
    const configPath = join(runtimeConfig.runtimeHome!, 'config.json')
    await writeFile(configPath, JSON.stringify(parsed, null, 2))
    return {
      ...runtimeConfig,
      config: parsed,
      modelSelectedAutomatically: false,
      modelName: fallbackModelName,
      model: DEFAULT_OPENROUTER_MODEL_ID,
      configPath,
    }
  }

  const dir = await mkdtemp(join(tmpdir(), 'airi-picoclaw-fallback-'))
  const configPath = join(dir, 'config.json')
  await writeFile(configPath, JSON.stringify(parsed, null, 2))
  return {
    ...runtimeConfig,
    config: parsed,
    modelSelectedAutomatically: false,
    modelName: fallbackModelName,
    model: DEFAULT_OPENROUTER_MODEL_ID,
    configPath,
  }
}

function spawnAgentProcess(
  runtimeConfig: Awaited<ReturnType<typeof createRuntimeConfig>>,
  dockerImage: string,
  args: string[],
) {
  if (runtimeConfig.runnerKind === 'docker') {
    return spawn('docker', runtimeConfig.persistentContainer
      ? [
          'exec',
          '-i',
          runtimeConfig.containerName!,
          'picoclaw',
          ...args,
        ]
      : [
          'run',
          '--rm',
          '-i',
          '-v',
          `${runtimeConfig.runtimeHome}:${CONTAINER_PICOCLAW_HOME}`,
          '--entrypoint',
          'picoclaw',
          dockerImage,
          ...args,
        ], {
      cwd: resolveRepoRoot(),
      env: {
        ...process.env,
        NO_COLOR: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  }

  return spawn(process.env.STAGE_WEB_PICOCLAW_BIN || DEFAULT_PICOCLAW_BIN, args, {
    cwd: resolveRepoRoot(),
    env: {
      ...process.env,
      PICOCLAW_CONFIG: runtimeConfig.configPath,
      NO_COLOR: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

async function handleAgent(req: IncomingMessage, res: ServerResponse) {
  const body = await readRequestJson<PicoClawAgentRequest>(req)
  const message = body.message?.trim()

  if (!message) {
    writeJson(res, 400, { error: 'message is required' })
    return
  }

  const runtimeConfig = await createRuntimeConfig()
  const picoclawBin = process.env.STAGE_WEB_PICOCLAW_BIN || DEFAULT_PICOCLAW_BIN
  const dockerImage = process.env.STAGE_WEB_PICOCLAW_DOCKER_IMAGE || DEFAULT_DOCKER_IMAGE
  const session = body.session || process.env.STAGE_WEB_PICOCLAW_SESSION || DEFAULT_SESSION
  const debug = body.debug ?? process.env.STAGE_WEB_PICOCLAW_DEBUG !== 'false'
  const args = ['agent', '--message', message, '--model', runtimeConfig.modelName, '--session', session]
  const traceId = createBridgeTraceId()
  let traceSeq = 0
  const trace = (event: string, data: Record<string, unknown>) => {
    traceSeq += 1
    void writeBridgeTrace(traceId, event, { seq: traceSeq, ...data }).catch((error) => {
      console.warn('[picoclaw-bridge] trace write failed', error)
    })
  }
  const emitSse = (event: string, data: Record<string, unknown>) => {
    trace('sse_emit', { sseEvent: event, data })
    writeSse(res, event, data)
  }
  const visibleStatusState: VisibleStatusState = {
    lastStatus: '',
    lastStatusAt: 0,
  }
  const emitVisibleStatus = (text: string) => {
    const now = Date.now()
    if (!text.trim())
      return
    if (visibleStatusState.lastStatus === text)
      return
    if (now - visibleStatusState.lastStatusAt < VISIBLE_STATUS_MIN_INTERVAL_MS)
      return

    visibleStatusState.lastStatus = text
    visibleStatusState.lastStatusAt = now
    emitSse('visible_status', { text, traceId })
  }
  if (debug)
    args.splice(1, 0, '--debug')

  res.statusCode = 200
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders?.()

  trace('turn_start', {
    session,
    debug,
    messageLength: message.length,
    messagePreview: message.slice(0, 240),
    runnerKind: runtimeConfig.runnerKind,
    persistentContainer: runtimeConfig.persistentContainer,
    containerName: runtimeConfig.containerName,
    dockerImage: runtimeConfig.runnerKind === 'docker' ? dockerImage : undefined,
    providerKind: runtimeConfig.providerKind,
    modelSelectedAutomatically: runtimeConfig.modelSelectedAutomatically,
    modelName: runtimeConfig.modelName,
    model: runtimeConfig.model,
    apiBase: runtimeConfig.apiBase,
    apiReachable: runtimeConfig.apiReachable,
    configSource: runtimeConfig.sourcePath,
  })

  emitSse('runtime', {
    phase: 'start',
    line: `${runtimeConfig.runnerKind === 'docker'
      ? `Starting PicoClaw in Docker${runtimeConfig.persistentContainer ? ' (persistent)' : ''}: ${dockerImage} agent --message <redacted> --model ${runtimeConfig.modelName} --session ${session}`
      : `Starting PicoClaw: ${picoclawBin} agent --message <redacted> --model ${runtimeConfig.modelName} --session ${session}`} Trace: ${traceId}`,
    model: runtimeConfig.model,
    apiBase: runtimeConfig.apiBase,
    configSource: runtimeConfig.sourcePath,
    traceId,
  })
  emitVisibleStatus('Starting to work on it.')

  if (runtimeConfig.runnerKind === 'docker' && runtimeConfig.persistentContainer)
    await ensurePersistentDockerContainer(runtimeConfig, dockerImage)

  let child = spawnAgentProcess(runtimeConfig, dockerImage, args)

  let finalText = ''
  let runtimeStatusText = ''
  let suppressPromptDump = false
  const stdoutState = { pending: '' }
  const stderrState = { pending: '' }
  let combinedOutput = ''
  let retriedWithFallback = false
  const onLine = (source: 'stdout' | 'stderr', line: string) => {
    combinedOutput += `${line}\n`
    const clean = stripAnsi(line).trim()
    if (clean.includes('System prompt preview preview=')) {
      suppressPromptDump = true
      return
    }
    if (suppressPromptDump) {
      if (!clean.includes('LLM iteration') && !clean.includes('Agent event:') && !clean.startsWith('🦞 '))
        return

      suppressPromptDump = false
    }

    const parsed = parseRuntimeLine(line)
    if (!parsed)
      return

    if (parsed.kind === 'final') {
      finalText = parsed.text
      trace('cli_final_candidate', {
        source,
        text: finalText,
        classifiedAsRuntimeStatus: isRuntimeStatusFinal(finalText),
      })
      return
    }

    trace('cli_event', {
      source,
      kind: parsed.kind,
      phase: parsed.kind === 'runtime' ? parsed.phase : undefined,
      line: parsed.line,
    })

    emitSse(parsed.kind, {
      source,
      phase: parsed.kind === 'runtime' ? parsed.phase : undefined,
      line: parsed.line,
    })

    const visibleStatus = deriveVisibleStatus(parsed)
    if (visibleStatus)
      emitVisibleStatus(visibleStatus)
  }

  child.stdout.on('data', chunk => streamProcessLines(chunk, stdoutState, line => onLine('stdout', line)))
  child.stderr.on('data', chunk => streamProcessLines(chunk, stderrState, line => onLine('stderr', line)))
  child.on('error', (error) => {
    trace('process_error', { message: error.message })
    emitVisibleStatus('The run failed before it could finish.')
    emitSse('error', { message: error.message, traceId })
    res.end()
  })
  child.on('close', (code, signal) => {
    if (stdoutState.pending)
      onLine('stdout', stdoutState.pending)
    if (stderrState.pending)
      onLine('stderr', stderrState.pending)

    const retrySignal = `${combinedOutput}\n${finalText}`
    const retryWithFallback = !retriedWithFallback && shouldRetryWithOpenRouterFree(runtimeConfig, retrySignal)
    trace('primary_close', {
      code,
      signal,
      finalText,
      finalTextIsRuntimeStatus: Boolean(finalText && isRuntimeStatusFinal(finalText)),
      combinedOutputTail: combinedOutput.slice(-4000),
      retryWithFallback,
      retryBlockedReason: retryWithFallback
        ? undefined
        : runtimeConfig.providerKind !== 'openrouter'
          ? 'provider_not_openrouter'
          : runtimeConfig.modelSelectedAutomatically
            ? runtimeConfig.model === DEFAULT_OPENROUTER_MODEL_ID ? 'already_default_openrouter_free' : 'no_rate_limit_signal_or_already_retried'
            : 'model_not_auto_selected_by_bridge',
    })

    if (retryWithFallback) {
      retriedWithFallback = true
      finalText = ''
      void (async () => {
        const fallbackRuntimeConfig = await createFallbackRuntimeConfig(runtimeConfig.sourcePath, runtimeConfig)
        const fallbackArgs = ['agent', '--message', message, '--model', fallbackRuntimeConfig.modelName, '--session', session]
        if (debug)
          fallbackArgs.splice(1, 0, '--debug')

        trace('fallback_start', {
          fromModelName: runtimeConfig.modelName,
          fromModel: runtimeConfig.model,
          fallbackModelName: fallbackRuntimeConfig.modelName,
          fallbackModel: fallbackRuntimeConfig.model,
        })

        emitSse('runtime', {
          phase: 'fallback',
          line: `Primary OpenRouter model rate-limited. Retrying with ${DEFAULT_OPENROUTER_MODEL_ID}.`,
          model: fallbackRuntimeConfig.model,
          apiBase: fallbackRuntimeConfig.apiBase,
        })
        emitVisibleStatus('The primary model is busy, retrying with a fallback.')

        child = spawnAgentProcess(fallbackRuntimeConfig, dockerImage, fallbackArgs)
        child.stdout.on('data', chunk => streamProcessLines(chunk, stdoutState, line => onLine('stdout', line)))
        child.stderr.on('data', chunk => streamProcessLines(chunk, stderrState, line => onLine('stderr', line)))
        child.on('error', (error) => {
          trace('fallback_process_error', { message: error.message })
          emitVisibleStatus('The fallback run failed before it could finish.')
          emitSse('error', { message: error.message, traceId })
          res.end()
        })
        child.on('close', (fallbackCode, fallbackSignal) => {
          if (stdoutState.pending)
            onLine('stdout', stdoutState.pending)
          if (stderrState.pending)
            onLine('stderr', stderrState.pending)

          if (finalText && isRuntimeStatusFinal(finalText)) {
            runtimeStatusText = finalText
            finalText = ''
          }

          trace('fallback_close', {
            code: fallbackCode,
            signal: fallbackSignal,
            finalText,
            runtimeStatusText,
            combinedOutputTail: combinedOutput.slice(-4000),
          })

          if (runtimeStatusText) {
            emitVisibleStatus('The task stopped on a runtime issue.')
            emitSse('runtime_status', { text: runtimeStatusText, traceId })
          }
          else if (finalText) {
            emitVisibleStatus('I have the result ready.')
            emitSse('assistant_final', { text: finalText, traceId })
          }
          emitSse('done', { code: fallbackCode, signal: fallbackSignal, finalText, runtimeStatus: runtimeStatusText, traceId })
          res.end()
        })
      })().catch((error) => {
        const message = error instanceof Error ? error.message : String(error)
        trace('fallback_setup_error', { message })
        emitVisibleStatus('The fallback could not be started.')
        emitSse('error', { message, traceId })
        emitSse('done', { code, signal, finalText, runtimeStatus: runtimeStatusText, traceId })
        res.end()
      })
      return
    }

    if (finalText && isRuntimeStatusFinal(finalText)) {
      runtimeStatusText = finalText
      finalText = ''
    }

    trace('turn_close', {
      code,
      signal,
      finalText,
      runtimeStatusText,
      combinedOutputTail: combinedOutput.slice(-4000),
    })

    if (runtimeStatusText) {
      emitVisibleStatus('The task stopped on a runtime issue.')
      emitSse('runtime_status', { text: runtimeStatusText, traceId })
    }
    else if (finalText) {
      emitVisibleStatus('I have the result ready.')
      emitSse('assistant_final', { text: finalText, traceId })
    }
    emitSse('done', { code, signal, finalText, runtimeStatus: runtimeStatusText, traceId })
    res.end()
  })

  req.on('close', () => {
    trace('request_close', { childKilled: child.killed })
    if (!child.killed)
      child.kill('SIGTERM')
  })
}

/**
 * Adds a dev-only PicoClaw bridge to stage-web.
 *
 * Use when:
 * - The browser needs to talk to the real local PicoClaw CLI.
 * - We need stdout/stderr runtime traces without exposing shell execution in browser code.
 *
 * Expects:
 * - Vite dev server runtime; this is not bundled into production.
 * - Local PicoClaw binary and `~/.picoclaw/config.json` exist.
 *
 * Returns:
 * - A Vite plugin that registers `/api/picoclaw/status` and `/api/picoclaw/agent`.
 */
export function PicoClawDevBridge(): Plugin {
  return {
    name: 'stage-web-picoclaw-dev-bridge',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/api/picoclaw/fast', async (req, res) => {
        if (req.method !== 'POST') {
          writeJson(res, 405, { error: 'POST required' })
          return
        }

        try {
          await streamFastLayer(req, res)
        }
        catch (error) {
          if (!res.headersSent) {
            writeJson(res, 500, {
              error: error instanceof Error ? error.message : String(error),
            })
            return
          }

          writeSse(res, 'error', {
            message: error instanceof Error ? error.message : String(error),
          })
          res.end()
        }
      })

      server.middlewares.use('/api/picoclaw/status', async (_req, res) => {
        try {
          const runtimeConfig = await createRuntimeConfig()
          const dockerContainerState = runtimeConfig.runnerKind === 'docker' && runtimeConfig.containerName
            ? await inspectDockerContainer(runtimeConfig.containerName)
            : null
          writeJson(res, 200, {
            ok: true,
            binary: process.env.STAGE_WEB_PICOCLAW_BIN || DEFAULT_PICOCLAW_BIN,
            configSource: runtimeConfig.sourcePath,
            runnerKind: runtimeConfig.runnerKind,
            persistentContainer: runtimeConfig.persistentContainer,
            containerName: runtimeConfig.containerName,
            containerRunning: dockerContainerState?.running,
            dockerImage: runtimeConfig.runnerKind === 'docker' ? (process.env.STAGE_WEB_PICOCLAW_DOCKER_IMAGE || DEFAULT_DOCKER_IMAGE) : undefined,
            traceDir: resolveBridgeTraceDir(),
            providerKind: runtimeConfig.providerKind,
            modelName: runtimeConfig.modelName,
            model: runtimeConfig.model,
            apiBase: runtimeConfig.apiBase,
            apiReachable: runtimeConfig.apiReachable,
            fullAccess: !runtimeConfig.workspaceRestricted,
            workspace: runtimeConfig.workspace,
            workspaceRestricted: runtimeConfig.workspaceRestricted,
          })
        }
        catch (error) {
          writeJson(res, 500, {
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          })
        }
      })

      server.middlewares.use('/api/picoclaw/agent', async (req, res) => {
        if (req.method !== 'POST') {
          writeJson(res, 405, { error: 'POST required' })
          return
        }

        try {
          await handleAgent(req, res)
        }
        catch (error) {
          if (!res.headersSent) {
            writeJson(res, 500, {
              error: error instanceof Error ? error.message : String(error),
            })
            return
          }

          writeSse(res, 'error', {
            message: error instanceof Error ? error.message : String(error),
          })
          res.end()
        }
      })
    },
  }
}
