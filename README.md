# StudySummarize

A frontend-only AI summary maker for students, now with a production-ready backend API.

## Features
- Paste notes and summarize
- Summary length & format options
- Copy and download summary
- Modern UI (desktop-first)
- Express backend with provider system (mock + OpenAI)
- Writer Studio tab (Essay, Outline, Flashcards, Email, more) with tone/level/length controls, copy/download/save/share, and run history
- Visuals workspace that generates images from prompts, surfaces provider status, and makes download/copy/history available

## Writer Studio
The new Writer Studio workspace sits alongside the summary, exam, and visual tabs. Pick one of the nine modes (Essay, Outline, Paraphrase, Expand, Shorten, Explain, Flashcards, Email, Cover Letter, or Notes-to-Study-Guide), set a tone/level/length/citation style, and generate a tightly formatted response. Outputs surface in the right-hand column with copy, download (`.txt`/`.md`), save, and share buttons, plus a history of recent runs to reopen.

Example generate request:

```bash
curl -X POST http://localhost:3000/api/writer/generate \
  -H "Content-Type: application/json" \
  -d '{
    "mode": "essay",
    "tone": "neutral",
    "length": "medium",
    "level": "bachelor",
    "text": "Explain how photosynthesis captures light energy and converts it into chemical energy."
  }'
```

Example refine request:

```bash
curl -X POST http://localhost:3000/api/writer/refine \
  -H "Content-Type: application/json" \
  -d '{
    "runId": "PUT_RUN_ID_HERE",
    "mode": "essay",
    "instruction": "clarity",
    "tone": "academic",
    "length": "long"
  }'
```

## Tech
- HTML
- CSS
- JavaScript
- Node.js + Express

## Backend setup

```bash
npm install
npm run dev
```

The API runs on `http://localhost:3000` by default.

### Windows PowerShell

Use two PowerShell tabs so the server and your tests stay separate:

- **Terminal 1:** `npm run dev` (or `npm start`) launches the API.
- **Terminal 2:** `Invoke-RestMethod http://localhost:3000/health` verifies endpoints.
- Run `Test-NetConnection localhost -Port 3000` (equivalently `Test-NetConnection localhost:3000`) to confirm the port is listening.

### Environment variables

Copy `.env.example` to `.env` and update values as needed:

- `PORT=3000`
- `SUMMARIZER_PROVIDER=mock` or `openai`
- `WRITER_PROVIDER=mock` (optional; leave unset to let the writer reuse the shared OpenAI key)
- `OPENAI_API_KEY=...` (or `OPENAI_KEY` / `OPENAI_API_TOKEN`; required for summary + writer)
- `OPENAI_MODEL=gpt-4o-mini`
- `OPENAI_MODEL_WRITER=gpt-4.1-mini` (optional; writer falls back to `OPENAI_MODEL` or `gpt-4o-mini`)
- `IMAGE_PROVIDER=openai`, `huggingface`, or `mock` (pick the real provider you want to use; there is no longer an automatic mock fallback in development so you must either configure a provider or force the mock with `USE_MOCK_IMAGE_PROVIDER=true`)
- `USE_MOCK_IMAGE_PROVIDER=true|false` (optional; `true` forces the mock provider, `false` disables it even if `IMAGE_PROVIDER=mock`; leave undefined for strict behavior that requires a fully configured provider)
- `IMAGE_MODEL=gpt-image-1` (optional; defaults to `gpt-image-1`)
- `IMAGE_MODEL=gpt-image-1` (optional; defaults to `gpt-image-1`)
- `HF_TOKEN=...` (Hugging Face router token for `IMAGE_PROVIDER=huggingface`)
- `HUGGINGFACE_API_KEY=...` (optional alias for older deploys)

Writer endpoints (`/api/writer/*`) automatically use OpenAI when an OpenAI key is present; missing configuration results in a `503 CONFIG_ERROR` response body of the form `{ error: { code, message } }`. Set `WRITER_PROVIDER=mock` if you specifically want the mocked writer output instead of the OpenAI provider.

## Dev image provider

Image generation no longer falls back to the mock provider unless you explicitly opt into it. Leave `USE_MOCK_IMAGE_PROVIDER` undefined to require a fully configured provider (`IMAGE_PROVIDER=openai|huggingface` plus the matching credentials). When env vars are missing, the API returns `CONFIG_ERROR` and the startup diagnostics log makes it obvious why:

```
Startup diagnostics: {
  NODE_ENV: "development",
  PORT: 3000,
  listeningAddress: "0.0.0.0:3000",
  mockProviders: { summarizer: false, image: true, grammar: false, song: false },
  imageProviderConfigured: false,
  missingImageEnvVars: ["IMAGE_PROVIDER"],
  imageMockReason: "MISSING_ENV_VARS"
}
```

Set `USE_MOCK_IMAGE_PROVIDER=true` to force the mock provider while you finish wiring up OpenAI or Hugging Face. Set it to `false` if you want development to mirror production even when credentials are absent.

## Smoke test

Run `node smoke_test.js` from the repo root once dependencies are installed to verify smoke coverage before pushing or releasing. The smoke test now exercises `/api/image/generate` (mock provider by default) plus the corresponding history endpoint.

## API

- `GET /health`
- `POST /api/summarize`
- `POST /api/writer/generate`
- `POST /api/writer/refine`
- `GET /api/writer/history`
- `POST /api/writer/save`
- `POST /api/writer/share`
- `POST /api/image/generate`
- `GET /api/image/history`
- `GET /openapi.json`
- `GET /docs`
## Image generation

- Use the Visuals tab to enter a prompt, pick style/size/quality, and generate an image via `/api/image/generate`.
- The response renders immediately, exposes provider metadata, and enables download/copy of the generated image.
- Each successful run is stored in the server-side history, so the UI shows thumbnails with quick actions (view, copy prompt).
- Missing provider configuration surfaces helpful JSON errors (e.g., missing `OPENAI_API_KEY` or Hugging Face router keys) instead of mock data.

## Next Step
Connect a real AI provider (OpenAI or HuggingFace) by setting `SUMMARIZER_PROVIDER=openai` and providing an API key. For the Visuals tab, also set `IMAGE_PROVIDER=openai` or `IMAGE_PROVIDER=huggingface` along with the matching credentials (e.g., `OPENAI_API_KEY` or `HF_TOKEN`).
