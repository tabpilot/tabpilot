import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';

// Jira issue keys are strictly PROJECT-NUMBER (e.g. CONNCERT-2771).
// Validating before interpolation prevents path traversal / SSRF.
const ISSUE_KEY_RE = /^[A-Z][A-Z0-9_]*-\d+$/i;

export interface JiraIssue {
  key: string;
  summary: string;
  status: string;
  issueType: string;
  /** Display name of the Jira team, or null when the issue has none. */
  team: string | null;
}

export interface JiraIssueWithDescription extends JiraIssue {
  description: string;
}

function adfToPlainText(node: unknown): string {
  if (!node || typeof node !== 'object') return '';
  const n = node as { type?: string; text?: string; content?: unknown[] };
  if (n.type === 'text' && typeof n.text === 'string') return n.text;
  if (!Array.isArray(n.content)) return '';
  const childText = n.content.map(adfToPlainText).join('');
  if (n.type === 'paragraph' || n.type === 'heading') return `${childText}\n`;
  if (n.type === 'listItem') return `- ${childText}`;
  if (n.type === 'hardBreak') return '\n';
  return childText;
}

/** Atlassian Team and Advanced Roadmaps team custom-field types. */
const TEAM_FIELD_TYPES = new Set([
  'com.atlassian.jira.plugin.system.customfieldtypes:atlassian-team',
  'com.atlassian.teams:rm-teams-custom-field-team',
]);

/** Field ids are interpolated into the Jira fields query, so keep them to a token. */
const TEAM_FIELD_ID_RE = /^[A-Za-z][A-Za-z0-9_]*$/;

/** Old team fields sometimes return only a team id. That is not a display name. */
const TEAM_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface JiraFieldDescriptor {
  id?: unknown;
  name?: unknown;
  schema?: { custom?: unknown };
}

function pickTeamFieldId(body: unknown): string | null {
  if (!Array.isArray(body)) return null;

  const usable = body.filter((item): item is JiraFieldDescriptor => {
    if (!item || typeof item !== 'object') return false;
    const id = (item as JiraFieldDescriptor).id;
    return typeof id === 'string' && TEAM_FIELD_ID_RE.test(id);
  });

  const byType = usable.filter((field) => {
    const custom = field.schema?.custom;
    return typeof custom === 'string' && TEAM_FIELD_TYPES.has(custom);
  });

  const named = (fields: JiraFieldDescriptor[]) =>
    fields.find((field) => field.name === 'Team') ?? fields[0];

  const chosen = byType.length > 0 ? named(byType) : usable.find((field) => field.name === 'Team');
  return typeof chosen?.id === 'string' ? chosen.id : null;
}

function readTeamName(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed || TEAM_ID_RE.test(trimmed)) return null;
    return trimmed;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const name = readTeamName(item);
      if (name) return name;
    }
    return null;
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    for (const key of ['name', 'title', 'value', 'displayName']) {
      if (typeof record[key] !== 'string') continue;
      const name = readTeamName(record[key]);
      if (name) return name;
    }
  }
  return null;
}

function isAtlassianHost(urlStr: string): boolean {
  try {
    const { hostname, protocol } = new URL(urlStr);
    return (
      protocol === 'https:' && (hostname === 'atlassian.net' || hostname.endsWith('.atlassian.net'))
    );
  } catch {
    return false;
  }
}

@Injectable()
export class JiraService {
  private readonly logger = new Logger(JiraService.name);
  /** Team custom-field id per Jira origin. Null means the instance has no team field. */
  private readonly teamFieldIdByBase = new Map<string, string | null>();

  private get baseUrl(): string | undefined {
    return process.env.JIRA_BASE_URL?.replace(/\/$/, '');
  }

  private get email(): string | undefined {
    return process.env.JIRA_USER_EMAIL;
  }

  private get token(): string | undefined {
    return process.env.JIRA_API_TOKEN;
  }

  get isConfigured(): boolean {
    return !!(this.email && this.token);
  }

  private resolveBaseUrl(provided?: string): string {
    if (this.baseUrl) {
      if (provided && provided.replace(/\/$/, '') !== this.baseUrl) {
        throw new BadRequestException(
          `Provided baseUrl does not match the configured JIRA_BASE_URL.`,
        );
      }
      return this.baseUrl;
    }
    if (provided) {
      // No JIRA_BASE_URL configured — only *.atlassian.net is permitted as a fallback.
      // Self-hosted instances must be declared via JIRA_BASE_URL.
      if (!isAtlassianHost(provided)) {
        throw new BadRequestException(
          'No JIRA_BASE_URL is configured. Provide an https://*.atlassian.net URL, or set JIRA_BASE_URL for a self-hosted instance.',
        );
      }
      return provided.replace(/\/$/, '');
    }
    throw new ServiceUnavailableException(
      'Jira base URL not configured. Set JIRA_BASE_URL or provide a baseUrl parameter.',
    );
  }

  private assertAllowedUrl(url: string): string {
    let hostname: string;
    let protocol: string;
    try {
      ({ hostname, protocol } = new URL(url));
    } catch {
      throw new BadRequestException('Invalid Jira URL.');
    }

    if (protocol !== 'https:') {
      throw new BadRequestException('Jira URL must use HTTPS.');
    }

    if (this.baseUrl) {
      const allowedHost = new URL(this.baseUrl).hostname;
      if (hostname !== allowedHost) {
        throw new BadRequestException(
          `Jira request host must match the configured JIRA_BASE_URL (${allowedHost}).`,
        );
      }
      return url;
    }

    if (hostname !== 'atlassian.net' && !hostname.endsWith('.atlassian.net')) {
      throw new BadRequestException('Jira URL must be an https://*.atlassian.net address.');
    }
    return url;
  }

  /** Project keys that have a story-points field configured (from JIRA_STORY_POINTS_FIELDS). */
  get configuredStoryPointProjects(): string[] {
    return Array.from(this.getStoryPointsFieldMap().keys());
  }

  /** True when JIRA_EXTRA_FIELDS is set and contains at least one entry. */
  get hasExtraFieldsConfigured(): boolean {
    return this.getExtraFieldsMap().size > 0;
  }

  /**
   * Parse JIRA_STORY_POINTS_FIELDS env var into a project-key → field-name map.
   * Format: "PROJKEY=fieldName,PROJKEY2=fieldName2"
   * e.g. "CONNCERT=customfield_10016,PAD=story_points"
   */
  private getStoryPointsFieldMap(): Map<string, string> {
    const raw = process.env.JIRA_STORY_POINTS_FIELDS ?? '';
    const map = new Map<string, string>();
    for (const entry of raw.split(',')) {
      const eqIdx = entry.indexOf('=');
      if (eqIdx === -1) continue;
      const proj = entry.slice(0, eqIdx).trim().toUpperCase();
      const field = entry.slice(eqIdx + 1).trim();
      if (proj && field) map.set(proj, field);
    }
    return map;
  }

  /**
   * Parse JIRA_EXTRA_FIELDS env var — a JSON object mapping project keys to
   * field/value pairs that are sent alongside story points.
   *
   * Format: {"PROJKEY":{"fieldName":value},"PROJKEY2":{"fieldName2":value2}}
   * e.g.   {"CONNCERT":{"customfield_10517":{"id":"10852"}}}
   */
  private getExtraFieldsMap(): Map<string, Record<string, unknown>> {
    const raw = process.env.JIRA_EXTRA_FIELDS?.trim();
    if (!raw) return new Map();
    try {
      const parsed = JSON.parse(raw) as Record<string, Record<string, unknown>>;
      const map = new Map<string, Record<string, unknown>>();
      for (const [proj, fields] of Object.entries(parsed)) {
        if (fields && typeof fields === 'object' && !Array.isArray(fields)) {
          map.set(proj.toUpperCase(), fields);
        }
      }
      return map;
    } catch {
      this.logger.warn('JIRA_EXTRA_FIELDS is not valid JSON — ignored.');
      return new Map();
    }
  }

  /**
   * Team field id from JIRA_TEAM_FIELD, or discovered from the Jira field list.
   * Discovery is cached per base URL. Failures omit the team rather than failing the issue fetch.
   */
  private async resolveTeamFieldId(base: string, auth: string): Promise<string | null> {
    const configured = process.env.JIRA_TEAM_FIELD?.trim();
    if (configured) {
      if (!TEAM_FIELD_ID_RE.test(configured)) {
        this.logger.warn('JIRA_TEAM_FIELD is not a valid field id — ignored.');
      } else {
        return configured;
      }
    }

    const cached = this.teamFieldIdByBase.get(base);
    if (cached !== undefined) return cached;

    try {
      const url = this.assertAllowedUrl(`${base}/rest/api/3/field`);
      const res = await fetch(url, {
        headers: {
          Authorization: `Basic ${auth}`,
          Accept: 'application/json',
        },
      });
      if (!res.ok) {
        this.logger.warn(
          `Jira field list returned HTTP ${res.status}; team names will be omitted.`,
        );
        this.teamFieldIdByBase.set(base, null);
        return null;
      }
      const id = pickTeamFieldId(await res.json());
      this.teamFieldIdByBase.set(base, id);
      return id;
    } catch (err) {
      this.logger.warn(`Could not resolve Jira team field: ${err}`);
      this.teamFieldIdByBase.set(base, null);
      return null;
    }
  }

  private async fieldsQuery(
    base: string,
    auth: string,
    fields: string[],
  ): Promise<{ query: string; teamFieldId: string | null }> {
    const teamFieldId = await this.resolveTeamFieldId(base, auth);
    const all = teamFieldId ? [...fields, teamFieldId] : fields;
    return { query: all.join(','), teamFieldId };
  }

  private teamFromFields(
    fields: Record<string, unknown> | undefined,
    teamFieldId: string | null,
  ): string | null {
    if (!teamFieldId || !fields) return null;
    return readTeamName(fields[teamFieldId]);
  }

  async getIssue(issueKey: string, providedBaseUrl?: string): Promise<JiraIssue> {
    if (!ISSUE_KEY_RE.test(issueKey)) {
      throw new BadRequestException('Invalid Jira issue key.');
    }
    if (!this.isConfigured) {
      throw new ServiceUnavailableException(
        'Jira integration is not configured. Set JIRA_USER_EMAIL and JIRA_API_TOKEN.',
      );
    }

    const resolvedBase = this.resolveBaseUrl(providedBaseUrl);
    const auth = Buffer.from(`${this.email}:${this.token}`).toString('base64');
    const { query, teamFieldId } = await this.fieldsQuery(resolvedBase, auth, [
      'summary',
      'status',
      'issuetype',
    ]);
    const url = this.assertAllowedUrl(
      `${resolvedBase}/rest/api/3/issue/${issueKey}?fields=${query}`,
    );

    let res: Response;
    try {
      res = await fetch(url, {
        headers: {
          Authorization: `Basic ${auth}`,
          Accept: 'application/json',
        },
      });
    } catch (err) {
      this.logger.error(`Failed to reach Jira at ${resolvedBase}: ${err}`);
      throw new ServiceUnavailableException('Could not reach Jira instance.');
    }

    if (res.status === 401) {
      throw new ServiceUnavailableException(
        'Jira authentication failed. Check JIRA_USER_EMAIL and JIRA_API_TOKEN.',
      );
    }
    if (res.status === 404) {
      throw new NotFoundException(`Jira issue ${issueKey} not found.`);
    }
    if (!res.ok) {
      throw new ServiceUnavailableException(`Jira returned HTTP ${res.status}.`);
    }

    const data = (await res.json()) as {
      fields: { summary: string; status: { name: string }; issuetype: { name: string } };
    };

    return {
      key: issueKey,
      summary: data.fields?.summary ?? issueKey,
      status: data.fields?.status?.name ?? 'Unknown',
      issueType: data.fields?.issuetype?.name ?? 'Issue',
      team: this.teamFromFields(data.fields as Record<string, unknown> | undefined, teamFieldId),
    };
  }

  async getIssueWithDescription(
    issueKey: string,
    providedBaseUrl?: string,
  ): Promise<JiraIssueWithDescription> {
    if (!ISSUE_KEY_RE.test(issueKey)) {
      throw new BadRequestException('Invalid Jira issue key.');
    }
    if (!this.isConfigured) {
      throw new ServiceUnavailableException(
        'Jira integration is not configured. Set JIRA_USER_EMAIL and JIRA_API_TOKEN.',
      );
    }

    const resolvedBase = this.resolveBaseUrl(providedBaseUrl);
    const auth = Buffer.from(`${this.email}:${this.token}`).toString('base64');
    const { query, teamFieldId } = await this.fieldsQuery(resolvedBase, auth, [
      'summary',
      'description',
      'status',
      'issuetype',
    ]);
    const url = this.assertAllowedUrl(
      `${resolvedBase}/rest/api/3/issue/${issueKey}?fields=${query}`,
    );

    let res: Response;
    try {
      res = await fetch(url, {
        headers: {
          Authorization: `Basic ${auth}`,
          Accept: 'application/json',
        },
      });
    } catch (err) {
      this.logger.error(`Failed to reach Jira at ${resolvedBase}: ${err}`);
      throw new ServiceUnavailableException('Could not reach Jira instance.');
    }

    if (res.status === 401) {
      throw new ServiceUnavailableException(
        'Jira authentication failed. Check JIRA_USER_EMAIL and JIRA_API_TOKEN.',
      );
    }
    if (res.status === 404) {
      throw new NotFoundException(`Jira issue ${issueKey} not found.`);
    }
    if (!res.ok) {
      throw new ServiceUnavailableException(`Jira returned HTTP ${res.status}.`);
    }

    const data = (await res.json()) as {
      fields: {
        summary: string;
        description: unknown;
        status: { name: string };
        issuetype: { name: string };
      };
    };

    return {
      key: issueKey,
      summary: data.fields?.summary ?? issueKey,
      description: adfToPlainText(data.fields?.description),
      status: data.fields?.status?.name ?? 'Unknown',
      issueType: data.fields?.issuetype?.name ?? 'Issue',
      team: this.teamFromFields(data.fields as Record<string, unknown> | undefined, teamFieldId),
    };
  }

  /**
   * Write a story-points value to a Jira issue.
   * The field name is looked up per project key from JIRA_STORY_POINTS_FIELDS env var.
   */
  async setStoryPoints(
    issueKey: string,
    points: number,
    providedBaseUrl?: string,
    skipExtraFields = false,
  ): Promise<void> {
    if (!ISSUE_KEY_RE.test(issueKey)) {
      throw new BadRequestException('Invalid Jira issue key.');
    }
    if (!this.isConfigured) {
      throw new ServiceUnavailableException(
        'Jira integration is not configured. Set JIRA_USER_EMAIL and JIRA_API_TOKEN.',
      );
    }

    const resolvedBase = this.resolveBaseUrl(providedBaseUrl);

    // Derive project key from issue key (e.g. "CONNCERT" from "CONNCERT-3114")
    const projectKey = issueKey.split('-')[0].toUpperCase();
    const fieldMap = this.getStoryPointsFieldMap();
    const fieldName = fieldMap.get(projectKey);
    if (!fieldName) {
      throw new BadRequestException(
        `Story points field not configured for project ${projectKey}. Add it to JIRA_STORY_POINTS_FIELDS.`,
      );
    }

    const auth = Buffer.from(`${this.email}:${this.token}`).toString('base64');
    const url = this.assertAllowedUrl(`${resolvedBase}/rest/api/3/issue/${issueKey}`);

    const fields: Record<string, unknown> = { [fieldName]: points };

    if (!skipExtraFields) {
      const extraFields = this.getExtraFieldsMap().get(projectKey);
      if (extraFields) {
        Object.assign(fields, extraFields);
      }
    }

    let res: Response;
    try {
      res = await fetch(url, {
        method: 'PUT',
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ fields }),
      });
    } catch (err) {
      this.logger.error(`Failed to reach Jira at ${resolvedBase}: ${err}`);
      throw new ServiceUnavailableException('Could not reach Jira instance.');
    }

    if (res.status === 401) {
      throw new ServiceUnavailableException(
        'Jira authentication failed. Check JIRA_USER_EMAIL and JIRA_API_TOKEN.',
      );
    }
    if (res.status === 404) {
      throw new NotFoundException(`Jira issue ${issueKey} not found.`);
    }
    if (res.status === 400) {
      const body = await res.text().catch(() => '');
      this.logger.warn(`Jira rejected story points update for ${issueKey}: ${body}`);
      throw new UnprocessableEntityException(
        `Jira rejected the story points value. Check that "${fieldName}" is the correct field for project ${projectKey}.`,
      );
    }
    if (!res.ok) {
      throw new ServiceUnavailableException(`Jira returned HTTP ${res.status}.`);
    }
  }
}
