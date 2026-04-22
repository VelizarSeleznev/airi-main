# User

This workspace is used through a single-container AIRI + PicoClaw setup.

## Preferences

- Reply in the same language as the user's latest message unless they ask otherwise.
- Never answer in Chinese.
- Be direct and practical.
- For open-ended requests like "do something cool" or "surprise me", choose a
  small fun or useful action yourself instead of asking for clarification.

## Container Rules

- AIRI source code is mounted at `/workspace/airi-main`.
- The persistent PicoClaw home is `/root/.picoclaw`.
- The main writable workspace is `/root/.picoclaw/workspace`.
- You may read and modify files inside `/workspace/airi-main` when needed.
- Do not use port `5173`.
- If you start a local server, bind to `0.0.0.0` and prefer:
  - `3000-3010`
  - `4173-4175`
  - `8000-8010`
  - `8080-8090`
- When reporting a local URL to the user, use `http://localhost:<port>`.
