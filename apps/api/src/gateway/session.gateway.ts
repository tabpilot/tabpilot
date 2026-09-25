import { createHash } from 'node:crypto';
import { ValidationPipe } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  type OnGatewayConnection,
  type OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import {
  type HostNavigatePayload,
  type HostOpenUrlPayload,
  type HostRemoveUrlPayload,
  type HostReorderUrlsPayload,
  type HostResetSavedVotePayload,
  type HostSetSavedVotePayload,
  type HostToggleLockPayload,
  type HostToggleTeamQueuesPayload,
  type HostToggleVotingPayload,
  type NavigateToPayload,
  type OpenTabPayload,
  type ParticipantJoinedPayload,
  type ParticipantOnlinePayload,
  type ParticipantUpdatedPayload,
  type SavedVotesUpdatedPayload,
  type SessionStartedPayload,
  type SessionStatePayload,
  type TeamQueueCompletedPayload,
  type TeamQueueProgressUpdatedPayload,
  type TicketScoreUpdatePayload,
  type UpdateHostProfilePayload,
  type UpdateSessionNamePayload,
  type VotesRevealedPayload,
  type VoteUpdatePayload,
  WS_EVENTS,
  type WsErrorPayload,
} from '@tabpilot/shared';
import type { Server, Socket } from 'socket.io';
import { JiraService } from '../jira/jira.service';
import { ParticipantsService } from '../participants/participants.service';
import { SessionsService } from '../sessions/sessions.service';
import { TicketScoreService } from '../ticket-score/ticket-score.service';
import {
  HostActionDto,
  HostAddUrlDto,
  HostTeamQueueCompleteDto,
  JoinSessionDto,
  KickParticipantDto,
  SubmitVoteDto,
  UpdateParticipantProfileDto,
} from './ws.dto';

interface SocketMeta {
  sessionId: string;
  participantId?: string;
  isHost: boolean;
}

@WebSocketGateway()
export class SessionGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly socketMeta = new Map<string, SocketMeta>();

  /**
   * Votes per ticket: sessionId → urlIndex → { participantId → value }.
   * Persists across navigation so votes survive forward/back movement.
   */
  private readonly votes = new Map<string, Map<number, Map<string, string>>>();

  /**
   * Indices where votes have been revealed: sessionId → Set<urlIndex>.
   * Revealed tickets show the actual votes and disable further voting.
   */
  private readonly revealed = new Map<string, Set<number>>();

  /**
   * Saved average vote per URL index: sessionId → { urlIndex → averageString }.
   * Persists across navigation within the session lifetime.
   */
  private readonly savedVotes = new Map<string, Map<number, string>>();

  /** Tracks which URL keys have been dispatched for scoring per session to avoid duplicate Gemini calls. */
  private readonly scoringDispatched = new Map<string, Set<string>>();

  constructor(
    private readonly sessionsService: SessionsService,
    private readonly participantsService: ParticipantsService,
    private readonly ticketScoreService: TicketScoreService,
    private readonly jiraService: JiraService,
  ) {}

  private static parseJiraFromUrl(url: string): { key: string; baseUrl: string } | null {
    try {
      const parsed = new URL(url);
      const match = /\/browse\/([A-Z]+-\d+)/i.exec(parsed.pathname);
      if (!match) return null;
      return { key: match[1].toUpperCase(), baseUrl: parsed.origin };
    } catch {
      return null;
    }
  }

  private async scoreUrlWithRetry(url: string, maxRetries = 3) {
    const jira = SessionGateway.parseJiraFromUrl(url);
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        if (jira) {
          const cached = await this.ticketScoreService.getCached(jira.key);
          if (cached) return { key: jira.key, score: cached };
          const issue = await this.jiraService.getIssueWithDescription(jira.key, jira.baseUrl);
          const score = await this.ticketScoreService.scoreTicket(
            jira.key,
            issue.summary,
            issue.description,
          );
          return { key: jira.key, score };
        }
        const cached = await this.ticketScoreService.getCachedByUrl(url);
        if (cached) return { key: `url:${url}`, score: cached };
        const score = await this.ticketScoreService.scoreByUrl(url);
        return { key: `url:${url}`, score };
      } catch (err) {
        const status =
          (err as { status?: number })?.status ??
          (err as { response?: { status?: number } })?.response?.status;
        if (status === 429 && attempt < maxRetries) {
          await new Promise((resolve) => setTimeout(resolve, (attempt + 1) * 2000));
          continue;
        }
        return null;
      }
    }
    return null;
  }

  private async fetchCachedScores(
    urls: string[],
  ): Promise<Record<string, import('@tabpilot/shared').TicketScore>> {
    if (!this.ticketScoreService.isConfigured) return {};
    const entries = await Promise.all(
      urls.map(async (url) => {
        const jira = SessionGateway.parseJiraFromUrl(url);
        const cached = jira
          ? await this.ticketScoreService.getCached(jira.key)
          : await this.ticketScoreService.getCachedByUrl(url);
        if (!cached) return null;
        const key = jira ? jira.key : `url:${url}`;
        return [key, cached] as const;
      }),
    );
    return Object.fromEntries(
      entries.filter((e): e is [string, import('@tabpilot/shared').TicketScore] => e !== null),
    );
  }

  private scoreUrlsInBackground(sessionId: string, urls: string[]): void {
    if (!this.ticketScoreService.isConfigured) return;

    const dispatched = this.scoringDispatched.get(sessionId) ?? new Set<string>();
    this.scoringDispatched.set(sessionId, dispatched);

    const pending = urls.filter((url) => {
      const jira = SessionGateway.parseJiraFromUrl(url);
      const key = jira ? jira.key : `url:${url}`;
      if (dispatched.has(key)) return false;
      dispatched.add(key);
      return true;
    });

    if (pending.length === 0) return;

    const CONCURRENCY = 4;
    let active = 0;
    let index = 0;

    const next = () => {
      while (active < CONCURRENCY && index < pending.length) {
        const url = pending[index++];
        active++;
        void this.scoreUrlWithRetry(url).then((result) => {
          active--;
          if (result) {
            this.server
              .to(sessionId)
              .emit(WS_EVENTS.TICKET_SCORE_UPDATE, result satisfies TicketScoreUpdatePayload);
          }
          next();
        });
      }
    };

    next();
  }

  /**
   * Compute the average of numeric votes. Non-numeric values (?, ☕) are ignored.
   * Returns the mean rounded to the nearest integer, or the mode of non-numeric
   * values if there are no numeric votes at all.
   */
  private computeAverage(votes: Map<string, string>): string {
    const values = Array.from(votes.values());
    const numeric = values.map(Number).filter((n) => !Number.isNaN(n));
    if (numeric.length > 0) {
      const mean = numeric.reduce((a, b) => a + b, 0) / numeric.length;
      return String(Math.round(mean));
    }
    // All non-numeric — return the most common value
    const freq = new Map<string, number>();
    for (const v of values) freq.set(v, (freq.get(v) ?? 0) + 1);
    let mode = values[0] ?? '?';
    let max = 0;
    freq.forEach((count, val) => {
      if (count > max) {
        max = count;
        mode = val;
      }
    });
    return mode;
  }

  /**
   * Normalise a URL and return its SHA-256 hex digest for use as a stable DB map key.
   * Normalisation: trim, lowercase scheme+host, remove trailing slash and fragment.
   * This makes the key reorder-proof — the same ticket always maps to the same key
   * regardless of its position in the queue.
   */
  private urlKey(url: string): string {
    let normalised = url.trim();
    try {
      const parsed = new URL(normalised);
      parsed.hash = '';
      // Lowercase scheme and host; path is kept as-is (case-significant in some systems)
      let pathname = parsed.pathname;
      while (pathname.endsWith('/')) pathname = pathname.slice(0, -1);
      normalised = `${parsed.protocol.toLowerCase()}//${parsed.host.toLowerCase()}${pathname}${parsed.search}`;
    } catch {
      normalised = url.trim().toLowerCase();
      while (normalised.endsWith('/')) normalised = normalised.slice(0, -1);
    }
    return createHash('sha256').update(normalised).digest('hex');
  }

  /**
   * Seed in-memory vote/reveal/storyPoints caches from the persisted session document.
   * Called on join so clients reconnecting after a server restart see the correct state.
   */
  private seedInMemoryFromDoc(
    sessionId: string,
    sessionDoc: {
      votes: Array<{ urlIndex: number; participantId: string; value: string }>;
      revealedIndices: number[];
      storyPoints: Map<string, string>;
      urls: string[];
    },
  ) {
    if (!this.votes.has(sessionId) && sessionDoc.votes?.length > 0) {
      const indexMap = new Map<number, Map<string, string>>();
      for (const { urlIndex, participantId, value } of sessionDoc.votes) {
        if (!indexMap.has(urlIndex)) indexMap.set(urlIndex, new Map());
        // biome-ignore lint/style/noNonNullAssertion: set on the line above
        indexMap.get(urlIndex)!.set(participantId, value);
      }
      this.votes.set(sessionId, indexMap);
    }
    if (!this.revealed.has(sessionId) && sessionDoc.revealedIndices?.length > 0) {
      this.revealed.set(sessionId, new Set(sessionDoc.revealedIndices));
    }
    if (!this.savedVotes.has(sessionId) && sessionDoc.storyPoints?.size > 0) {
      const spMap = new Map<number, string>();
      sessionDoc.urls.forEach((url, idx) => {
        const sp = sessionDoc.storyPoints.get(this.urlKey(url));
        if (sp !== undefined) spMap.set(idx, sp);
      });
      if (spMap.size > 0) this.savedVotes.set(sessionId, spMap);
    }
  }

  /** Get votes map for a specific URL index (empty Map if none). */
  private getVotesForIndex(sessionId: string, urlIndex: number): Map<string, string> {
    return this.votes.get(sessionId)?.get(urlIndex) ?? new Map();
  }

  /** Whether votes for a specific URL index have been revealed. */
  private isRevealedForIndex(sessionId: string, urlIndex: number): boolean {
    return this.revealed.get(sessionId)?.has(urlIndex) ?? false;
  }

  /** Build the voting portion of a NavigateToPayload for a given index. */
  private votingStateForIndex(
    sessionId: string,
    urlIndex: number,
  ): Pick<NavigateToPayload, 'hasVoted' | 'revealedVotes' | 'revealedAverage'> {
    const indexVotes = this.getVotesForIndex(sessionId, urlIndex);
    const isRevealed = this.isRevealedForIndex(sessionId, urlIndex);
    return {
      hasVoted: Array.from(indexVotes.keys()),
      ...(isRevealed && indexVotes.size > 0
        ? {
            revealedVotes: Object.fromEntries(indexVotes),
            revealedAverage: this.computeAverage(indexVotes),
          }
        : {}),
    };
  }

  /** Snapshot of savedVotes for a session as a plain Record (for wire transfer). */
  private savedVotesRecord(sessionId: string): Record<number, string> {
    const map = this.savedVotes.get(sessionId);
    if (!map) return {};
    const record: Record<number, string> = {};
    map.forEach((avg, idx) => {
      record[idx] = avg;
    });
    return record;
  }

  handleConnection(_client: Socket) {
    // Meta is populated on join_session
  }

  async handleDisconnect(client: Socket) {
    const meta = this.socketMeta.get(client.id);
    if (!meta) return;

    this.socketMeta.delete(client.id);

    // If no sockets remain for this session, release all in-memory voting state
    const anyLeft = Array.from(this.socketMeta.values()).some(
      (m) => m.sessionId === meta.sessionId,
    );
    if (!anyLeft) {
      this.votes.delete(meta.sessionId);
      this.revealed.delete(meta.sessionId); // Set<number>, same delete API
      this.savedVotes.delete(meta.sessionId);
    }

    if (meta.participantId && !meta.isHost) {
      const hasOtherSocket = Array.from(this.socketMeta.values()).some(
        (m) => m.participantId === meta.participantId,
      );
      if (!hasOtherSocket) {
        try {
          await this.participantsService.updateOnlineStatus(meta.participantId, false);
          const payload: ParticipantOnlinePayload = {
            participantId: meta.participantId,
            isOnline: false,
          };
          this.server.to(meta.sessionId).emit(WS_EVENTS.PARTICIPANT_ONLINE, payload);
        } catch {
          // Participant may already be gone
        }
      }
    }
  }

  /** Validate host/participant access on join; returns isHost or emits error and returns null. */
  private async validateJoin(
    client: Socket,
    sessionId: string,
    hostKey: string | undefined,
    participantId: string | undefined,
    isLocked: boolean,
  ): Promise<boolean | null> {
    const isHost = hostKey ? await this.sessionsService.validateHostKey(sessionId, hostKey) : false;

    if (hostKey && !isHost) {
      client.emit(WS_EVENTS.ERROR, {
        message: 'Invalid host key',
        code: 'INVALID_HOST_KEY',
      } satisfies WsErrorPayload);
      return null;
    }

    if (!isHost && isLocked && !participantId) {
      client.emit(WS_EVENTS.ERROR, {
        message: 'This session is locked. The host is not accepting new participants.',
        code: 'SESSION_LOCKED',
      } satisfies WsErrorPayload);
      return null;
    }

    return isHost;
  }

  /** Resolve and update an existing participant on reconnect; returns { doc, wasOffline }. */
  private async resolveReconnectingParticipant(
    participantId: string,
    sessionId: string,
    clientId: string,
  ) {
    const found = await this.participantsService.findById(participantId);
    if (found?.sessionId !== sessionId) return { doc: null, wasOffline: false };

    const wasOffline = !found.isOnline;
    await this.participantsService.updateSocketId(participantId, clientId);
    const updated = await this.participantsService.updateOnlineStatus(participantId, true);
    return { doc: updated, wasOffline };
  }

  /** Emit the current navigation URL to a newly joined client if the session is active.
   *  Always includes voting state for the current index so the client restores it correctly.
   */
  private emitCurrentNav(
    client: Socket,
    sessionDoc: { state: string; urls: string[]; currentIndex: number },
    sessionId: string,
  ) {
    if (sessionDoc.state !== 'active' || sessionDoc.urls.length === 0) return;
    const url = sessionDoc.urls[sessionDoc.currentIndex];
    if (!url) return;

    const navPayload: NavigateToPayload = {
      url,
      index: sessionDoc.currentIndex,
      total: sessionDoc.urls.length,
      savedVotes: this.savedVotesRecord(sessionId),
      ...this.votingStateForIndex(sessionId, sessionDoc.currentIndex),
    };
    client.emit(WS_EVENTS.NAVIGATE_TO, navPayload);
  }

  @SubscribeMessage(WS_EVENTS.JOIN_SESSION)
  async handleJoinSession(
    @ConnectedSocket() client: Socket,
    @MessageBody(new ValidationPipe({ whitelist: true, transform: true })) payload: JoinSessionDto,
  ) {
    const { sessionId, participantId, hostKey, participantSecret } = payload;

    const sessionDoc = await this.sessionsService.findById(sessionId);
    if (!sessionDoc) {
      client.emit(WS_EVENTS.ERROR, {
        message: 'Session not found',
        code: 'SESSION_NOT_FOUND',
      } satisfies WsErrorPayload);
      return;
    }

    const isHost = await this.validateJoin(
      client,
      sessionId,
      hostKey,
      participantId,
      sessionDoc.isLocked,
    );
    if (isHost === null) return;

    // Participants reconnecting with a participantId must prove ownership via the secret
    if (participantId && !isHost) {
      if (!participantSecret) {
        client.emit(WS_EVENTS.ERROR, {
          message: 'Invalid participant credentials',
          code: 'UNAUTHORIZED',
        } satisfies WsErrorPayload);
        return;
      }
      const valid = await this.participantsService.verifyParticipantSecret(
        participantId,
        participantSecret,
      );
      if (!valid) {
        client.emit(WS_EVENTS.ERROR, {
          message: 'Invalid participant credentials',
          code: 'UNAUTHORIZED',
        } satisfies WsErrorPayload);
        return;
      }
    }

    this.socketMeta.set(client.id, {
      sessionId,
      participantId: isHost ? undefined : participantId,
      isHost,
    });

    await client.join(sessionId);

    // Resolve participant if provided
    let resolvedParticipantDoc = null;
    let wasOffline = false;
    if (!isHost && participantId) {
      const result = await this.resolveReconnectingParticipant(participantId, sessionId, client.id);
      resolvedParticipantDoc = result.doc;
      wasOffline = result.wasOffline;
    }

    // Seed in-memory state from DB if the server restarted since this session began
    this.seedInMemoryFromDoc(sessionId, sessionDoc);

    const participants = await this.participantsService.findBySession(sessionId);
    const scores = await this.fetchCachedScores(sessionDoc.urls);
    const sessionStatePayload: SessionStatePayload = {
      session: this.sessionsService.toSessionDto(sessionDoc),
      participants,
      hasVoted: Array.from(this.getVotesForIndex(sessionId, sessionDoc.currentIndex).keys()),
      savedVotes: this.savedVotesRecord(sessionId),
      ...(Object.keys(scores).length > 0 ? { scores } : {}),
    };
    client.emit(WS_EVENTS.SESSION_STATE, sessionStatePayload);

    this.scoreUrlsInBackground(sessionId, sessionDoc.urls);

    if (!isHost && participantId && resolvedParticipantDoc) {
      if (wasOffline) {
        const participant = this.participantsService.toParticipantDto(resolvedParticipantDoc);
        client
          .to(sessionId)
          .emit(WS_EVENTS.PARTICIPANT_JOINED, { participant } satisfies ParticipantJoinedPayload);
      }
      this.server.to(sessionId).emit(WS_EVENTS.PARTICIPANT_ONLINE, {
        participantId,
        isOnline: true,
      } satisfies ParticipantOnlinePayload);
    }

    this.emitCurrentNav(client, sessionDoc, sessionId);
  }

  @SubscribeMessage(WS_EVENTS.HOST_START_SESSION)
  async handleStartSession(
    @ConnectedSocket() client: Socket,
    @MessageBody(new ValidationPipe({ whitelist: true, transform: true })) payload: HostActionDto,
  ) {
    const { sessionId, hostKey } = payload;

    const isValid = await this.sessionsService.validateHostKey(sessionId, hostKey);
    if (!isValid) {
      client.emit(WS_EVENTS.ERROR, {
        message: 'Invalid host key',
        code: 'INVALID_HOST_KEY',
      } satisfies WsErrorPayload);
      return;
    }

    const updatedSession = await this.sessionsService.updateState(sessionId, 'active');
    const sessionDto = this.sessionsService.toSessionDto(updatedSession);

    const participants = await this.participantsService.findBySession(sessionId);
    const sessionStatePayload: SessionStatePayload = {
      session: sessionDto,
      participants,
    };
    this.server.to(sessionId).emit(WS_EVENTS.SESSION_STATE, sessionStatePayload);

    const firstUrl = updatedSession.urls[0] ?? '';
    const startedPayload: SessionStartedPayload = {
      currentUrl: firstUrl,
      currentIndex: 0,
      total: updatedSession.urls.length,
    };
    this.server.to(sessionId).emit(WS_EVENTS.SESSION_STARTED, startedPayload);

    if (firstUrl) {
      const navPayload: NavigateToPayload = {
        url: firstUrl,
        index: 0,
        total: updatedSession.urls.length,
      };
      this.server.to(sessionId).emit(WS_EVENTS.NAVIGATE_TO, navPayload);
    }
  }

  @SubscribeMessage(WS_EVENTS.HOST_NAVIGATE)
  async handleNavigate(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: HostNavigatePayload,
  ) {
    const { sessionId, hostKey, direction, index, skip, teamQueueProgress } = payload;

    const sessionDoc = await this.sessionsService.findById(sessionId);
    if (!sessionDoc) {
      client.emit(WS_EVENTS.ERROR, {
        message: 'Session not found',
        code: 'SESSION_NOT_FOUND',
      } satisfies WsErrorPayload);
      return;
    }

    if (!this.sessionsService.validateHostKeyForDoc(sessionDoc, hostKey)) {
      client.emit(WS_EVENTS.ERROR, {
        message: 'Invalid host key',
        code: 'INVALID_HOST_KEY',
      } satisfies WsErrorPayload);
      return;
    }

    if (teamQueueProgress) {
      const { queueKey, position } = teamQueueProgress;
      if (
        !sessionDoc.teamQueuesEnabled ||
        typeof queueKey !== 'string' ||
        queueKey.length === 0 ||
        !Number.isInteger(position) ||
        position < 0 ||
        position > sessionDoc.urls.length
      ) {
        client.emit(WS_EVENTS.ERROR, {
          message: 'Invalid team queue progress.',
          code: 'INVALID_TEAM_QUEUE_PROGRESS',
        } satisfies WsErrorPayload);
        return;
      }
      const updated = await this.sessionsService.setTeamQueueProgress(
        sessionId,
        queueKey,
        position,
      );
      const teamQueueProgressRecord = this.sessionsService.toSessionDto(updated)
        ?.teamQueueProgress ?? {
        [queueKey]: position,
      };
      const progressPayload: TeamQueueProgressUpdatedPayload = {
        teamQueueProgress: teamQueueProgressRecord,
      };
      this.server.to(sessionId).emit(WS_EVENTS.TEAM_QUEUE_PROGRESS_UPDATED, progressPayload);
    }

    const total = sessionDoc.urls.length;
    if (total === 0) return;

    let newIndex = sessionDoc.currentIndex;

    if (typeof index === 'number') {
      newIndex = Math.max(0, Math.min(index, total - 1));
    } else if (direction === 'next') {
      newIndex = Math.min(sessionDoc.currentIndex + 1, total - 1);
    } else if (direction === 'prev') {
      newIndex = Math.max(sessionDoc.currentIndex - 1, 0);
    }

    // Skip if index hasn't changed
    if (newIndex === sessionDoc.currentIndex) return;

    await this.sessionsService.updateCurrentIndex(sessionId, newIndex);

    const leavingIndex = sessionDoc.currentIndex;
    const alreadyManuallySet = this.savedVotes.get(sessionId)?.has(leavingIndex);
    if (!alreadyManuallySet) {
      if (!this.savedVotes.has(sessionId)) this.savedVotes.set(sessionId, new Map());
      if (skip) {
        // biome-ignore lint/style/noNonNullAssertion: set on the line above
        this.savedVotes.get(sessionId)!.set(leavingIndex, 'skipped');
      } else {
        const leavingVotes = this.getVotesForIndex(sessionId, leavingIndex);
        if (leavingVotes.size > 0) {
          const avg = this.computeAverage(leavingVotes);
          // biome-ignore lint/style/noNonNullAssertion: set on the line above
          this.savedVotes.get(sessionId)!.set(leavingIndex, avg);
          const leavingUrl = sessionDoc.urls[leavingIndex];
          if (leavingUrl) {
            void this.sessionsService.setStoryPoint(sessionId, this.urlKey(leavingUrl), avg);
          }
        }
      }
    }

    // Votes are NOT cleared — they persist per URL index so navigating back restores them.

    const url = sessionDoc.urls[newIndex];
    if (!url) return;

    const navPayload: NavigateToPayload = {
      url,
      index: newIndex,
      total,
      savedVotes: this.savedVotesRecord(sessionId),
      ...this.votingStateForIndex(sessionId, newIndex),
    };
    this.server.to(sessionId).emit(WS_EVENTS.NAVIGATE_TO, navPayload);
  }

  @SubscribeMessage(WS_EVENTS.HOST_OPEN_URL)
  async handleOpenUrl(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: HostOpenUrlPayload,
  ) {
    const { sessionId, hostKey, url } = payload;

    const isValid = await this.sessionsService.validateHostKey(sessionId, hostKey);
    if (!isValid) {
      client.emit(WS_EVENTS.ERROR, {
        message: 'Invalid host key',
        code: 'INVALID_HOST_KEY',
      } satisfies WsErrorPayload);
      return;
    }

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      client.emit(WS_EVENTS.ERROR, {
        message: 'Invalid URL',
        code: 'INVALID_URL',
      } satisfies WsErrorPayload);
      return;
    }

    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      client.emit(WS_EVENTS.ERROR, {
        message: 'URL must use http or https protocol',
        code: 'INVALID_URL_PROTOCOL',
      } satisfies WsErrorPayload);
      return;
    }

    const openTabPayload: OpenTabPayload = { url };
    this.server.to(sessionId).emit(WS_EVENTS.OPEN_TAB, openTabPayload);
  }

  @SubscribeMessage(WS_EVENTS.HOST_END_SESSION)
  async handleEndSession(
    @ConnectedSocket() client: Socket,
    @MessageBody(new ValidationPipe({ whitelist: true, transform: true })) payload: HostActionDto,
  ) {
    const { sessionId, hostKey } = payload;

    const isValid = await this.sessionsService.validateHostKey(sessionId, hostKey);
    if (!isValid) {
      client.emit(WS_EVENTS.ERROR, {
        message: 'Invalid host key',
        code: 'INVALID_HOST_KEY',
      } satisfies WsErrorPayload);
      return;
    }

    await this.sessionsService.updateState(sessionId, 'ended');
    this.votes.delete(sessionId);
    this.revealed.delete(sessionId);
    this.savedVotes.delete(sessionId);
    this.scoringDispatched.delete(sessionId);
    this.server.to(sessionId).emit(WS_EVENTS.SESSION_ENDED, {});
  }

  @SubscribeMessage(WS_EVENTS.GROOMING_COMPLETE)
  async handleGroomingComplete(
    @ConnectedSocket() client: Socket,
    @MessageBody(new ValidationPipe({ whitelist: true, transform: true })) payload: HostActionDto,
  ) {
    const { sessionId, hostKey } = payload;

    const isValid = await this.sessionsService.validateHostKey(sessionId, hostKey);
    if (!isValid) {
      client.emit(WS_EVENTS.ERROR, {
        message: 'Invalid host key',
        code: 'INVALID_HOST_KEY',
      } satisfies WsErrorPayload);
      return;
    }

    // Broadcast to all participants except the host who triggered it
    client.to(sessionId).emit(WS_EVENTS.GROOMING_COMPLETE, {});
  }

  @SubscribeMessage(WS_EVENTS.TEAM_QUEUE_COMPLETED)
  async handleTeamQueueCompleted(
    @ConnectedSocket() client: Socket,
    @MessageBody(new ValidationPipe({ whitelist: true, transform: true }))
    payload: HostTeamQueueCompleteDto,
  ) {
    const { sessionId, hostKey, queueName } = payload;
    const isValid = await this.sessionsService.validateHostKey(sessionId, hostKey);
    if (!isValid) {
      client.emit(WS_EVENTS.ERROR, {
        message: 'Invalid host key',
        code: 'INVALID_HOST_KEY',
      } satisfies WsErrorPayload);
      return;
    }
    client.to(sessionId).emit(WS_EVENTS.TEAM_QUEUE_COMPLETED, {
      queueName,
    } satisfies TeamQueueCompletedPayload);
  }

  @SubscribeMessage(WS_EVENTS.HOST_ADD_URL)
  async handleAddUrl(
    @ConnectedSocket() client: Socket,
    @MessageBody(new ValidationPipe({ whitelist: true, transform: true })) payload: HostAddUrlDto,
  ) {
    const { sessionId, hostKey, url } = payload;

    const isValid = await this.sessionsService.validateHostKey(sessionId, hostKey);
    if (!isValid) {
      client.emit(WS_EVENTS.ERROR, {
        message: 'Unauthorized',
        code: 'UNAUTHORIZED',
      } satisfies WsErrorPayload);
      return;
    }

    const updated = await this.sessionsService.addUrl(sessionId, url);
    if (!updated) return;

    const participantDtos = await this.participantsService.findBySession(sessionId);
    const stateUpdate: SessionStatePayload = {
      session: this.sessionsService.toSessionDto(updated),
      participants: participantDtos,
    };
    this.server.to(sessionId).emit(WS_EVENTS.SESSION_STATE, stateUpdate);
    this.scoreUrlsInBackground(sessionId, [url]);
  }

  @SubscribeMessage(WS_EVENTS.HOST_TOGGLE_LOCK)
  async handleToggleLock(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: HostToggleLockPayload,
  ) {
    const { sessionId, hostKey, locked } = payload;
    const isValid = await this.sessionsService.validateHostKey(sessionId, hostKey);
    if (!isValid) {
      client.emit(WS_EVENTS.ERROR, {
        message: 'Unauthorized',
        code: 'UNAUTHORIZED',
      } satisfies WsErrorPayload);
      return;
    }
    const updated = await this.sessionsService.setLocked(sessionId, locked);
    if (!updated) return;
    const participants = await this.participantsService.findBySession(sessionId);
    this.server.to(sessionId).emit(WS_EVENTS.SESSION_STATE, {
      session: this.sessionsService.toSessionDto(updated),
      participants,
    } satisfies SessionStatePayload);
  }

  @SubscribeMessage(WS_EVENTS.HOST_TOGGLE_VOTING)
  async handleToggleVoting(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: HostToggleVotingPayload,
  ) {
    const { sessionId, hostKey, votingEnabled } = payload;
    const isValid = await this.sessionsService.validateHostKey(sessionId, hostKey);
    if (!isValid) {
      client.emit(WS_EVENTS.ERROR, {
        message: 'Unauthorized',
        code: 'UNAUTHORIZED',
      } satisfies WsErrorPayload);
      return;
    }
    const updated = await this.sessionsService.setVotingEnabled(sessionId, votingEnabled);
    if (!updated) return;
    const participants = await this.participantsService.findBySession(sessionId);
    this.server.to(sessionId).emit(WS_EVENTS.SESSION_STATE, {
      session: this.sessionsService.toSessionDto(updated),
      participants,
    } satisfies SessionStatePayload);
  }

  @SubscribeMessage(WS_EVENTS.HOST_TOGGLE_TEAM_QUEUES)
  async handleToggleTeamQueues(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: HostToggleTeamQueuesPayload,
  ) {
    const { sessionId, hostKey, teamQueuesEnabled } = payload;
    const isValid = await this.sessionsService.validateHostKey(sessionId, hostKey);
    if (!isValid) {
      client.emit(WS_EVENTS.ERROR, {
        message: 'Unauthorized',
        code: 'UNAUTHORIZED',
      } satisfies WsErrorPayload);
      return;
    }
    const updated = await this.sessionsService.setTeamQueuesEnabled(sessionId, teamQueuesEnabled);
    if (!updated) return;
    const participants = await this.participantsService.findBySession(sessionId);
    this.server.to(sessionId).emit(WS_EVENTS.SESSION_STATE, {
      session: this.sessionsService.toSessionDto(updated),
      participants,
    } satisfies SessionStatePayload);
  }

  @SubscribeMessage(WS_EVENTS.HOST_KICK_PARTICIPANT)
  async handleKickParticipant(
    @ConnectedSocket() client: Socket,
    @MessageBody(new ValidationPipe({ whitelist: true, transform: true }))
    payload: KickParticipantDto,
  ) {
    const { sessionId, hostKey, participantId } = payload;

    const isValid = await this.sessionsService.validateHostKey(sessionId, hostKey);
    if (!isValid) {
      client.emit(WS_EVENTS.ERROR, {
        message: 'Unauthorized',
        code: 'UNAUTHORIZED',
      } satisfies WsErrorPayload);
      return;
    }

    // Verify the participant belongs to this session (prevents cross-session deletion)
    const participantDoc = await this.participantsService.findById(participantId);
    if (!participantDoc || participantDoc.sessionId !== sessionId) {
      client.emit(WS_EVENTS.ERROR, {
        message: 'Unauthorized',
        code: 'UNAUTHORIZED',
      } satisfies WsErrorPayload);
      return;
    }

    // Hard-delete so they don't reappear on reload
    await this.participantsService.deleteParticipant(participantId);

    for (const [socketId, meta] of this.socketMeta.entries()) {
      if (meta.participantId === participantId) {
        this.server.to(socketId).emit(WS_EVENTS.KICKED, { participantId });
        this.socketMeta.delete(socketId);
        break;
      }
    }

    this.server.to(sessionId).emit(WS_EVENTS.PARTICIPANT_LEFT, { participantId });
  }

  @SubscribeMessage(WS_EVENTS.HOST_REMOVE_URL)
  async handleRemoveUrl(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: HostRemoveUrlPayload,
  ) {
    const { sessionId, hostKey, index } = payload;
    const isValid = await this.sessionsService.validateHostKey(sessionId, hostKey);
    if (!isValid) {
      client.emit(WS_EVENTS.ERROR, {
        message: 'Unauthorized',
        code: 'UNAUTHORIZED',
      } satisfies WsErrorPayload);
      return;
    }
    const updated = await this.sessionsService.removeUrl(sessionId, index);
    if (!updated) return;
    const participants = await this.participantsService.findBySession(sessionId);
    this.server.to(sessionId).emit(WS_EVENTS.SESSION_STATE, {
      session: this.sessionsService.toSessionDto(updated),
      participants,
    } satisfies SessionStatePayload);
  }

  @SubscribeMessage(WS_EVENTS.HOST_REORDER_URLS)
  async handleReorderUrls(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: HostReorderUrlsPayload,
  ) {
    const { sessionId, hostKey, fromIndex, toIndex } = payload;
    const isValid = await this.sessionsService.validateHostKey(sessionId, hostKey);
    if (!isValid) {
      client.emit(WS_EVENTS.ERROR, {
        message: 'Unauthorized',
        code: 'UNAUTHORIZED',
      } satisfies WsErrorPayload);
      return;
    }
    const updated = await this.sessionsService.reorderUrls(sessionId, fromIndex, toIndex);
    if (!updated) {
      client.emit(WS_EVENTS.ERROR, {
        message: 'Cannot reorder past or current URLs',
        code: 'REORDER_NOT_ALLOWED',
      } satisfies WsErrorPayload);
      return;
    }

    const participants = await this.participantsService.findBySession(sessionId);
    this.server.to(sessionId).emit(WS_EVENTS.SESSION_STATE, {
      session: this.sessionsService.toSessionDto(updated),
      participants,
    } satisfies SessionStatePayload);
  }

  @SubscribeMessage(WS_EVENTS.SUBMIT_VOTE)
  async handleSubmitVote(
    @ConnectedSocket() client: Socket,
    @MessageBody(new ValidationPipe({ whitelist: true, transform: true })) payload: SubmitVoteDto,
  ) {
    const { sessionId, participantId, value } = payload;

    const socketParticipantId = this.socketMeta.get(client.id)?.participantId;
    if (!socketParticipantId || socketParticipantId !== participantId) {
      client.emit(WS_EVENTS.ERROR, {
        message: 'Unauthorized',
        code: 'UNAUTHORIZED',
      } satisfies WsErrorPayload);
      return;
    }

    const sessionDoc = await this.sessionsService.findById(sessionId);
    if (!sessionDoc) {
      client.emit(WS_EVENTS.ERROR, {
        message: 'Session not found',
        code: 'SESSION_NOT_FOUND',
      } satisfies WsErrorPayload);
      return;
    }

    if (!sessionDoc.votingEnabled) {
      client.emit(WS_EVENTS.ERROR, {
        message: 'Voting is not enabled for this session',
        code: 'VOTING_DISABLED',
      } satisfies WsErrorPayload);
      return;
    }

    if (sessionDoc.state !== 'active') {
      client.emit(WS_EVENTS.ERROR, {
        message: 'Session is not active',
        code: 'SESSION_NOT_ACTIVE',
      } satisfies WsErrorPayload);
      return;
    }

    const currentIndex = sessionDoc.currentIndex;

    // Reject if votes for this ticket have already been revealed
    if (this.isRevealedForIndex(sessionId, currentIndex)) {
      client.emit(WS_EVENTS.ERROR, {
        message: 'Votes for this ticket have already been revealed.',
        code: 'VOTES_ALREADY_REVEALED',
      } satisfies WsErrorPayload);
      return;
    }

    if (!this.votes.has(sessionId)) {
      this.votes.set(sessionId, new Map());
    }
    // biome-ignore lint/style/noNonNullAssertion: set on the line above
    const sessionVotes = this.votes.get(sessionId)!;
    if (!sessionVotes.has(currentIndex)) sessionVotes.set(currentIndex, new Map());
    // biome-ignore lint/style/noNonNullAssertion: set on the line above
    sessionVotes.get(currentIndex)!.set(participantId, value);

    // Persist vote to DB so it survives page reloads and server restarts
    void this.sessionsService.setTicketVote(sessionId, currentIndex, participantId, value);

    // Only broadcast WHO has voted — actual values stay hidden until host reveals
    const voteUpdatePayload: VoteUpdatePayload = {
      hasVoted: Array.from(this.getVotesForIndex(sessionId, currentIndex).keys()),
    };
    this.server.to(sessionId).emit(WS_EVENTS.VOTE_UPDATE, voteUpdatePayload);
  }

  @SubscribeMessage(WS_EVENTS.HOST_REVEAL_VOTES)
  async handleRevealVotes(
    @ConnectedSocket() client: Socket,
    @MessageBody(new ValidationPipe({ whitelist: true, transform: true })) payload: HostActionDto,
  ) {
    const { sessionId, hostKey } = payload;

    const sessionDoc = await this.sessionsService.findById(sessionId);
    if (!sessionDoc) {
      client.emit(WS_EVENTS.ERROR, {
        message: 'Session not found',
        code: 'SESSION_NOT_FOUND',
      } satisfies WsErrorPayload);
      return;
    }

    if (!this.sessionsService.validateHostKeyForDoc(sessionDoc, hostKey)) {
      client.emit(WS_EVENTS.ERROR, {
        message: 'Invalid host key',
        code: 'INVALID_HOST_KEY',
      } satisfies WsErrorPayload);
      return;
    }

    const currentIndex = sessionDoc.currentIndex;
    const currentVotes = this.getVotesForIndex(sessionId, currentIndex);
    if (currentVotes.size === 0) {
      client.emit(WS_EVENTS.ERROR, {
        message: 'No votes to reveal',
        code: 'NO_VOTES',
      } satisfies WsErrorPayload);
      return;
    }

    if (!this.revealed.has(sessionId)) this.revealed.set(sessionId, new Set());
    // biome-ignore lint/style/noNonNullAssertion: set on the line above
    this.revealed.get(sessionId)!.add(currentIndex);
    void this.sessionsService.setTicketRevealed(sessionId, currentIndex, true);

    const votesRecord: Record<string, string> = Object.fromEntries(currentVotes);
    const revealPayload: VotesRevealedPayload = {
      votes: votesRecord,
      average: this.computeAverage(currentVotes),
    };
    this.server.to(sessionId).emit(WS_EVENTS.VOTES_REVEALED, revealPayload);
  }

  @SubscribeMessage(WS_EVENTS.UPDATE_PARTICIPANT_PROFILE)
  async handleUpdateParticipantProfile(
    @ConnectedSocket() client: Socket,
    @MessageBody(new ValidationPipe({ whitelist: true, transform: true }))
    payload: UpdateParticipantProfileDto,
  ) {
    const { sessionId, participantId, name, email } = payload;

    const socketParticipantId = this.socketMeta.get(client.id)?.participantId;
    if (!socketParticipantId || socketParticipantId !== participantId) {
      client.emit(WS_EVENTS.ERROR, {
        message: 'Unauthorized',
        code: 'UNAUTHORIZED',
      } satisfies WsErrorPayload);
      return;
    }

    const trimmed = name.trim();
    if (!trimmed || trimmed.length > 50) {
      client.emit(WS_EVENTS.ERROR, {
        message: 'Name must be between 1 and 50 characters',
        code: 'INVALID_NAME',
      } satisfies WsErrorPayload);
      return;
    }

    try {
      const doc = await this.participantsService.updateProfile(participantId, trimmed, email ?? '');
      const participant = this.participantsService.toParticipantDto(doc);
      const updatedPayload: ParticipantUpdatedPayload = { participant };
      this.server.to(sessionId).emit(WS_EVENTS.PARTICIPANT_UPDATED, updatedPayload);
    } catch {
      client.emit(WS_EVENTS.ERROR, {
        message: 'Failed to update profile',
        code: 'UPDATE_FAILED',
      } satisfies WsErrorPayload);
    }
  }

  @SubscribeMessage(WS_EVENTS.UPDATE_HOST_PROFILE)
  async handleUpdateHostProfile(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: UpdateHostProfilePayload,
  ) {
    const { sessionId, hostKey, name, email } = payload;

    const isValid = await this.sessionsService.validateHostKey(sessionId, hostKey);
    if (!isValid) {
      client.emit(WS_EVENTS.ERROR, {
        message: 'Invalid host key',
        code: 'INVALID_HOST_KEY',
      } satisfies WsErrorPayload);
      return;
    }

    const trimmed = name.trim();
    if (!trimmed || trimmed.length > 50) {
      client.emit(WS_EVENTS.ERROR, {
        message: 'Name must be between 1 and 50 characters',
        code: 'INVALID_NAME',
      } satisfies WsErrorPayload);
      return;
    }

    const updated = await this.sessionsService.updateHostProfile(sessionId, trimmed, email ?? '');
    const participants = await this.participantsService.findBySession(sessionId);
    this.server.to(sessionId).emit(WS_EVENTS.SESSION_STATE, {
      session: this.sessionsService.toSessionDto(updated),
      participants,
    } satisfies SessionStatePayload);
  }

  @SubscribeMessage(WS_EVENTS.UPDATE_SESSION_NAME)
  async handleUpdateSessionName(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: UpdateSessionNamePayload,
  ) {
    const { sessionId, hostKey, name } = payload;
    if (!(await this.sessionsService.validateHostKey(sessionId, hostKey))) {
      client.emit(WS_EVENTS.ERROR, {
        message: 'Invalid host key',
        code: 'INVALID_HOST_KEY',
      } satisfies WsErrorPayload);
      return;
    }
    const trimmed = name.trim();
    if (!trimmed || trimmed.length > 100) {
      client.emit(WS_EVENTS.ERROR, {
        message: 'Title must be between 1 and 100 characters',
        code: 'INVALID_NAME',
      } satisfies WsErrorPayload);
      return;
    }
    const updated = await this.sessionsService.updateName(sessionId, trimmed);
    const participants = await this.participantsService.findBySession(sessionId);
    this.server.to(sessionId).emit(WS_EVENTS.SESSION_STATE, {
      session: this.sessionsService.toSessionDto(updated),
      participants,
    } satisfies SessionStatePayload);
  }

  @SubscribeMessage(WS_EVENTS.HOST_RESET_VOTES)
  async handleResetVotes(
    @ConnectedSocket() client: Socket,
    @MessageBody(new ValidationPipe({ whitelist: true, transform: true })) payload: HostActionDto,
  ) {
    const { sessionId, hostKey } = payload;

    const isValid = await this.sessionsService.validateHostKey(sessionId, hostKey);
    if (!isValid) {
      client.emit(WS_EVENTS.ERROR, {
        message: 'Invalid host key',
        code: 'INVALID_HOST_KEY',
      } satisfies WsErrorPayload);
      return;
    }

    const sessionDoc = await this.sessionsService.findById(sessionId);
    if (!sessionDoc) return;

    const currentIndex = sessionDoc.currentIndex;

    // Clear only the current index's votes and revealed state
    this.votes.get(sessionId)?.get(currentIndex)?.clear();
    this.revealed.get(sessionId)?.delete(currentIndex);
    void this.sessionsService.clearTicketVotes(sessionId, currentIndex);
    void this.sessionsService.setTicketRevealed(sessionId, currentIndex, false);

    // Broadcast empty vote state to all clients in the room
    const clearedPayload: VoteUpdatePayload = { hasVoted: [] };
    this.server.to(sessionId).emit(WS_EVENTS.VOTE_UPDATE, clearedPayload);
  }

  @SubscribeMessage(WS_EVENTS.HOST_SET_SAVED_VOTE)
  async handleSetSavedVote(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: HostSetSavedVotePayload,
  ) {
    const { sessionId, hostKey, urlIndex, value } = payload;

    const sessionDoc = await this.sessionsService.findById(sessionId);
    if (!sessionDoc || !this.sessionsService.validateHostKeyForDoc(sessionDoc, hostKey)) {
      client.emit(WS_EVENTS.ERROR, {
        message: 'Invalid host key',
        code: 'INVALID_HOST_KEY',
      } satisfies WsErrorPayload);
      return;
    }

    if (!this.savedVotes.has(sessionId)) this.savedVotes.set(sessionId, new Map());
    // biome-ignore lint/style/noNonNullAssertion: set on the line above
    this.savedVotes.get(sessionId)!.set(urlIndex, value);

    const url = sessionDoc.urls[urlIndex];
    if (url) void this.sessionsService.setStoryPoint(sessionId, this.urlKey(url), value);

    const updatePayload: SavedVotesUpdatedPayload = {
      savedVotes: this.savedVotesRecord(sessionId),
    };
    this.server.to(sessionId).emit(WS_EVENTS.SAVED_VOTES_UPDATED, updatePayload);
  }

  @SubscribeMessage(WS_EVENTS.HOST_RESET_SAVED_VOTE)
  async handleResetSavedVote(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: HostResetSavedVotePayload,
  ) {
    const { sessionId, hostKey, urlIndex } = payload;

    const sessionDoc = await this.sessionsService.findById(sessionId);
    if (!sessionDoc || !this.sessionsService.validateHostKeyForDoc(sessionDoc, hostKey)) {
      client.emit(WS_EVENTS.ERROR, {
        message: 'Invalid host key',
        code: 'INVALID_HOST_KEY',
      } satisfies WsErrorPayload);
      return;
    }

    this.savedVotes.get(sessionId)?.delete(urlIndex);

    const url = sessionDoc.urls[urlIndex];
    if (url) void this.sessionsService.clearStoryPoint(sessionId, this.urlKey(url));

    const updatePayload: SavedVotesUpdatedPayload = {
      savedVotes: this.savedVotesRecord(sessionId),
    };
    this.server.to(sessionId).emit(WS_EVENTS.SAVED_VOTES_UPDATED, updatePayload);
  }
}
