# AIRI + PicoClaw All-In-One

This wrapper runs:

- AIRI `stage-web` on `5174`
- PicoClaw launcher on `18800`
- PicoClaw gateway/backend on `18790`

inside one Docker container.

## Why

- one runtime instead of a host `vite` process plus separate PicoClaw containers
- PicoClaw can inspect and edit AIRI code directly through `/workspace/airi-main`
- simpler handoff and redeploy

## Start

```bash
cd /Users/velizard/airi-main/docker/pico-avatar-allinone
docker compose --env-file /Users/velizard/.config/pico-avatar/openrouter.env up --build -d
```

## Stop

```bash
cd /Users/velizard/airi-main/docker/pico-avatar-allinone
docker compose down
```

## Important Paths

- Compose: `/Users/velizard/airi-main/docker/pico-avatar-allinone/docker-compose.yml`
- Entrypoint: `/Users/velizard/airi-main/docker/pico-avatar-allinone/entrypoint.sh`
- Default PicoClaw config template: `/Users/velizard/airi-main/docker/pico-avatar-allinone/defaults/config.template.json`
- Default workspace prompts: `/Users/velizard/airi-main/docker/pico-avatar-allinone/defaults/workspace`

## Important Notes

- Do not touch `5173`.
- First boot may be slow because Linux `node_modules` are installed inside the container.
- The image includes Python and Alpine native build dependencies so `node-gyp` and `canvas` can compile inside the container instead of relying on host binaries.
- PicoClaw state persists in Docker volumes, not in the AIRI repo.
