# StudySummarize

A frontend-only AI summary maker for students, now with a production-ready backend API.

## Features
- Paste notes and summarize
- Summary length & format options
- Copy and download summary
- Modern UI (desktop-first)
- Express backend with provider system (mock + OpenAI)
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

### Environment variables

Copy `.env.example` to `.env` and update values as needed:

- `PORT=3000`
- `SUMMARIZER_PROVIDER=mock` or `openai`
- `OPENAI_API_KEY=...`
- `OPENAI_MODEL=gpt-4o-mini`

## Smoke test

Run `node smoke_test.js` from the repo root once dependencies are installed to verify smoke coverage before pushing or releasing.

## API

- `GET /health`
- `POST /api/summarize`
- `GET /openapi.json`
- `GET /docs`
## Next Step
Connect a real AI provider (OpenAI or HuggingFace) by setting `SUMMARIZER_PROVIDER=openai` and providing an API key.
