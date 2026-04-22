<h1 align="center">アイリ VTuber</h1>

<p align="center">
  [<a href="https://airi.ayaka.io">Try it</a>]
</p>

> Heavily inspired by [Neuro-sama](https://www.youtube.com/@Neurosama)

## Local Test Surface

For the lightweight avatar-first prototype discussed in this workspace, open:

- `/pico-avatar`

Architecture and operational notes live in [`../../docs/picoclaw-avatar-bridge.md`](../../docs/picoclaw-avatar-bridge.md).

For the local all-in-one container wrapper, see `../../docker/pico-avatar-allinone/docker-compose.yml`.

That route is wired for:

- chat through the real PicoClaw CLI bridged by Vite
- default local backend `LM Studio` at `http://127.0.0.1:1234/v1/`
- default model `google/gemma-4-26b-a4b`
- final-answer-only speech playback
- local `Kokoro` TTS for voice output

Bridge runtime switches:

- `OPENROUTER_API_KEY` or `STAGE_WEB_PICOCLAW_OPENROUTER_API_KEY`: switch PicoClaw to OpenRouter
- default OpenRouter choice follows the live recommendation API and currently resolves to `openrouter/elephant-alpha`; if the live pick is unavailable it falls back through nearby free models before `openrouter/free`
- `STAGE_WEB_PICOCLAW_OPENROUTER_MODEL`: override the OpenRouter model directly
- `STAGE_WEB_PICOCLAW_OPENROUTER_PREFERRED_MODELS`: comma-separated preference order when auto-picking a free OpenRouter model
- `STAGE_WEB_PICOCLAW_USE_DOCKER=true`: run PicoClaw inside `docker.io/sipeed/picoclaw:latest`
- `STAGE_WEB_PICOCLAW_DOCKER_PERSISTENT=true`: keep a long-lived container and run requests via `docker exec`
- `STAGE_WEB_PICOCLAW_FULL_ACCESS=true`: disable PicoClaw workspace restriction for the bridged agent
- `STAGE_WEB_PICOCLAW_WORKSPACE=/path`: override the PicoClaw workspace root used by the bridged agent
