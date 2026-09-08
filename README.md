# Contract Lab

Contract Lab is an API contract workspace for comparing schema changes, testing requests and catching breaking changes before release.

## The problem

An API can pass its own tests and still break every consumer that depends on it. Contract Lab makes a proposed schema change reviewable in the same place engineers inspect affected applications and exercise the endpoint.

## Product capabilities

- Browse and search API endpoints.
- Compare current and proposed JSON schemas side by side.
- Highlight removed, added and narrowed fields.
- Separate breaking changes from safe validation improvements.
- Identify affected consumers before merge.
- Edit and send a sample request.
- Inspect simulated status, latency and response data.

## Engineering decisions

- React and TypeScript keep endpoint selection, request state and responses predictable.
- Radix tabs separate schema review, request testing and consumer impact without changing context.
- A split editor uses consistent line mapping so schema differences remain easy to scan.
- Semantic status colors are reinforced with labels and icons.
- The layout turns into a stacked review flow on smaller screens.
- All data is synthetic and requires no credentials.

## Run locally

```bash
npm ci
npm run dev
```

## Verify

```bash
npm run build
npm run lint
```

## Next step

A production version would ingest OpenAPI documents from CI, calculate semantic diffs on the server and block a merge when a breaking change lacks consumer approval.
