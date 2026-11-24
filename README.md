# Contract Lab

Contract Lab is an API contract workspace for comparing schema changes, testing requests and catching breaking changes before release.

## The problem

An API can pass its own tests and still break every consumer that depends on it. Contract Lab makes a proposed schema change reviewable in the same place engineers inspect affected applications and exercise the endpoint.

## Product capabilities

- **Schema diff** – current (main) and proposed (branch) request and response schemas side by side, aligned line by line. Every finding is classified as breaking, risky or safe, and "Inspect change" jumps to the exact line. Findings can be exported as JSON for CI.
- **Direction-aware rules** – requests and responses are judged in opposite directions. A new required request field breaks senders; a removed response field breaks readers. Enum, format, type, range and required-ness changes are all classified.
- **Consumer impact** – each consumer declares which fields it sends and reads, so only the consumers actually touched by a change are flagged. Record acknowledgements, withdraw them or notify the owning team. An acknowledgement covers the exact set of breaking changes and goes stale if the proposal changes.
- **Review & merge gate** – a branch can merge only when every consumer hit by a breaking change has acknowledged it (enforced in the reducer as well as the UI). Merging promotes the proposal to main and bumps the semver: breaking → major, additions → minor, otherwise patch.
- **Request lab** – edit a body, validate it live against either side, see when a body that works on main would fail on the branch, and send it to receive a schema-generated response (400 / 404 / 422 / success). Copy as cURL; every call is kept in Request history and can be replayed.
- **Proposal editor** – edit the proposed schemas and status code with validation and a preview of the resulting findings, add endpoints, remove them (a breaking change) or revert to main.
- **AI migration guide** – on the Impact tab, "Draft migration guide" sends the endpoint's classified changes and affected consumers to a language model, which streams back a release summary, concrete steps for each consumer team and a message to send to their owners, ready to copy.
- **Activity, settings & export** – a filterable activity log, project settings, OpenAPI 3.1 export of either side, backup import/export and demo reset. Everything persists in the browser.

## Engineering decisions

- The domain lives in `lib/contract/` as plain TypeScript: `diff.ts` (semantic diff, impact, fingerprints, gate, semver), `schema.ts` (path-aware printer, LCS line alignment, validator, sample generator), `openapi.ts`, a pure `reducer.ts` with the request simulator, and `seed.ts`.
- Findings, impact and gate status are derived from the two contracts rather than stored, so they can never disagree with the schemas.
- Hand-edited schemas are parsed with a strict Zod schema, so unknown keywords and typos are rejected instead of silently ignored.
- Radix tabs and dialogs provide accessible views. Severity always pairs colour with an icon and a label, and on small screens the diff becomes a unified single-column view.

## AI migration guide: how it works

- `lib/ai/migration.ts` builds a compact request from the semantic diff: every classified change, the next semver version and only the consumers a change actually touches, with the fields they send and read. It is pure TypeScript and unit-tested, including the streaming parser.
- `worker/ai.ts` exposes `POST /api/ai/migration` on the Cloudflare Worker. It validates and size-limits the request, calls an OpenAI-compatible Chat Completions endpoint with `stream: true`, and re-streams only the text deltas as plain text.
- The model is told to use only the given changes and consumers, so it refers to real field paths instead of inventing them. The API key never reaches the browser, and provider errors are logged on the server, not shown to users.
- `components/contract/AiMigration.tsx` streams the guide in, can be stopped mid-answer and copies the result for Slack or a pull request.
- Free by default: it uses Google's free Gemini API tier through its OpenAI-compatible endpoint. Set `AI_BASE_URL` to switch to OpenAI, Azure OpenAI or Groq.

### Configure (free)

1. Create a free Gemini API key in Google AI Studio (https://aistudio.google.com/apikey).
2. Add it to the Worker:

```bash
npx wrangler secret put AI_API_KEY
# optional: AI_MODEL (default gemini-flash-latest), AI_BASE_URL, AI_API_VERSION (Azure)
```

For local development put `AI_API_KEY=...` in a `.dev.vars` file (git-ignored).

## Run locally

```bash
npm ci
npm run dev
```

## Verify

```bash
npm run build
npm run lint
npm test   # builds, then runs the diff, gate, validator and reducer tests in tests/
```

## Next step

A production version would ingest OpenAPI documents from CI, calculate semantic diffs on the server and block a merge when a breaking change lacks consumer approval.
