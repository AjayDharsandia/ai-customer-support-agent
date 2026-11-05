# Product Requirements Document — Customer Support Agent

**Status:** Current product scope. Core features (authentication, chat, AI integration, Docker, deployment) are implemented. Persistent authentication and genuine AI response streaming are authorized enhancements. Deployment finalization remains a separate task.

## 1. Purpose and objectives

Customer Support Agent is a full-stack chat application that connects authenticated users with AI-generated support guidance. The product demonstrates clean architecture across a React single-page application, an Express API, and MongoDB persistence, with real-time AI response streaming via OpenRouter.

The primary goals are:

- Provide a secure, user-scoped chat experience with registration, login, and logout.
- Generate meaningful AI responses to customer queries and persist conversation history.
- Deliver a reproducible setup via Docker Compose and a deployable architecture.

This document defines product scope and acceptance criteria. [ARCHITECTURE.md](ARCHITECTURE.md) defines technical contracts, [TASKS.md](TASKS.md) tracks implementation order, and [TEST_PLAN.md](TEST_PLAN.md) defines verification procedures.

## 2. Target users

The primary user is an authenticated customer seeking general support guidance through a conversational AI interface. There is no support-operator or administrator role in the current version.

Success means all requirements below pass their acceptance criteria, setup is reproducible, users cannot access each other's conversations, secrets remain server-side, and the application is available via both Docker Compose and a deployed URL. The product operates within free-tier capacity and does not claim unrestricted production readiness without additional abuse controls.

## 3. Functional requirements

### Authentication

| Requirement | Acceptance criterion |
|---|---|
| JWT-based signup, login, and logout | Valid signup returns a session; valid login restores access; invalid credentials fail; logout clears the session and all user-visible private state. |
| bcrypt password hashing | Stored credentials contain a bcrypt hash, never plaintext; hashes and passwords never appear in API output or logs. |
| Protected routes | Unauthenticated users cannot enter the chat UI or access chat APIs; expired or invalid tokens return `401`. |
| Secure persistent authentication | Reload/reopen restores login while a rotating HttpOnly refresh session remains valid; access JWT stays in memory. Defaults 15 min / 1 day, both validated as backend environment durations. Hashed-only sessions, atomic rotation, reuse detection, logout revocation, CSRF protection, same-origin proxy, retryable outage UI, and account isolation pass all authentication tests. No uncertain chat resend. |

### Chat system

| Requirement | Acceptance criterion |
|---|---|
| Text input and AI-generated responses | A nonempty submitted message produces a visible real AI response after successful API completion; invalid input is rejected. |
| MongoDB user-scoped saved history | Successful exchanges survive process restarts and re-login; another user's identifiers never grant access. |
| Conversation listing and reopening | A user can list, reopen, and read their saved conversations, including an empty-state experience. |

### AI integration

| Requirement | Acceptance criterion |
|---|---|
| OpenRouter provider integration | Express calls OpenRouter with a server-held API key; the deployed application successfully generates responses. |
| Genuine AI response streaming | Authenticated `POST /chat/send/stream` relays real OpenRouter fragments through SSE. The UI renders temporary text progressively but treats an exchange as saved only after an atomic MongoDB pair write and `committed` event. Partial, failed, or disconnected streams are never persisted or automatically retried. |

### API

| Requirement | Acceptance criterion |
|---|---|
| Required API paths | Provide `POST /auth/signup`, `POST /auth/login`, `POST /chat/send`, and `GET /chat/history` with the documented contracts. |
| Consistent interfaces | APIs follow the envelopes, status codes, examples, and types in ARCHITECTURE.md across local, Docker, and deployed environments. |

### Frontend

| Requirement | Acceptance criterion |
|---|---|
| React chat UI with secure token handling | React supports authentication and chat flows using Axios; JWT is kept only in memory and sent as a Bearer token. |
| Security and ownership | No frontend secrets; all chat access is owner-filtered; requests are validated; untrusted text is escaped; errors and logs expose no sensitive internals. |

### Infrastructure

| Requirement | Acceptance criterion |
|---|---|
| Technology stack | React/Vite/TypeScript, Tailwind CSS, Express/TypeScript, Mongoose/Atlas, JWT/bcrypt, OpenRouter, Axios, Docker Compose, Vercel frontend and Render backend. |
| Docker Compose | After documented environment setup, `docker compose up` builds and starts the frontend and backend and supports the complete flow. |
| Repository structure | Repository contains `client/`, `server/`, corresponding `.env.example` files, and a clear README with setup steps and limitations. |
| Deployed application | README includes a working frontend URL backed by the deployed API and Atlas; deployed smoke tests pass. |
| Documentation before implementation | All five Markdown documentation files exist and are reviewed before any application code, manifests, Docker files, or deployment resources are created. |
| Simplicity and production-consciousness | One SPA, one API, three MongoDB collections; bounded data and timeouts; no unnecessary infrastructure or optional scope disguised as mandatory work. |

## 4. Agreed behavior

| Decision | Details |
|---|---|
| Token architecture | Memory-only access JWT (default 15 min) plus rotating opaque HttpOnly refresh cookie (absolute default 1 day). Expiries are server-configurable. Refresh restores login; server logout revokes the refresh family and clears private state. Existing access JWTs remain valid until expiry. See architecture documentation for CSRF, rotation, and concurrency policy. |
| Conversation model | Separate conversations. New chat starts an unsaved draft; the first successful exchange creates a thread. Users can reopen and continue saved threads. |
| Atomic message persistence | Persist successful user/assistant pairs atomically. Streamed fragments are temporary UI state; only `committed` confirms the complete pair. A confirmed provider/validation failure saves nothing and retains the draft. A lost response or uncertain database acknowledgment may conceal a committed exchange; reload history before deciding to resend. |
| Input and output bounds | User messages: 1–4,000 characters after trimming; JSON requests: at most 16 KiB; conversation: at most 100 successful exchanges. AI receives the last ten exchanges plus the current message and has a 512-token output budget and 30-second timeout. |
| Environment and deployment | Environment variables and the Docker/deployment design are part of the baseline. Compose runs client and server against Atlas. Dedicated environment-switching profiles remain optional. |

## 5. User workflows

### Registration and login

1. Open `/signup` or `/login`; submit labeled email and password fields.
2. Display field validation or a safe API error. Signup does not require a name or email verification.
3. On success, keep the returned token, expiry, and public user in memory and navigate to `/chat`.
4. On reload, check the HttpOnly refresh session before routing. Restore access and history if valid; show login only after invalid credentials, or a retry action for a temporary outage. Browser reopen works until absolute refresh expiry.

### New conversation and continuation

1. Select New chat; retain no empty database record.
2. Enter text and send. Disable repeat submission and thread switching while pending. Show accessible animated dots until the first genuine provider fragment, then append fragments with a generation cursor.
3. Treat the streamed user/assistant display as temporary. Only after `committed` display the saved pair, remove the cursor, select its conversation ID, clear the draft, and refresh summaries.
4. Open a history item to fetch its full ordered transcript, then send with its conversation ID to continue.
5. At 100 exchanges, keep the conversation readable and offer New chat rather than discarding old messages.

### History and failures

1. Show conversation summaries newest first, with title and last-update time; support pagination.
2. Show a useful empty state when there are no conversations.
3. For a confirmed failed send, preserve the draft in memory and allow manual retry; do not invent an assistant answer.
4. For a timeout, connection loss, or uncertain database result, explain that saving may have completed. Reload history before manually resending; there is no exactly-once guarantee.
5. On a concurrent-update conflict, reload the transcript before resubmitting. No automatic retry.
6. On access expiry or a pre-handler `401 UNAUTHORIZED`, coordinate one refresh; retry the rejected request at most once. Invalid/expired refresh credentials clear private state and return to login. Temporary restoration outages show a retry action. Logging out takes precedence over retaining a draft.

### Logout and account changes

Immediately clear JWT, user, conversation list, selected transcript, draft, and pending state; cancel outstanding requests when possible. Ignore their late responses so a previous account's data never appears in the next account's UI. Cancellation does not guarantee that the server stopped a request already accepted. Revoke the refresh session and clear its cookie through the logout API; report an unconfirmed server logout with a retry action. Access JWTs already issued remain valid until expiry.

## 6. Current scope and future enhancements

### Current limitations

Basic pending feedback, mapping provider quota failures to `429`, environment variables, `NODE_ENV`, and platform-specific settings are part of the baseline and do not constitute the enhancements listed below.

### Future enhancements

| Enhancement | Criteria for implementation |
|---|---|
| Application rate limiting | Add `express-rate-limit` with documented auth/chat policies and safe `429` responses; validate Render proxy handling first. |
| Environment-switching profiles | Add explicit dev/prod configuration profiles without moving secrets into frontend code or images. |

### Out of scope

The following are not planned for the current version: RAG, uploads, vector search, tool execution, human escalation, admin roles, email verification, password recovery, conversation deletion/renaming, persistent pending messages, distributed locks, exactly-once delivery, and application-managed model failover. The streaming enhancement does not imply any of these additions.
