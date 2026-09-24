---
sidebar_position: 2
title: Jira Integration
---

# Jira Integration

Tab Pilot can connect to your Jira instance to:

1. **Enrich ticket titles** — when a Jira URL is added to the queue, Tab Pilot fetches and displays the issue summary automatically
2. **Save story points** — after a voting round, the host can write the agreed estimate back to the Jira ticket with one click
3. **Per-project field mapping** — story points live in different custom fields depending on your Jira configuration; Tab Pilot maps per project

## Prerequisites

- A Jira Cloud account (or Jira Data Center with accessible API)
- A Jira API token

### Generate a Jira API Token

1. Go to [https://id.atlassian.com/manage-profile/security/api-tokens](https://id.atlassian.com/manage-profile/security/api-tokens)
2. Click **Create API token**
3. Give it a label (e.g., `tab-pilot`) and copy the token value
4. Store it securely — it is only shown once

## Basic Configuration

Set these three environment variables to enable Jira integration:

```bash
JIRA_BASE_URL=https://myteam.atlassian.net
JIRA_USER_EMAIL=bot@myteam.com
JIRA_API_TOKEN=ATATT3xFfGF0...
```

With just these three variables set, Tab Pilot will:
- Automatically resolve Jira URLs in the queue to display the issue summary
- Allow the host to see ticket titles without leaving Tab Pilot
- Read each issue's team name, when the Jira site has a Team field

## Filtering the queue by team

Issue metadata includes the team name. In the host ticket queue, a **Team** menu lists the teams on the current tickets. Choosing a team shows only that team's Jira issues. **No team** shows Jira issues that have no team. **All teams** shows the full queue.

Tab Pilot finds the Team field by itself (the Atlassian Team custom field, or a field named Team). If that lookup picks the wrong field, set its id explicitly:

```bash
JIRA_TEAM_FIELD=customfield_10001
```

Find the id the same way as a story-points field: `GET /rest/api/3/field` and look for the field whose name is Team. The value must be an object with a `name` (or `title`). A field that returns only a team id is ignored.

## Story Point Sync

To enable saving story point estimates back to Jira, you must tell Tab Pilot which Jira custom field stores story points for each project.

### Why is this needed?

Jira uses custom fields for story points, and the field ID varies by Jira instance configuration. Common field IDs are `customfield_10016` (Story Points) or `customfield_10028` (Story point estimate), but your instance may differ.

### Finding Your Story Points Field ID

**Option 1: Via the Jira API**

```bash
curl -u your-email@company.com:YOUR_API_TOKEN \
  "https://myteam.atlassian.net/rest/api/3/field" \
  | jq '.[] | select(.name | contains("story") or contains("Story") or contains("point") or contains("Point")) | {id, name}'
```

**Option 2: Via Jira Settings**

1. Go to **Jira Settings → Issues → Custom Fields**
2. Find the field named "Story Points" or "Story point estimate"
3. Click the field and look at the URL — it contains the field ID (e.g., `customfield_10016`)

**Option 3: Check the issue JSON**

```bash
curl -u your-email@company.com:YOUR_API_TOKEN \
  "https://myteam.atlassian.net/rest/api/3/issue/PROJ-1" \
  | jq '.fields | keys[] | select(startswith("customfield"))'
```

### Setting the Field Mapping

Set `JIRA_STORY_POINTS_FIELDS` as a comma-separated list of `PROJECT_KEY=field_id` pairs:

```bash
# Single project
JIRA_STORY_POINTS_FIELDS=PROJ=customfield_10016

# Multiple projects with different field IDs
JIRA_STORY_POINTS_FIELDS=PROJ=customfield_10016,BACKEND=customfield_10028,MOBILE=customfield_10016
```

:::note
If a project key is not in the mapping, Tab Pilot will still fetch the title but the "Save to Jira" button will be disabled for tickets in that project.
:::

## Extra Fields (Advanced)

The `JIRA_EXTRA_FIELDS` variable lets you include additional Jira fields alongside story points when saving — for example, setting the sprint field at the same time.

The value is a JSON object mapping project keys to field objects:

```bash
JIRA_EXTRA_FIELDS={"PROJ":{"customfield_10020":{"id":"12345"}},"OTHER":{"customfield_10020":{"id":"67890"}}}
```

Each inner object is merged into the Jira update request body. This is useful for:
- Setting sprint assignments
- Updating labels or components alongside the story point save
- Any other Jira field that should be updated as part of the grooming workflow

## Skip Extra Fields Toggle

When `JIRA_EXTRA_FIELDS` is configured, hosts see a **"Skip extra fields"** toggle in the host dashboard. When enabled, the extra fields are omitted from the save request — useful when grooming tickets that aren't yet assigned to a sprint, to avoid overwriting sprint data.

The toggle is off by default (extra fields are always included).

## Testing the Integration

After setting the variables and restarting the app, add a Jira URL to a session queue. The issue summary should appear in the URL list within a few seconds.

If the title does not appear:

```bash
# Check the app logs for Jira API errors
docker compose logs app | grep -i jira
```

Common errors:
- `401 Unauthorized` — incorrect email or API token
- `403 Forbidden` — the API token user lacks read permission on the project
- `Connection refused` — `JIRA_BASE_URL` is incorrect or unreachable from the container

## Data Center / Server Notes

Tab Pilot uses the Jira Cloud REST API v3. For **Jira Data Center** or **Jira Server**:
- The API base path is the same (`/rest/api/3/`) on recent versions
- Authentication uses the same Basic Auth with email + API token
- Ensure the `JIRA_BASE_URL` is the root URL of your Data Center instance (e.g., `https://jira.mycompany.internal`)
- The container must have network access to reach the Jira host
