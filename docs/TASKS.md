# Development Roadmap & Implementation Tracker — Customer Support Agent

**Status:** Core milestones 1 through 7 are completed and verified across unit, integration, and containerized browser tests. Cloud deployment and production hardening are tracked in the subsequent milestones.

---

## 1. Engineering Milestones

| Milestone | Area | Status | Verification Summary |
|---|---|---|---|
| **M1: Project Foundation** | Architecture & Tooling | Completed | Independent packages, TypeScript strict mode, reproducible npm lockfiles, environment validation. |
| **M2: Data Persistence & Auth** | Models & Core Auth | Completed | Mongoose schemas, bcrypt cost 12 hashing, HS256 JWT auth, owner-scoped queries. |
| **M3: AI Integration & Chat APIs** | Backend Services | Completed | OpenRouter client, context window management, atomic persistence, version concurrency. |
| **M4: Chat Interface & UX** | Frontend React SPA | Completed | Responsive Tailwind UI, drafts, history navigation, keyboard access, error recovery. |
| **M5: Containerization** | Docker & Compose | Completed | Multistage builds, non-root users, unprivileged Nginx reverse proxy, health checks. |
| **M6: Persistent Sessions** | Auth Hardening | Completed | Rotating HttpOnly cookies, hashed MongoDB sessions, CSRF headers, cross-tab sync. |
| **M7: Response Streaming** | Real-Time AI | Completed | SSE streaming (`/chat/send/stream`), incremental UI rendering, atomic commit on `[DONE]`. |
| **M8: Cloud Deployment** | Infrastructure | In Progress | Vercel SPA deployment, Render Docker service, production secret configuration. |
| **M9: Production Hardening** | Operations & QA | Planned | Application rate limiting, monitoring, automated end-to-end cloud smoke verification. |

---

## 2. Milestone Implementation Records

### Milestone 1 — Project Foundation

- [x] Initialized decoupled `client/` (React/Vite) and `server/` (Express) packages with Node 24 LTS and npm 11 lockfiles.
- [x] Implemented strict TypeScript configurations, ESLint configs, and non-mutating build/typecheck scripts.
- [x] Set up SPA routing structure (`/login`, `/signup`, `/chat`) and Express listener decoupling for testability.
- [x] Created `.env.example` templates and strict environment validation rejecting unconfigured variables or synthetic placeholders.

#### Milestone 1 Verification Record
- **Lint & Typecheck:** Both packages pass zero-warning lint and strict typechecks.
- **Reproducible Installs:** Clean `npm ci` builds execute offline from cache.
- **Environment Tests:** 18 client and 45 server tests verify missing/invalid configuration rejection without leaking secret values.

---

### Milestone 2 — Data Persistence and Authentication

- [x] Defined Mongoose schemas: `User` (email uniqueness, bcrypt hash) and `Conversation` (messages array, internal versioning, compound owner-sorting index).
- [x] Configured dedicated MongoDB test database isolation ensuring test suites never touch application data.
- [x] Implemented signup and login endpoints returning HS256 access JWTs with memory-only client handling.
- [x] Built React authentication provider with route guards and session expiration listeners.

#### Milestone 2 Verification Record
- **Backend Unit Tests:** 85 tests verify validation, JWT signing, password bounds (8–72 bytes), and generic error responses.
- **Atlas Integration Tests:** 8 tests on live MongoDB cluster verify unique index race handling, bcrypt cost 12 hashing, and database readiness transitions (`503` to `200`).
- **Frontend Component Tests:** 33 DOM tests verify auth form submissions, navigation guards, and clean memory state on logout.

---

### Milestone 3 — AI Integration and Chat APIs

- [x] Created server-side OpenRouter adapter targeting `https://openrouter.ai/api/v1/chat/completions` with 30s timeout and safe error classification.
- [x] Implemented system support prompt and multi-turn context assembly (last 10 completed exchanges).
- [x] Built `POST /chat/send` and both `GET /chat/history` modes (paginated list and full thread detail).
- [x] Implemented atomic message pair commits with conditional version checking (`__v`) to prevent race condition overwrites.

#### Milestone 3 Verification Record
- **API Tests:** 142 backend tests verify request sanitization, 16 KiB body limits, Unicode length counting, and safe error envelopes.
- **Integration Tests:** 36 tests verify owner filtering, 100-exchange limits, version conflict handling (`409 CONVERSATION_CHANGED`), and recovery after server restart.
- **Provider Connectivity Smoke:** Direct execution through production adapter verified model response generation and content bounds.

---

### Milestone 4 — Chat Interface and User Experience

- [x] Developed responsive chat layout with conversation sidebar, message list, and message composer.
- [x] Implemented per-thread draft preservation so uncommitted user input survives navigation.
- [x] Added visual indicators for pending requests, keyboard shortcuts (`Ctrl/Cmd + Enter`), and accessibility labels.
- [x] Built state management isolating account generations to prevent data leakage across user logouts.

#### Milestone 4 Verification Record
- **Component Tests:** 67 client tests verify draft retention, optimistic updates, and failure recovery.
- **Browser Automation Verification:** Chrome headless checks at 1440x900 and 375x900 confirmed zero horizontal overflow, visible focus rings, and proper mobile drawer navigation.

---

### Milestone 5 — Containerization

- [x] Created multistage `Dockerfile` for backend (compiled Node.js 24 Alpine, non-root user UID 1000).
- [x] Created multistage `Dockerfile` for frontend (built static bundle served by unprivileged Nginx, UID 101).
- [x] Configured Nginx reverse proxy routing `/backend/*` internally to Express with buffering disabled for streaming support.
- [x] Created `compose.yaml` orchestrating client and server with health check dependencies and loopback port bindings.

#### Milestone 5 Verification Record
- **Image Security Scans:** Layer inspections confirmed absence of `.env` files, build-time tokens, or development dependencies in runtime images.
- **Compose Runtime Verification:** Services start cleanly with `docker compose up -d --build --wait`; health probes pass on both services.
- **Container End-to-End Flow:** Full signup, AI exchange, history reload, and container restart persistence verified through port 8080.

---

### Milestone 6 — Persistent Authentication Enhancement

- [x] Designed `RefreshSession` collection in MongoDB storing SHA-256 hashes of selectors and tokens with TTL indices.
- [x] Added `POST /auth/refresh` with atomic single-use rotation and a 10-second grace window for safe concurrent races.
- [x] Added `POST /auth/logout` revoking the server session family and clearing browser cookies.
- [x] Configured cookie security: `__Host-csa-refresh` (HTTPS) and `csa-refresh-local` (HTTP), with fallback support for legacy cookies.
- [x] Added CSRF protection requiring `Origin` verification and `X-CSRF-Protection: 1` header on all auth mutations.
- [x] Implemented frontend multi-tab synchronization via `navigator.locks` and `BroadcastChannel`.

#### Milestone 6 Verification Record
- **Integration Regressions:** 47 integration tests verify token rotation, reuse detection (revocation of family), and database failure safety.
- **Browser Session Tests:** Verified session survival across page reloads and browser restarts without writing credentials to localStorage.

---

### Milestone 7 — Real-Time Response Streaming

- [x] Implemented `POST /chat/send/stream` returning `text/event-stream` with chunked UTF-8 decoding.
- [x] Defined SSE event contract: `started`, `delta`, `committed`, and `error`.
- [x] Added progressive token rendering in the frontend with typing indicators and cursor feedback.
- [x] Guaranteed atomic persistence: the database record is updated only after provider completion (`[DONE]`), followed immediately by the `committed` event.

#### Milestone 7 Verification Record
- **Stream Integrity Tests:** Verified correct UTF-8 reassembly across arbitrary byte chunks and fragmented SSE boundaries.
- **Failure Recovery:** Confirmed that provider disconnections or mid-stream aborts leave no partial records in the database.

---

### Milestone 8 — Cloud Deployment (In Progress)

- [ ] Configure MongoDB Atlas network security rules and application credentials for cloud egress.
- [ ] Deploy backend container to Render with production environment variables and `/health` probe.
- [ ] Deploy frontend SPA to Vercel with same-origin `/backend` rewrite rules in `client/vercel.ts`.
- [ ] Verify live HTTPS cookie forwarding, SSE streaming through Vercel edge proxy, and cross-origin security.

---

## 3. Future Development Backlog

| Feature | Description | Target |
|---|---|---|
| **Application Rate Limiting** | Implement IP- and user-based throttling using `express-rate-limit` on `/auth/*` and `/chat/*`. | Post-deployment |
| **Conversation Archival** | Allow users to rename, archive, or permanently delete conversation threads. | Backlog |
| **Model Selection** | Support user-configurable OpenRouter models with capability validation. | Backlog |
| **Audit Logging** | Centralized structured logging for security events and authentication failures. | Backlog |
