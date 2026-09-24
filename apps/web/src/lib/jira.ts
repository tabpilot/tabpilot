import apiClient from './api';

// ─── URL parsing ──────────────────────────────────────────────────────────────

export interface JiraUrlInfo {
  key: string; // e.g. "CONNCERT-2771"
  baseUrl: string; // e.g. "https://myorg.atlassian.net"
}

/**
 * Returns the Jira issue key if the URL is an Atlassian Jira URL, else null.
 * Supports both *.atlassian.net/browse/KEY and *.atlassian.net/jira/software/.../issues/KEY
 */
export function parseJiraUrl(url: string): JiraUrlInfo | null {
  try {
    const parsed = new URL(url);
    // Exact match to prevent bypasses like "evilatlassian.net" or "atlassian.net.evil.com"
    if (parsed.hostname !== 'atlassian.net' && !parsed.hostname.endsWith('.atlassian.net'))
      return null;

    const baseUrl = parsed.origin;

    // /browse/PROJ-123
    const browseMatch = /\/browse\/([A-Z][A-Z0-9_]*-\d+)/i.exec(parsed.pathname);
    if (browseMatch) return { key: browseMatch[1].toUpperCase(), baseUrl };

    // /jira/.../issues/PROJ-123
    const issuesMatch = /\/issues\/([A-Z][A-Z0-9_]*-\d+)/i.exec(parsed.pathname);
    if (issuesMatch) return { key: issuesMatch[1].toUpperCase(), baseUrl };

    return null;
  } catch {
    return null;
  }
}

// ─── API ──────────────────────────────────────────────────────────────────────

export interface JiraIssue {
  key: string;
  summary: string;
  status: string;
  issueType: string;
  /** Display name of the Jira team, when the issue has one. */
  team?: string | null;
}

export async function fetchJiraIssue(key: string, baseUrl?: string): Promise<JiraIssue> {
  const params = baseUrl ? { baseUrl } : undefined;
  const res = await apiClient.get<JiraIssue>(`/jira/issue/${key}`, { params });
  return res.data;
}

export interface JiraStatus {
  configured: boolean;
  /** Project keys that have a story-points field configured, e.g. ["CONNCERT"] */
  storyPointProjects: string[];
  /** True when JIRA_EXTRA_FIELDS is configured on the server. */
  hasExtraFields: boolean;
}

export async function fetchJiraStatus(): Promise<JiraStatus> {
  const res = await apiClient.get<JiraStatus>('/jira/status');
  return res.data;
}

/** Returns true when the Jira URL's project has a story-points field configured. */
export function isStoryPointConfigured(url: string, storyPointProjects: string[]): boolean {
  const info = parseJiraUrl(url);
  if (!info) return false;
  const projectKey = info.key.split('-')[0].toUpperCase();
  return storyPointProjects.includes(projectKey);
}

// ─── Display formatting ───────────────────────────────────────────────────────

/** Formats a Jira issue for display: "Fix login bug (CONNCERT-2771)" */
export function formatJiraTitle(issue: JiraIssue): string {
  return `${issue.summary} (${issue.key})`;
}

export async function updateJiraStoryPoints(
  key: string,
  points: number,
  hostKey: string,
  sessionId: string,
  baseUrl?: string,
  skipExtraFields = true,
): Promise<void> {
  await apiClient.patch(`/jira/issue/${key}/story-points`, {
    points,
    hostKey,
    sessionId,
    baseUrl,
    skipExtraFields,
  });
}
