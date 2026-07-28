# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

A single Vercel serverless function that backs a contract-extraction frontend. The
frontend uploads a contract file (PDF/image) as base64; the function forwards it to
Google's Gemini API (`gemini-2.5-flash`) with an extraction prompt and returns
structured JSON. The whole point of having a backend at all is to keep the Gemini API
key server-side so it's never exposed to the browser.

There is no frontend code in this repo — just the API handler.

## Repo layout

- `contract-extractor-backend/api/extract.js` — the live handler, deployed by Vercel as
  `POST /api/extract`. This is the only real code in the repo.
- `contract-extractor-backend/api/placeholder.txt` — empty placeholder, not code.
- `contract-extractor-backend/API/extract.js` — **stray leftover file, not the real
  handler.** It used to be a duplicate of `api/extract.js` but its contents were deleted
  in commit `d4e6a68` ("Remove the extract.js API handler implementation"), leaving an
  empty file behind. Having both `api/` and `API/` directories is only possible because
  this repo has been edited on a case-sensitive filesystem; on Vercel's build/routing or
  on a case-insensitive filesystem (macOS/Windows checkouts) these two paths can collide.
  If you're working in this area, treat `contract-extractor-backend/api/` (lowercase) as
  the source of truth, and flag/remove the `API/` directory rather than editing it.
- `contract-extractor-backend/package.json` — no `scripts`, no `dependencies`. Its
  `description` field says the key it holds server-side is an "Anthropic API key" — that
  is stale/incorrect; the actual implementation uses `GEMINI_API_KEY` and calls the
  Gemini API, not Anthropic's. Don't propagate that description elsewhere.

## Development workflow

There is no build step, lint config, test framework, or dependency manifest in this
repo — `package.json` has no `scripts` and no `dependencies`/`devDependencies`. There is
nothing to run locally beyond the function code itself. Deployment is via Vercel's
filesystem-based routing convention (any file under `api/` becomes an endpoint at the
matching path), not via an explicit `vercel.json`.

If you add real dependencies or logic worth testing, you'll need to introduce the
tooling (package manager scripts, test runner, etc.) yourself — none currently exists.

## `api/extract.js` — how it works

- CommonJS module exporting a single `handler(req, res)` (Vercel Node function
  signature).
- Sets permissive CORS headers (`Access-Control-Allow-Origin: *`) and short-circuits
  `OPTIONS` requests, since the frontend can be served from anywhere (a user's own
  machine, a customer's machine, etc.) — there's no fixed origin to lock CORS down to.
- Only accepts `POST`; anything else is `405`.
- Expects a JSON body: `{ base64, mimeType, facilityNames?, vendorNames? }`, where
  `base64`/`mimeType` are the uploaded contract file and `facilityNames`/`vendorNames`
  are arrays of already-known names used to bias the model toward exact matches instead
  of inventing new spellings.
- Requires `process.env.GEMINI_API_KEY` to be set (in Vercel project settings for
  deployed environments) — returns `500` with a descriptive message if missing.
- Builds a prompt that pins the model to a strict output contract:
  ```
  {"vendorName": string|null, "facilityName": string|null, "serviceLine": string|null,
   "startDate": "YYYY-MM-DD"|null, "endDate": "YYYY-MM-DD"|null, "cost": number|null,
   "costFrequency": "monthly"|"quarterly"|"annual"|"one-time"|null,
   "termsSummary": string|null}
  ```
  Dates are normalized to `YYYY-MM-DD`, cost is a bare number, and `termsSummary` must
  be a paraphrase (1-2 sentences), not verbatim contract text. Any change to this schema
  needs to stay in sync with whatever the frontend expects back.
- Calls Gemini's `generateContent` endpoint directly via `fetch` (no SDK), sending the
  file as `inline_data` plus the prompt as a text part in the same `contents[0].parts`
  array.
- Response text is stripped of markdown code fences (models sometimes wrap JSON in
  ```json ... ``` despite instructions) before `JSON.parse`. Parse failures return `500`
  with a truncated raw-text snippet (`raw`) to aid debugging, rather than crashing.
- All error paths return `{ error: string }` with an appropriate status code; there is
  no logging beyond what's returned in the response body.
