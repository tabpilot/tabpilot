---
sidebar_position: 1
title: Environment Variables
---

# Environment Variables

All Tab Pilot configuration is done through environment variables passed to the `app` container (or set in `apps/api/.env` when running locally).

## Core Variables

| Variable | Default | Required | Description |
|---|---|---|---|
| `PORT` | `3000` | No | Port the server binds to |
| `MONGODB_URI` | `mongodb://localhost:27017/tabpilot` | Yes | MongoDB connection string |
| `FRONTEND_URL` | `http://localhost:5173` | Yes | Allowed CORS origin — **must match the public URL** your users access |
| `NODE_ENV` | `development` | No | Set to `production` in deployed environments |
| `ALLOW_PROXY` | `false` | No | Set to `true` when the API runs behind a trusted reverse proxy. Reads the real client IP from `X-Forwarded-For`/`X-Real-IP` for accurate per-IP rate limiting |

:::warning ALLOW_PROXY security note
Only set `ALLOW_PROXY=true` when the API is behind a reverse proxy you control (nginx, HAProxy, OpenShift route). If the API is directly internet-facing, clients can spoof `X-Forwarded-For` to bypass rate limiting.
:::

:::warning FRONTEND_URL is critical
This value is the CORS allowed origin for the API and Socket.io. If it does not match the domain in the browser address bar exactly (including `https://`), all real-time connections will fail. In production, set this to your full public URL, e.g. `https://tabpilot.example.com`.
:::

## Jira Integration Variables

| Variable | Default | Required | Description |
|---|---|---|---|
| `JIRA_BASE_URL` | — | No | Your Jira instance base URL, e.g. `https://myteam.atlassian.net`. When set, enables ticket title enrichment and story point sync |
| `JIRA_USER_EMAIL` | — | No | Email address of the Jira user used for API authentication |
| `JIRA_API_TOKEN` | — | No | Jira API token for Basic Auth. Generate one at [id.atlassian.com](https://id.atlassian.com/manage-profile/security/api-tokens) |
| `JIRA_STORY_POINTS_FIELDS` | — | No | Comma-separated `PROJECT_KEY=field_name` pairs, e.g. `PROJ=customfield_10016,OTHER=customfield_10028`. Maps each project to its story points custom field |
| `JIRA_EXTRA_FIELDS` | — | No | JSON object mapping project keys to additional Jira fields to include when saving story points (e.g. sprint field). See [Jira Integration](./jira-integration.md) |
| `JIRA_TEAM_FIELD` | — | No | Jira custom field id for the Team field, e.g. `customfield_10001`. When unset, Tab Pilot discovers the Atlassian Team field and returns its name with each issue |

See [Jira Integration](./jira-integration.md) for the full setup guide.

## AI Ticket Scoring Variables

| Variable | Default | Required | Description |
|---|---|---|---|
| `GOOGLE_APPLICATION_CREDENTIALS` | — | No | Absolute path to a GCP service account JSON key file. When set, enables AI ticket scoring via Vertex AI |
| `VERTEX_AI_LOCATION` | `us-central1` | No | Google Cloud region for the Vertex AI API |
| `GEMINI_MODEL` | `gemini-2.5-flash` | No | Gemini model identifier to use for ticket quality scoring |

See [AI Ticket Scoring](./ai-ticket-scoring.md) for setup instructions including service account creation.

## Example .env File (Local Development)

```bash
# apps/api/.env

MONGODB_URI=mongodb://localhost:27017/tabpilot
FRONTEND_URL=http://localhost:5173
PORT=3000

# Optional — Jira integration
JIRA_BASE_URL=https://myteam.atlassian.net
JIRA_USER_EMAIL=me@myteam.com
JIRA_API_TOKEN=ATATT3x...

# Optional — AI ticket scoring
GOOGLE_APPLICATION_CREDENTIALS=/Users/me/keys/gcp-sa.json
VERTEX_AI_LOCATION=us-central1
```

## Example Environment Block (Production compose.yml)

```yaml
  app:
    image: ghcr.io/tabpilot/tabpilot:latest
    environment:
      - NODE_ENV=production
      - PORT=3000
      - MONGODB_URI=mongodb://mongodb:27017/tabpilot
      - FRONTEND_URL=https://tabpilot.example.com
      - JIRA_BASE_URL=https://myteam.atlassian.net
      - JIRA_USER_EMAIL=bot@myteam.com
      - JIRA_API_TOKEN=ATATT3x...
      - JIRA_STORY_POINTS_FIELDS=PROJ=customfield_10016
      - GOOGLE_APPLICATION_CREDENTIALS=/secrets/gcp-sa.json
      - VERTEX_AI_LOCATION=us-central1
      - ALLOW_PROXY=true
```

## Security Recommendations

:::danger Never commit secrets
Do not commit `.env` files or JSON key files to your repository. Use:
- `.gitignore` to exclude `.env` files
- Docker secrets (`docker secret create`) for sensitive values in Swarm mode
- CI/CD environment variable injection (GitHub Actions secrets, GitLab CI variables) for automated deployments
- A secrets manager (Vault, AWS Secrets Manager, GCP Secret Manager) for production
:::

For the `GOOGLE_APPLICATION_CREDENTIALS` key file, mount it as a read-only volume rather than baking it into the image:

```yaml
    volumes:
      - /path/to/gcp-sa.json:/secrets/gcp-sa.json:ro
    environment:
      - GOOGLE_APPLICATION_CREDENTIALS=/secrets/gcp-sa.json
```
