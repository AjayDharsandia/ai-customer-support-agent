# Quality Assurance and Verification Test Plan — Customer Support Agent

**Status:** Active test plan covering all unit, integration, browser, container, and security verification procedures. Executed results and verification records are tracked in [TASKS.md](TASKS.md).

---

## 1. Test Setup and Execution Strategy

- **API Unit & Mock Testing**: Vitest and Supertest exercise Express endpoints in isolation. Upstream OpenRouter responses are mocked at the Axios adapter boundary to guarantee repeatable, deterministic tests without incurring provider costs or network flakiness.
- **Database Integration Testing**: Automated integration suites run against an isolated MongoDB Atlas test database specified by `MONGODB_TEST_URI`.
  - *Safety constraint*: The URI must explicitly end with `_test` and point to a separate database name from development or production.
  - *Fixture cleanup*: Tests remove exclusively test-generated user emails, refresh sessions, and conversation records. Indiscriminate collection drops or `dropDatabase` calls are strictly avoided.
- **Client Component Testing**: React Testing Library and jsdom verify form validation, state transitions, navigation guards, keyboard interactions, and responsive rendering.
- **Browser & End-to-End Verification**: Conducted using Chrome DevTools Protocol against production builds running in Docker Compose or preview environments.
- **Security & Secret Scanning**: Static inspections and layer checks verify that credentials (`JWT_SECRET`, `MONGODB_URI`, `OPENROUTER_API_KEY`) never leak into client bundles, Docker build arguments, images, or client-side storage.

---

## 2. Authentication and Security Test Matrix

| Test ID | Scope | Procedure & Request | Expected Outcome |
|---|---|---|---|
| **AUTH-01** | Signup & Token Generation | `POST /auth/signup` with valid `{ email, password }`. | Returns `201` with public user DTO, token, and expiry. Token is valid HS256 JWT with expected claims and expiration. |
| **AUTH-02** | Password Hashing | Inspect database record directly via test query after signup. | Stored `passwordHash` is a bcrypt hash (cost 12); plain password never stored or returned. |
| **AUTH-03** | Email Normalization | Submit signups differing only in email case and whitespace. | Normalized to unique lowercase record; duplicate returns `409 EMAIL_EXISTS`. |
| **AUTH-04** | Password Length Boundaries | Test 7/8-character and 72/73-byte passwords, including multibyte characters and spaces. | Rejects < 8 characters or > 72 UTF-8 bytes with `400 VALIDATION_ERROR`. Spaces preserved without trimming. |
| **AUTH-05** | Credential Validation | Attempt login with incorrect password and unregistered email. | Both return identical `401 INVALID_CREDENTIALS` error without disclosing existence of account. |
| **AUTH-06** | Protected Route Access | Call `/chat/*` endpoints without token, or with expired, malformed, or tampered JWT. | Returns `401 UNAUTHORIZED`; no database operation or provider call dispatched. |
| **AUTH-07** | JWT Claim Verification | Sign test tokens with incorrect issuer, audience, algorithm, or subject. | Request rejected with `401 UNAUTHORIZED`. Algorithm from untrusted header rejected. |
| **AUTH-08** | Secret Sanitization | Trigger validation, network, and database errors while inspecting output logs. | Logs and response payloads contain no passwords, hashes, tokens, or connection strings. |

---

## 3. Persistent Sessions and Token Rotation

| Test ID | Scope | Procedure & Request | Expected Outcome |
|---|---|---|---|
| **SESS-01** | Cookie Attributes | Inspect `Set-Cookie` on successful login or signup. | Sets `HttpOnly; SameSite=Lax; Path=/`. `Secure` attribute enforced in production HTTPS mode (`__Host-csa-refresh`). |
| **SESS-02** | Token Rotation | Call `POST /auth/refresh` with valid session cookie. | Returns new access JWT and rotates refresh token in cookie. Old credential recorded as spent. |
| **SESS-03** | Concurrent Refresh Race | Dispatch 4 simultaneous refresh calls with identical cookie. | Exactly one call succeeds (`200`); remaining 3 return `409 REFRESH_CONFLICT` without invalidating session. |
| **SESS-04** | Reuse Detection | Attempt to reuse a spent refresh token after the 10-second grace window. | Returns `401 UNAUTHORIZED` and immediately revokes all sessions in the token family. |
| **SESS-05** | Server Logout | Call `POST /auth/logout` with active cookie. | Revokes session family in database, expires cookie (`Max-Age=0`), and subsequent refresh attempts return `401`. |
| **SESS-06** | CSRF Protection | Attempt `POST /auth/*` calls with untrusted `Origin`, missing `X-CSRF-Protection`, or cross-site fetch metadata. | Returns `403 CSRF_REJECTED`. |
| **SESS-07** | Session Restoration | Reload browser or restart page after successful authentication. | Client silent refresh restores user state and loads conversation history from HttpOnly cookie. |

---

## 4. Chat System, Persistence, and Concurrency

| Test ID | Scope | Procedure & Request | Expected Outcome |
|---|---|---|---|
| **CHAT-01** | New Conversation | Send `{ message: "Help with account" }` without `conversationId`. | Returns `200` with canonical `SendChatData`. Exactly one conversation created with 2 messages. |
| **CHAT-02** | Thread Continuation | Send `{ message: "Follow-up question", conversationId }`. | Appends message pair to existing thread, increments version `__v`, updates `updatedAt`. |
| **CHAT-03** | History Pagination | Retrieve `GET /chat/history?page=1&limit=20`. | Returns summaries ordered by `updatedAt` descending; excludes heavy message content arrays. |
| **CHAT-04** | Owner Isolation | User B requests transcript or sends to User A's `conversationId`. | Returns `404 CONVERSATION_NOT_FOUND`. No data disclosed or mutated. |
| **CHAT-05** | Title Derivation | Start conversation with long message containing extra whitespace. | Title collapsed and truncated to 80 characters; full original text preserved in message body. |
| **CHAT-06** | Capacity Boundary | Attempt send on a thread already containing 100 exchanges (200 messages). | Returns `409 CONVERSATION_LIMIT_REACHED` before calling AI provider. |
| **CHAT-07** | Concurrency Conflict | Simulate two concurrent send operations on the same conversation version. | First write succeeds; second write fails conditional version check and returns `409 CONVERSATION_CHANGED`. |
| **CHAT-08** | Process Restart | Save conversation, restart backend service, re-authenticate and fetch history. | Saved transcript survives process restarts; persistence verified in MongoDB. |

---

## 5. AI Integration and Streaming Tests

| Test ID | Scope | Procedure & Request | Expected Outcome |
|---|---|---|---|
| **AI-01** | Context Construction | Inspect outgoing OpenRouter payload on continued conversation. | Payload includes support system prompt, last 10 completed exchanges, and current user message. |
| **AI-02** | Provider Timeout | Simulate upstream provider exceeding 30 seconds. | Returns `504 AI_TIMEOUT`; no partial message pair saved to database; draft preserved. |
| **AI-03** | Provider Rate Limiting | Simulate upstream `429` rate limit response from OpenRouter. | Maps safely to `429 AI_RATE_LIMITED` with user-friendly retry guidance. |
| **AI-04** | Upstream Failures | Simulate upstream `500` or invalid model error from provider. | Maps to `502 AI_REQUEST_FAILED`; user session remains authenticated. |
| **STREAM-01** | SSE Event Sequence | Connect to `POST /chat/send/stream` with valid payload. | Receives `started`, sequential `delta` events, and terminal `committed` event. |
| **STREAM-02** | Chunk Reassembly | Deliver stream split across arbitrary UTF-8 multibyte byte boundaries. | Incremental parser reconstructs complete Unicode characters without replacement glyphs. |
| **STREAM-03** | Mid-Stream Disconnect | Client disconnects before provider emits `[DONE]`. | Provider stream aborted; no incomplete or one-sided exchange persisted to database. |
| **STREAM-04** | Stream Pre-Auth Failure | Request stream with expired or invalid token. | Returns standard JSON error envelope with appropriate 4xx status before SSE headers are sent. |

---

## 6. Frontend and User Experience Tests

| Test ID | Scope | Procedure & Request | Expected Outcome |
|---|---|---|---|
| **UI-01** | Auth Navigation | Access `/chat` unauthenticated; complete login. | Redirected to `/login`; post-auth redirected to `/chat` with session state active. |
| **UI-02** | Duplicate Send Lock | Rapidly click Send or press Enter while generation is pending. | Form submit disabled; composer locked; exactly one request dispatched. |
| **UI-03** | Draft Preservation | Type message, switch conversation, then switch back. | Unsent text retained in composer for the active draft. |
| **UI-04** | Error Recovery | Trigger failed send due to network outage. | User text preserved in composer; retry button displayed; no partial message in transcript. |
| **UI-05** | XSS Sanitization | Send HTML markup (`<script>`, `<iframe>`, `<img>`) in messages. | Content rendered safely as escaped plain text; zero script execution. |
| **UI-06** | Account Isolation | User A logs out; User B logs in on same browser. | User A's messages, drafts, and history immediately cleared from memory; User B sees only their data. |
| **UI-07** | Keyboard & Viewport | Complete chat workflow on 375px mobile viewport using keyboard navigation. | Accessible focus rings; mobile drawer functions; zero horizontal page overflow. |

---

## 7. Containerization and Operations Tests

| Test ID | Scope | Procedure & Request | Expected Outcome |
|---|---|---|---|
| **OPS-01** | Environment Validation | Start backend with missing or placeholder environment variables. | Process exits with non-zero code; logs identify missing variable names without exposing secrets. |
| **OPS-02** | Compose Orchestration | Run `docker compose up -d --build --wait`. | Both `client` and `server` containers become healthy; ports 8080 and 5000 bound. |
| **OPS-03** | Reverse Proxy | Access `http://localhost:8080/backend/health`. | Nginx successfully proxies request to backend Express container and returns 200. |
| **OPS-04** | Non-Root Execution | Inspect user IDs inside running containers. | Server runs as UID 1000; client Nginx runs as UID 101. |
| **OPS-05** | Layer Secret Scan | Decompress and inspect all Docker image layers. | No `.env` files, private keys, or build-time credentials present in images. |
| **OPS-06** | Cloud Deployment Health | Request `/health` on deployed cloud backend. | Returns `200 {"success":true,"data":{"status":"ok"}}` with sub-second response time. |

---

## 8. Verification Commands

Run these checks locally to confirm that code quality and behavior match standards:

```bash
# Frontend quality checks
npm --prefix client run lint
npm --prefix client run typecheck
npm --prefix client run test -- --run
npm --prefix client run build

# Backend quality checks
npm --prefix server run lint
npm --prefix server run typecheck
npm --prefix server run test -- --run
npm --prefix server run build

# Integration test suite (requires MONGODB_TEST_URI)
npm --prefix server run test:integration

# Docker Compose validation
docker compose config --quiet
```
