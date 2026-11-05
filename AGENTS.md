# Instructions for Coding Agents

## Source of truth

Read the [PRD](docs/PRD.md), [architecture/contracts](docs/ARCHITECTURE.md), [tasks](docs/TASKS.md), and [test plan](docs/TEST_PLAN.md) before coding. The PRD owns scope, ARCHITECTURE.md owns technical contracts, and TASKS.md records implementation progress. Resolve contradictions before implementing an incompatible choice.

These standards apply to the existing implementation and authorized enhancements. TASKS.md records historical verification; ARCHITECTURE.md defines current contracts.

## Engineering conventions

- Use the approved React/Vite/TypeScript/Tailwind client and Express/TypeScript/Mongoose server. Use Axios, JWT/bcrypt, OpenRouter, Docker/Compose, Vercel, and Render as documented.
- Keep two independent npm packages, `client/` and `server/`, with lockfiles and a consistently pinned supported Node LTS. Use `npm ci` for repeatable builds.
- Enable TypeScript strict mode. Prefer explicit boundary types and `unknown` with narrowing over `any`; do not bypass errors using unexplained assertions or suppressions.
- Name React components/types in PascalCase, functions/variables in camelCase, and true constants in UPPER_SNAKE_CASE. Use descriptive filenames matching their exported module/component. Follow the scaffold's consistent formatter and two-space indentation.
- Keep controllers thin, services responsible for behavior, models responsible for persistence, and middleware responsible for authentication/error normalization. Avoid generic repository abstractions, unnecessary shared packages, and extra infrastructure.
- Use React state/context and one configured client Axios instance. Keep the server provider client separate. Do not add a state platform, AI SDK, cache, queue, or microservice without a concrete approved requirement.
- Preserve the exact required routes without an `/api` prefix. Keep response envelopes, UTC dates, string IDs, error codes, and TypeScript contracts synchronized with ARCHITECTURE.md.
- Validate allowed request fields centrally; reject unknown fields. Count Unicode characters and UTF-8 password bytes as documented. Handle duplicate indexes and async failures explicitly.
- Keep functions small enough to review; explain non-obvious race/security choices in comments rather than narrating routine code. Change documentation and meaningful tests with contract changes.

## Security invariants

- Derive conversation ownership solely from verified JWT `sub`; filter every conversation read/write by owner. Do not trust body/query ownership or merge arbitrary request objects into database queries.
- Verify HS256, issuer, audience, expiry, and subject. Hash with asynchronous bcrypt cost 12; never trim passwords, allow byte truncation, serialize hashes, or log credentials. Never log refresh tokens or raw Cookie headers.
- Store access JWTs only in memory; opaque refresh credentials belong only in host-only HttpOnly cookies and hashed MongoDB sessions. Use environment-driven expiries, absolute session expiry, atomic rotation/reuse policy, server logout revocation, exact Origin/custom-header CSRF checks and the documented same-origin proxy. Never persist tokens in JavaScript storage. Clear private state on logout/invalid refresh and ignore stale responses across account generations; coordinate refresh/cookie writes.
- Never expose JWT secrets, MongoDB credentials, or OpenRouter keys in frontend code, `VITE_*` variables, URLs, logs, examples, commits, Docker layers/build arguments, or tool output. Only the API base path/origin is public client configuration.
- Keep real environment files out of Git and Docker build contexts. Use platform runtime secrets and exact CORS origins; CORS never substitutes for authorization.
- Render untrusted user/model content as escaped text. Do not use `dangerouslySetInnerHTML`, execute AI output, or accept client-supplied prompts, roles, transcripts, or model settings.
- Enforce message/body/output/conversation bounds, provider timeouts, atomic pair writes, and conditional version updates. Streamed deltas are temporary and `committed` is permitted only after the full pair is saved. Never retry an uncertain send or disguise unsaved replies as success. The only permitted automatic chat retry is once after this backend's pre-handler 401 UNAUTHORIZED and coordinated access refresh.
- Normalize errors without raw Axios/Mongoose details or request bodies. Use readiness without exposing infrastructure secrets. Use least-privilege Atlas accounts and HTTPS when deployed.

## UX and scope discipline

- Implement every core feature before optional enhancements. Keep rate limiting and environment profiles deferred unless authorized. Basic pending feedback and environment variables are baseline.
- Use labeled forms, keyboard access, readable focus/error states, responsive layout, and clear empty states. Preserve failed drafts unless logout/expiry clears them.
- Distinguish confirmed provider failures from uncertain network/write outcomes. Reload history before manual resend; do not claim exactly-once delivery or immediate JWT revocation.
- Preserve the authorized SSE streaming contract. Do not silently add WebSockets, RAG, tools, uploads, admin roles, conversation deletion, or a local MongoDB service.

## Verification and reporting

Provide these scripts during scaffolding. Checks must not rewrite source unless a formatting change is intentional.

```text
npm --prefix client run lint
npm --prefix client run typecheck
npm --prefix client run build
npm --prefix server run lint
npm --prefix server run typecheck
npm --prefix server run build
npm --prefix server run test -- --run
docker compose config --quiet
```

Use Vitest/Supertest for meaningful API behavior with mocked OpenRouter. Integration tests require a separately provisioned `MONGODB_TEST_URI` targeting a dedicated database whose name ends in `_test`, never a fallback to the application database. Remove only fixtures created by the suite. Use the manual browser, Docker, and hosted smoke cases in TEST_PLAN.md; a passing mock does not prove real provider integration.

During implementation run checks appropriate to the changed behavior, then complete the core checks before marking work complete. Do not write tests that merely mirror implementation, repeat passing broad suites without cause, or add an elaborate testing platform. If dependencies/configuration/services prevent a check, report that fact and the unverified behavior. During documentation-only work, validate documents and do not run nonexistent application commands.

Report changed behavior, relevant checks actually run, failures/limitations, and any remaining work. Never mark an unchecked implementation task complete based on documentation, fabricated logs, or assumed results. Keep secrets out of verification output.
