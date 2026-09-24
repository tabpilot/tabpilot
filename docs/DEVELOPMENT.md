# Tab Pilot — Developer Reference

This guide is the definitive technical reference for contributors and self-hosters. It covers local setup, the monorepo layout, all environment variables, database schemas, and architectural rationale. For the full REST and WebSocket API surface, see the [Swagger docs](#6-api-reference).


## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Getting Started](#2-getting-started)
3. [Monorepo Structure](#3-monorepo-structure)
4. [Running in Development](#4-running-in-development)
5. [Environment Variables](#5-environment-variables)
6. [API Reference](#6-api-reference)
7. [Database Schemas](#7-database-schemas)
8. [Architecture Decisions](#8-architecture-decisions)
9. [Testing](#9-testing)
10. [Building for Production](#10-building-for-production)
11. [Contributing](#11-contributing)


## 1. Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| Node.js | 22.x | [nvm](https://github.com/nvm-sh/nvm) — `nvm install 22` |
| Yarn Berry | 4.x | Managed automatically via Corepack |
| Corepack | bundled with Node.js 22 | `corepack enable` |
| Podman | 4.x+ | [podman.io](https://podman.io/getting-started/installation) |
| MongoDB | 7.x | Run via `compose.dev.yml` (no local install required) |

**On macOS**, Podman Desktop is the recommended way to get Podman. After installation, start the Podman machine before running any compose commands:

```bash
podman machine init   # first time only
podman machine start
```


## 2. Getting Started

```bash
# Clone the repository
git clone https://github.com/tabpilot/tabpilot.git
cd TabPilot

# Switch to Node.js 22 (reads .nvmrc)
nvm use

# Activate Yarn Berry via Corepack
corepack enable

# Install all workspace dependencies (uses the lockfile — immutable in CI)
yarn install

# Copy environment variable templates for local development
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env

# Start MongoDB in a container (development profile — DB only, no app)
podman compose -f compose.dev.yml up -d

# Start the API (port 3000) and web frontend (port 5173) with hot-reload
yarn dev
```

Open `http://localhost:5173` in your browser. The Vite dev server proxies API requests and WebSocket connections to `http://localhost:3000`.


## 3. Monorepo Structure

Tab Pilot is a Yarn Berry 4 workspaces monorepo. Each workspace has its own `package.json`, TypeScript config, and build pipeline. Workspaces reference each other using the `workspace:*` protocol.

| Workspace | Path | Description |
|-----------|------|-------------|
| `@tabpilot/api` | `apps/api/` | NestJS + Fastify + Socket.io + Mongoose backend |
| `@tabpilot/web` | `apps/web/` | React 19 + Vite + React Router v7 + Zustand frontend |
| `@tabpilot/shared` | `packages/shared/` | Shared TS types (`Session`, `Participant`, DTOs) and `WS_EVENTS` constants |

Both `@tabpilot/api` and `@tabpilot/web` depend on `@tabpilot/shared`. The shared package has no internal dependencies and is the single source of truth for all TypeScript types and WebSocket event name constants.


## 4. Running in Development

### Start everything

```bash
# In one terminal: start MongoDB
podman compose -f compose.dev.yml up -d

# In another terminal: start API + web with hot-reload (concurrently)
yarn dev
```

`yarn dev` runs `nest start --watch` (API) and `vite` (web) simultaneously using `concurrently`, with colour-coded output prefixed `api` and `web`.

### Individual workspace commands

```bash
# API only
yarn workspace @tabpilot/api dev

# Web frontend only
yarn workspace @tabpilot/web dev

# Build shared types (required before building API or web)
yarn workspace @tabpilot/shared build

# Build all workspaces in dependency order
yarn build

# Lint all workspaces
yarn lint

# Clean all build artifacts
yarn clean
```

### Stopping development services

```bash
podman compose -f compose.dev.yml down
```

MongoDB data is persisted in a named volume (`mongo_data_dev`). To wipe it:

```bash
podman compose -f compose.dev.yml down -v
```


## 5. Environment Variables

### API (`apps/api/.env`)

| Variable | Default | Required | Description |
|----------|---------|----------|-------------|
| `PORT` | `3000` | No | Port the NestJS/Fastify server binds to |
| `MONGODB_URI` | `mongodb://localhost:27017/tabpilot` | Yes | Full MongoDB connection URI |
| `FRONTEND_URL` | `http://localhost:5173` | Yes | Allowed CORS origin for HTTP requests. Set to your production frontend domain in deployment. |
| `NODE_ENV` | `development` | No | `development` or `production`. Affects logging and optimizations. |
| `ALLOW_PROXY` | `false` | No | Set to `true` when running behind a trusted reverse proxy. Reads the real client IP from `X-Forwarded-For`/`X-Real-IP` for accurate per-IP rate limiting. Only enable when the proxy is controlled by you. |
| `JIRA_BASE_URL` | | No | Base URL of your Jira instance (e.g. `https://myteam.atlassian.net`). Enables Jira title enrichment and story point sync. |
| `JIRA_USER_EMAIL` | | No | Email address for Jira API authentication (Basic Auth). |
| `JIRA_API_TOKEN` | | No | Jira API token for authentication. |
| `JIRA_STORY_POINTS_FIELDS` | | No | Comma-separated `PROJECT_KEY=field_name` pairs for per-project story point field mapping. |
| `JIRA_EXTRA_FIELDS` | | No | JSON object mapping project keys to extra Jira fields sent alongside story points. |
| `JIRA_TEAM_FIELD` | | No | Custom field id for the Jira Team field. When unset, the Atlassian Team field is discovered automatically and its name is returned with each issue. |
| `GOOGLE_APPLICATION_CREDENTIALS` | | No | Path to a GCP service account JSON key file. Enables AI ticket quality scoring via Gemini. |
| `VERTEX_AI_LOCATION` | `us-central1` | No | Vertex AI region for Gemini API calls. |
| `GEMINI_MODEL` | `gemini-2.5-flash` | No | Gemini model name for ticket scoring. |

**Example `apps/api/.env`:**
```env
PORT=3000
MONGODB_URI=mongodb://localhost:27017/tabpilot
FRONTEND_URL=http://localhost:5173
NODE_ENV=development
JIRA_BASE_URL=https://myteam.atlassian.net
JIRA_USER_EMAIL=user@example.com
JIRA_API_TOKEN=your-api-token
JIRA_STORY_POINTS_FIELDS=PROJ=customfield_10016,OTHER=customfield_10028
GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
VERTEX_AI_LOCATION=us-central1
```

### Web (`apps/web/.env`)

| Variable | Default | Required | Description |
|----------|---------|----------|-------------|
| `VITE_API_URL` | `http://localhost:3000` | Yes | Base URL of the Tab Pilot API. Used by the axios client and Socket.io for all REST and WebSocket communication. |

**Example `apps/web/.env`:**
```env
VITE_API_URL=http://localhost:3000
```

> **Important:** Vite only exposes variables prefixed with `VITE_` to the browser bundle. Never put secrets in `apps/web/.env`.


## 6. API Reference

The API is documented with Swagger/OpenAPI. Swagger is only available when `NODE_ENV` is not `production`. Start the dev server and visit:

```
http://localhost:3000/api-docs
```

All REST endpoints are mounted under the `/api` global prefix. All WebSocket event names and payload interfaces are exported from `@tabpilot/shared` as `WS_EVENTS`.


## 7. Database Schemas

Tab Pilot uses MongoDB 7 with Mongoose. There are three collections: `sessiondocs`, `participantdocs`, and `ticketscoredocs`.

### Session schema (`sessiondocs` collection)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `sessionId` | String | Yes | UUID v4, unique, indexed. Primary identifier used in all API and WS calls. |
| `name` | String | Yes | Human-readable session name set by the host. |
| `joinCode` | String | Yes | 6-character code, unique, indexed. Used by participants to find the session. |
| `hostName` | String | Yes | Display name of the primary host. |
| `hostEmail` | String | No | Optional host email address. |
| `hostKeyHash` | String | Yes | SHA-256 hash of the host key. The plaintext key is never stored. |
| `hostInviteKeyHash` | String | Yes | SHA-256 hash of the co-host invite key. |
| `coHosts` | Array | No | List of co-hosts, each with `keyHash`, `name`, `email?`, and `joinedAt`. |
| `urls` | String[] | Yes | Ordered list of ticket URLs. Up to 50 entries. |
| `currentIndex` | Number | No | 0-based index of the currently active URL. Defaults to `0`. |
| `state` | String | Yes | Session lifecycle state: `'waiting'` → `'active'` → `'ended'`. |
| `votingEnabled` | Boolean | No | Whether story point voting is enabled. Defaults to `false`. Can be toggled mid-session. |
| `isLocked` | Boolean | No | Whether new participants are blocked from joining. Defaults to `false`. |
| `votes` | Array | No | All votes per ticket: `{ urlIndex, participantId, value }`. |
| `revealedIndices` | Number[] | No | URL indices where votes have been revealed. |
| `storyPoints` | Map | No | Saved story point values keyed by URL SHA-256 hash. |
| `expiresAt` | Date | Yes | UTC datetime when the session expires. TTL-indexed for automatic deletion. |
| `createdAt` | Date | Auto | Mongoose `timestamps: true` — creation timestamp. |
| `updatedAt` | Date | Auto | Mongoose `timestamps: true` — last update timestamp. |

### Participant schema (`participantdocs` collection)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `participantId` | String | Yes | UUID v4, unique, indexed. Stored in the browser's `localStorage` for identity persistence. |
| `sessionId` | String | Yes | UUID v4 of the parent session, indexed for efficient lookup. |
| `name` | String | Yes | Display name entered at join time. |
| `email` | String | No | Optional email address. |
| `avatarUrl` | String | Yes | DiceBear Bottts SVG URL generated deterministically from the participant name + a random seed. |
| `socketId` | String | No | Current Socket.io socket ID. Updated on every reconnect to allow targeted emissions. |
| `isOnline` | Boolean | No | Whether the participant currently has an active WebSocket connection. Defaults to `false`. |
| `createdAt` | Date | Auto | Mongoose `timestamps: true` — join timestamp. |
| `updatedAt` | Date | Auto | Mongoose `timestamps: true` — last update timestamp. |


### Ticket score schema (`ticketscoredocs` collection)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `issueKey` | String | Yes | Jira issue key (e.g. `PROJ-123`), unique, indexed. |
| `overall` | Number | Yes | Overall quality score (0–100), average of all six dimensions. |
| `dimensions` | Object | Yes | Six dimension scores, each with `score` (number) and `feedback` (string). Dimensions: `clarity`, `completeness`, `actionability`, `testability`, `formatting`, `context`. |
| `scoredAt` | Date | Yes | Timestamp when the score was generated by Gemini. |

Scores persist indefinitely and are reused across sessions. Hosts can regenerate a score via the UI, which deletes the cached document and triggers a fresh Gemini call.


## 8. Architecture Decisions

### Why Yarn Berry (v4) workspaces?

Yarn Berry's Plug'n'Play resolver eliminates the `node_modules` hoisting problem that causes phantom dependency bugs in classic Yarn and npm. In a monorepo, this is especially valuable: each workspace can only import what it explicitly declares as a dependency. The `workspace:*` protocol gives exact, version-controlled inter-workspace references. Corepack ensures the exact Yarn version declared in `packageManager` is used — no "works on my machine" version drift.

### Why NestJS with Fastify?

NestJS provides a structured, opinionated framework with first-class TypeScript support, a module system that maps cleanly to domain boundaries (sessions, participants, gateway), and built-in support for Socket.io via `@nestjs/websockets`. The Fastify adapter is used instead of the default Express adapter for measurably better throughput and lower memory overhead — particularly important for the WebSocket upgrade path under load.

### Why Socket.io?

Socket.io sits on top of WebSockets and provides automatic reconnection with exponential back-off, room-based broadcasting (each session is a room), and graceful degradation for environments where raw WebSockets are blocked. The reconnect behaviour is critical for Tab Pilot: participants behind corporate proxies or on flaky mobile networks can drop and rejoin without losing session context.

### Why Zustand?

Zustand was chosen over Redux Toolkit for React state management because Tab Pilot's state model is simple and co-located with the Socket.io event handlers. Zustand's minimal boilerplate, direct mutation API (via Immer), and lack of required providers make it straightforward to wire socket events directly to store actions without action creators, reducers, or selectors.

### AI Ticket Quality Scoring

Jira tickets are scored on six quality dimensions (clarity, completeness, actionability, testability, formatting, context) using Google's Gemini Flash model via Vertex AI. The feature is opt-in — it only activates when `GOOGLE_APPLICATION_CREDENTIALS` points to a valid GCP service account JSON key file with Vertex AI API access.

**Flow:**
1. Frontend calls `GET /api/ticket-score/:key` for each Jira ticket
2. Backend checks MongoDB for a cached score — returns immediately if found
3. If no cache: fetches the full Jira issue description via the Jira API, sends it to Gemini with a structured scoring prompt, parses the JSON response, stores it in MongoDB, and returns it
4. Hosts can regenerate scores via a refresh button, which calls `DELETE /api/ticket-score/:key` to clear the cache, then re-fetches

**Frontend components:**
- `TicketScoreBadge` — colored score badge (green/amber/red) shown next to ticket titles in the URL queue
- `TicketScoreBreakdown` — expandable comparison strip with per-dimension scores and feedback, shown on the current ticket panel
- `usePrefetchTicketScores` — prefetches scores for all session tickets in parallel on page load; new tickets added mid-session load lazily
- `useTicketScoreStatus` — checks if scoring is configured; UI components only render when `configured: true`

**Configuration:**
- `GOOGLE_APPLICATION_CREDENTIALS` — path to GCP service account JSON key file (project ID read automatically)
- `VERTEX_AI_LOCATION` — Vertex AI region (default: `us-central1`)
- `GEMINI_MODEL` — model name (default: `gemini-2.5-flash`)

### Why RHEL UBI9 as the base image?

Red Hat Universal Base Images are freely redistributable, enterprise-hardened, and receive timely CVE patches. Using `ubi9/nodejs-22` as the build base and `ubi9/nodejs-22-minimal` as the production runner reduces the attack surface while ensuring the image is compatible with OpenShift and other enterprise container platforms. The minimal variant strips out package managers and other tooling not needed at runtime, cutting the final image size significantly. The production container runs as UID 1001 (non-root), which is a requirement in most enterprise Kubernetes deployments.


## 9. Testing

### Running tests

```bash
# Run all tests
yarn test:api                   # Jest (NestJS/API)
yarn test:web                   # Vitest (React/web)

# Single file
yarn workspace @tabpilot/api test -- session.gateway.spec.ts
yarn workspace @tabpilot/web test -- src/pages/HostDashboard.test.tsx

# Watch modes
yarn workspace @tabpilot/api test:watch
yarn workspace @tabpilot/web test:watch

# Coverage
yarn workspace @tabpilot/api test:cov
```

### What is tested

**Backend (Jest + ts-jest):**
- **Sessions service** — session creation, host key hashing and validation, state transitions, join code uniqueness
- **Participants service** — participant creation, avatar URL generation, online status tracking, socket ID updates
- **Sessions controller** — HTTP request/response shapes, 404 handling for unknown sessions and join codes
- **Session gateway** — all WebSocket event handlers, voting flows, navigation, profile updates, co-host operations
- **DTOs** — `class-validator` constraint enforcement (URL validation, array size limits, expiry range)
- **Jira service** — issue fetching, description extraction (ADF to plain text), SSRF validation, story point updates
- **Ticket score service** — Gemini integration, MongoDB caching, cache invalidation, error handling

**Frontend (Vitest + Testing Library):**
- **Page components** — HostDashboard, ParticipantView, CreateSession, JoinSession, HostJoin, Home
- **Hooks** — useSocket event handling, useSession lifecycle, useHostActions
- **Store** — Zustand state transitions, localStorage persistence
- **Score components** — TicketScoreBadge color coding, TicketScoreBreakdown expand/collapse, regenerate button, localStorage persistence

### E2E tests

BrowserStack-based end-to-end tests run via the `e2e.yml` GitHub Actions workflow.


## 10. Building for Production

### Build all workspaces

```bash
yarn build
```

This runs `yarn workspaces foreach -t run build`, which respects the topological dependency order: `@tabpilot/shared` builds first, then `@tabpilot/api` and `@tabpilot/web` in parallel.

### Containerfile stages

The `Containerfile` uses an 8-stage build:

| Stage | Base | Purpose |
|-------|------|---------|
| `deps` | `ubi9/nodejs-22` | Install all workspace dependencies with `yarn install --immutable` (includes `apps/docs`) |
| `shared-builder` | `deps` | Build `@tabpilot/shared` |
| `web-builder` | `shared-builder` | Build the React frontend with Vite (`tsc && vite build`) |
| `docs-builder` | `deps` | Build the Docusaurus docs site — branches from `deps`, independent of other builders |
| `api-builder` | `shared-builder` | Build the NestJS API; copies web dist for static file serving |
| `prod-deps` | `deps` | Install production-only dependencies (strips dev deps) |
| `runner` | `ubi9/nodejs-22-minimal` | Default production image — compiled outputs, prod deps, runs as UID 1001 |
| `runner-with-docs` | `runner` | `runner` + Docusaurus output copied into `apps/web/dist/docs/` |

The runner stage copies:
- `apps/api/dist` — compiled NestJS application
- `apps/web/dist` — compiled React static assets (served by the API in production)
- `packages/shared/dist` — compiled shared types

### Build and run with Podman Compose

```bash
# Build the container image from source and start the stack
podman compose up --build -d

# Build the with-docs variant
podman build --target runner-with-docs -t tabpilot:latest-docs .

# Watch logs
podman compose logs -f app

# Stop everything
podman compose down

# Stop and remove the MongoDB volume (data wipe)
podman compose down -v
```

### Build multi-arch images manually

```bash
# Build for the current platform (default, no-docs)
podman build -f Containerfile -t tabpilot:local .

# Build the with-docs variant for the current platform
podman build --target runner-with-docs -f Containerfile -t tabpilot:local-docs .

# Build for a specific platform
podman build --platform linux/amd64 -f Containerfile -t tabpilot:amd64 .
podman build --platform linux/arm64 -f Containerfile -t tabpilot:arm64 .
```

Multi-arch manifest builds for GHCR are handled by the `publish.yml` GitHub Actions workflow using Buildah and `redhat-actions/push-to-registry`.


## 11. Contributing

Please read the [Contributing Guide](../.github/CONTRIBUTING.md) for branch naming conventions, commit message format, the PR process, and code style guidelines.
