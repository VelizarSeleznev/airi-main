# Inworld TTS Demo Notes

This repo includes a demo-only Inworld TTS adapter for the settings UI.

## Status

- The integration is partial.
- The browser path is not production-safe because it uses a Basic API key on the client.
- The implementation currently targets the synchronous `POST /tts/v1/voice` endpoint.
- Voice discovery uses `GET /voices/v1/voices?languages=EN_US` and falls back to a small static list if that call fails.

## Why this is marked unsafe

- The key can be exposed in browser devtools, logs, or network inspection.
- The demo does not add a backend proxy or JWT token exchange.
- Streaming, timestamps, and other advanced Inworld TTS options are not wired into the current UI.

## Official API references

- [Synthesize speech](https://docs.inworld.ai/api-reference/ttsAPI/texttospeech)
- [Synthesize speech (stream)](https://docs.inworld.ai/api-reference/ttsAPI/texttospeech/synthesize-speech-stream)
- [List voices](https://docs.inworld.ai/api-reference/voiceAPI/voiceservice/list-voices)
- [Authentication](https://dev.docs.inworld.ai/tts/resources/authentication)
