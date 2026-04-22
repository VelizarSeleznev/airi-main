#!/bin/bash
set -eu

AIRI_DIR="${AIRI_DIR:-/workspace/airi-main}"
PICOCLAW_HOME="${PICOCLAW_HOME:-/root/.picoclaw}"
DEFAULTS_DIR="/opt/pico-avatar/defaults"
CONFIG_PATH="${PICOCLAW_HOME}/config.json"
WORKSPACE_DIR="${PICOCLAW_HOME}/workspace"
STORE_DIR="/root/.local/share/pnpm/store"

mkdir -p "${PICOCLAW_HOME}" "${WORKSPACE_DIR}" "${STORE_DIR}"

if [ ! -f "${CONFIG_PATH}" ]; then
  cp "${DEFAULTS_DIR}/config.template.json" "${CONFIG_PATH}"
fi

for file in AGENT.md USER.md SOUL.md HEARTBEAT.md; do
  if [ ! -f "${WORKSPACE_DIR}/${file}" ]; then
    cp "${DEFAULTS_DIR}/workspace/${file}" "${WORKSPACE_DIR}/${file}"
  fi
done

node <<'EOF'
const fs = require('node:fs')

const configPath = process.env.PICOCLAW_HOME
  ? `${process.env.PICOCLAW_HOME}/config.json`
  : '/root/.picoclaw/config.json'
const apiKey = process.env.OPENROUTER_API_KEY || ''

const config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
for (const model of config.model_list || []) {
  if (typeof model.api_base === 'string' && model.api_base.includes('openrouter.ai'))
    model.api_keys = apiKey ? [apiKey] : []
}

if (apiKey && config.agents?.defaults)
  config.agents.defaults.model_name = 'airi-openrouter-openrouter-elephant-alpha'

fs.writeFileSync(configPath, JSON.stringify(config, null, 2))
EOF

cd "${AIRI_DIR}"

export PICOCLAW_GATEWAY_HOST="${PICOCLAW_GATEWAY_HOST:-0.0.0.0}"
export PYTHON="${PYTHON:-/usr/bin/python3}"
export npm_config_python="${npm_config_python:-/usr/bin/python3}"
export STAGE_WEB_PICOCLAW_RUNNER="${STAGE_WEB_PICOCLAW_RUNNER:-host}"
export STAGE_WEB_PICOCLAW_BIN="${STAGE_WEB_PICOCLAW_BIN:-/usr/local/bin/picoclaw}"
export STAGE_WEB_PICOCLAW_CONFIG="${STAGE_WEB_PICOCLAW_CONFIG:-${CONFIG_PATH}}"
export STAGE_WEB_PICOCLAW_FULL_ACCESS="${STAGE_WEB_PICOCLAW_FULL_ACCESS:-true}"
export STAGE_WEB_PICOCLAW_TRACE_DIR="${STAGE_WEB_PICOCLAW_TRACE_DIR:-${PICOCLAW_HOME}/bridge-traces}"

picoclaw-launcher -console -public -no-browser &
LAUNCHER_PID=$!

cleanup() {
  kill "${LAUNCHER_PID}" 2>/dev/null || true
}

trap cleanup INT TERM EXIT

pnpm install --frozen-lockfile

cd "${AIRI_DIR}/apps/stage-web"
pnpm exec vite --host 0.0.0.0 --port "${AIRI_PORT:-5174}" --strictPort &
VITE_PID=$!

wait -n "${LAUNCHER_PID}" "${VITE_PID}"
STATUS=$?
kill "${LAUNCHER_PID}" "${VITE_PID}" 2>/dev/null || true
wait "${LAUNCHER_PID}" 2>/dev/null || true
wait "${VITE_PID}" 2>/dev/null || true
exit "${STATUS}"
