import { lookup } from 'node:dns/promises';
import * as fs from 'node:fs';
import { isIP } from 'node:net';
import { GoogleGenAI } from '@google/genai';
import {
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { TicketScore } from '@tabpilot/shared';
import type { Model } from 'mongoose';
import { TicketScoreDoc } from './ticket-score.schema';

function isPrivateAddress(ip: string): boolean {
  const stripped = ip.replace(/^\[|\]$/g, '');
  return (
    /^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|127\.|169\.254\.)/.test(stripped) ||
    /^(::1$|fe80:|fc|fd|::ffff:)/i.test(stripped)
  );
}

const SCORING_PROMPT = `You are a Jira ticket quality assessor for engineering grooming sessions.
Score this ticket on six dimensions from 0 to 100.

Dimensions:
1. Clarity — Is the ticket easy to understand? Are requirements unambiguous?
2. Completeness — Does it contain all necessary information? (description, acceptance criteria, dependencies, edge cases)
3. Actionability — Can a developer start working immediately without asking follow-up questions?
4. Testability — Are success criteria defined and verifiable? Can QA write test cases from this?
5. Formatting — Is the content well-structured? (proper sections, bullet points, code blocks, headings)
6. Context — Is there enough background? (why this change, business context, user impact, related tickets)

Scoring guide:
- 90-100: Exemplary — meets all criteria with rich detail
- 70-89: Good — meets most criteria, minor gaps
- 40-69: Needs work — significant gaps in this dimension
- 0-39: Poor — dimension is largely unaddressed

Return ONLY valid JSON (no markdown fencing):
{"overall":<number>,"dimensions":{"clarity":{"score":<number>,"feedback":"<1 sentence>"},"completeness":{"score":<number>,"feedback":"<1 sentence>"},"actionability":{"score":<number>,"feedback":"<1 sentence>"},"testability":{"score":<number>,"feedback":"<1 sentence>"},"formatting":{"score":<number>,"feedback":"<1 sentence>"},"context":{"score":<number>,"feedback":"<1 sentence>"}}}

The overall score is the average of all six dimension scores, rounded to the nearest integer.`;

const GENERIC_SCORING_PROMPT = `You are analyzing a web page that describes a task, issue, bug report, feature request, or story for an engineering team.
Score this content on six dimensions from 0 to 100.

Dimensions:
1. Clarity — Is the content easy to understand? Are requirements or the problem statement unambiguous?
2. Completeness — Does it contain all necessary information? (description, acceptance criteria, reproduction steps, dependencies, edge cases)
3. Actionability — Can a developer start working immediately without asking follow-up questions?
4. Testability — Are success criteria defined and verifiable? Can QA write test cases from this?
5. Formatting — Is the content well-structured? (proper sections, bullet points, code blocks, headings)
6. Context — Is there enough background? (why this change, business context, user impact, related issues)

Scoring guide:
- 90-100: Exemplary — meets all criteria with rich detail
- 70-89: Good — meets most criteria, minor gaps
- 40-69: Needs work — significant gaps in this dimension
- 0-39: Poor — dimension is largely unaddressed

Return ONLY valid JSON (no markdown fencing):
{"overall":<number>,"dimensions":{"clarity":{"score":<number>,"feedback":"<1 sentence>"},"completeness":{"score":<number>,"feedback":"<1 sentence>"},"actionability":{"score":<number>,"feedback":"<1 sentence>"},"testability":{"score":<number>,"feedback":"<1 sentence>"},"formatting":{"score":<number>,"feedback":"<1 sentence>"},"context":{"score":<number>,"feedback":"<1 sentence>"}}}

The overall score is the average of all six dimension scores, rounded to the nearest integer.`;

@Injectable()
export class TicketScoreService {
  private readonly logger = new Logger(TicketScoreService.name);
  private client: GoogleGenAI | null = null;

  constructor(
    @InjectModel(TicketScoreDoc.name) private readonly scoreModel: Model<TicketScoreDoc>,
  ) {}

  private get credentialsPath(): string | undefined {
    return process.env.GOOGLE_APPLICATION_CREDENTIALS;
  }

  private get location(): string {
    return process.env.VERTEX_AI_LOCATION ?? 'us-central1';
  }

  private get model(): string {
    return process.env.GEMINI_MODEL ?? 'gemini-2.5-flash';
  }

  get isConfigured(): boolean {
    const path = this.credentialsPath;
    return !!path && fs.existsSync(path);
  }

  private getClient(): GoogleGenAI {
    if (this.client) return this.client;
    const keyFile = this.credentialsPath;
    if (!keyFile) {
      throw new ServiceUnavailableException(
        'Ticket scoring not configured. Set GOOGLE_APPLICATION_CREDENTIALS.',
      );
    }

    const raw = fs.readFileSync(keyFile, 'utf-8');
    const sa = JSON.parse(raw) as { project_id?: string };
    const project = sa.project_id;
    if (!project) {
      throw new ServiceUnavailableException(
        'Service account JSON does not contain a project_id field.',
      );
    }

    this.client = new GoogleGenAI({
      vertexai: true,
      project,
      location: this.location,
      googleAuthOptions: { keyFile },
    });
    return this.client;
  }

  private toTicketScore(doc: TicketScoreDoc): TicketScore {
    return { overall: doc.overall, dimensions: doc.dimensions };
  }

  async getCached(key: string): Promise<TicketScore | null> {
    const doc = await this.scoreModel.findOne({ issueKey: key.toUpperCase() }).lean().exec();
    return doc ? this.toTicketScore(doc) : null;
  }

  async getCachedByUrl(url: string): Promise<TicketScore | null> {
    const doc = await this.scoreModel
      .findOne({ issueKey: `url:${url}` })
      .lean()
      .exec();
    return doc ? this.toTicketScore(doc) : null;
  }

  async clearCache(key: string): Promise<void> {
    await this.scoreModel.deleteOne({ issueKey: key.toUpperCase() }).exec();
  }

  async clearCacheByUrl(url: string): Promise<void> {
    await this.scoreModel.deleteOne({ issueKey: `url:${url}` }).exec();
  }

  private async assertSafeUrl(raw: string): Promise<void> {
    let parsed: URL;
    try {
      parsed = new URL(raw);
    } catch {
      throw new UnprocessableEntityException('Invalid URL.');
    }

    if (parsed.protocol !== 'https:') {
      throw new UnprocessableEntityException('Only HTTPS URLs are supported.');
    }

    const hostname = parsed.hostname;
    const stripped = hostname.replace(/^\[|\]$/g, '');

    if (isIP(stripped) !== 0) {
      if (isPrivateAddress(hostname)) {
        throw new UnprocessableEntityException('URL resolves to a private address.');
      }
      return;
    }

    let addresses: { address: string }[];
    try {
      addresses = await lookup(hostname, { all: true });
    } catch {
      throw new UnprocessableEntityException('URL is not crawlable or timed out.');
    }

    for (const { address } of addresses) {
      if (isPrivateAddress(address)) {
        throw new UnprocessableEntityException('URL resolves to a private address.');
      }
    }
  }

  async fetchUrlContent(url: string): Promise<{ title: string; body: string }> {
    await this.assertSafeUrl(url);

    let response: Response;
    try {
      response = await fetch(url, {
        signal: AbortSignal.timeout(10_000),
        redirect: 'error',
        headers: { 'User-Agent': 'TabPilot/1.0 (+https://github.com/gautamkrishnar/tabpilot)' },
      });
    } catch {
      throw new UnprocessableEntityException('URL is not crawlable or timed out.');
    }

    if (!response.ok) {
      throw new UnprocessableEntityException(`URL returned HTTP ${response.status}.`);
    }

    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.includes('text/html') && !contentType.includes('text/plain')) {
      throw new UnprocessableEntityException('URL does not return HTML or plain-text content.');
    }

    const html = await response.text();

    const titleMatch = /<title[^>]*>([^<]+)<\/title>/i.exec(html);
    const title = titleMatch ? titleMatch[1].trim() : url;

    const body = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 8_000);

    return { title, body };
  }

  async scoreByUrl(url: string): Promise<TicketScore> {
    const cacheKey = `url:${url}`;

    const cached = await this.scoreModel.findOne({ issueKey: cacheKey }).lean().exec();
    if (cached) return this.toTicketScore(cached);

    const { title, body } = await this.fetchUrlContent(url);

    const ai = this.getClient();
    const content = `## Page Title\n${title}\n\n## Page Content\n${body}`;

    let response: { text?: string | null };
    try {
      response = await ai.models.generateContent({
        model: this.model,
        contents: `${GENERIC_SCORING_PROMPT}\n\n---\n\n${content}`,
        config: { temperature: 0.2, responseMimeType: 'application/json' },
      });
    } catch (err) {
      this.logger.error(`Gemini API call failed for URL: ${err}`);
      throw new ServiceUnavailableException('Failed to score URL via Gemini.');
    }

    let text = response.text?.trim();
    if (!text) throw new ServiceUnavailableException('Gemini returned an empty response.');

    if (text.startsWith('```')) {
      const start = text.indexOf('\n');
      const end = text.lastIndexOf('```');
      if (start !== -1 && end > start) text = text.slice(start + 1, end).trim();
    }

    try {
      const parsed = JSON.parse(text) as TicketScore;
      if (typeof parsed.overall !== 'number' || !parsed.dimensions) {
        throw new Error('Missing required fields');
      }

      await this.scoreModel.create({
        issueKey: cacheKey,
        overall: parsed.overall,
        dimensions: parsed.dimensions,
        scoredAt: new Date(),
      });

      return parsed;
    } catch {
      this.logger.error(`Failed to parse Gemini response for URL: ${text}`);
      throw new ServiceUnavailableException('Gemini returned an unparseable response.');
    }
  }

  async scoreTicket(key: string, summary: string, description: string): Promise<TicketScore> {
    const issueKey = key.toUpperCase();

    const cached = await this.scoreModel.findOne({ issueKey }).lean().exec();
    if (cached) return this.toTicketScore(cached);

    const ai = this.getClient();

    const ticketContent = `## Ticket Summary\n${summary}\n\n## Ticket Description\n${description || '(no description provided)'}`;

    let response: { text?: string | null };
    try {
      response = await ai.models.generateContent({
        model: this.model,
        contents: `${SCORING_PROMPT}\n\n---\n\n${ticketContent}`,
        config: {
          temperature: 0.2,
          responseMimeType: 'application/json',
        },
      });
    } catch (err) {
      this.logger.error(`Gemini API call failed: ${err}`);
      throw new ServiceUnavailableException('Failed to score ticket via Gemini.');
    }

    let text = response.text?.trim();
    if (!text) {
      throw new ServiceUnavailableException('Gemini returned an empty response.');
    }

    if (text.startsWith('```')) {
      const start = text.indexOf('\n');
      const end = text.lastIndexOf('```');
      if (start !== -1 && end > start) text = text.slice(start + 1, end).trim();
    }

    try {
      const parsed = JSON.parse(text) as TicketScore;
      if (typeof parsed.overall !== 'number' || !parsed.dimensions) {
        throw new Error('Missing required fields');
      }

      await this.scoreModel.create({
        issueKey,
        overall: parsed.overall,
        dimensions: parsed.dimensions,
        scoredAt: new Date(),
      });

      return parsed;
    } catch {
      this.logger.error(`Failed to parse Gemini response: ${text}`);
      throw new ServiceUnavailableException('Gemini returned an unparseable response.');
    }
  }
}
