import type { Participant, Session, TeamQueueProgressUpdate } from './types';

// ─── Client → Server ──────────────────────────────────────────────────────────

export interface JoinSessionPayload {
  sessionId: string;
  participantId?: string;
  hostKey?: string;
  /** One-time secret issued on HTTP join; required when reconnecting with participantId */
  participantSecret?: string;
}

export interface HostStartSessionPayload {
  sessionId: string;
  hostKey: string;
}

export interface HostNavigatePayload {
  sessionId: string;
  hostKey: string;
  direction?: 'next' | 'prev';
  index?: number;
  skip?: boolean;
  /** Team queue cursor to persist with this navigation. */
  teamQueueProgress?: TeamQueueProgressUpdate;
}

export interface HostOpenUrlPayload {
  sessionId: string;
  hostKey: string;
  url: string;
}

export interface HostEndSessionPayload {
  sessionId: string;
  hostKey: string;
}

export interface HostAddUrlPayload {
  sessionId: string;
  hostKey: string;
  url: string;
}

export interface HostToggleLockPayload {
  sessionId: string;
  hostKey: string;
  locked: boolean;
}

export interface HostToggleVotingPayload {
  sessionId: string;
  hostKey: string;
  votingEnabled: boolean;
}

export interface HostToggleTeamQueuesPayload {
  sessionId: string;
  hostKey: string;
  teamQueuesEnabled: boolean;
}

export interface HostKickParticipantPayload {
  sessionId: string;
  hostKey: string;
  participantId: string;
}

export interface HostRemoveUrlPayload {
  sessionId: string;
  hostKey: string;
  /** Index of the URL to remove */
  index: number;
}

export interface HostReorderUrlsPayload {
  sessionId: string;
  hostKey: string;
  fromIndex: number;
  toIndex: number;
}

export interface SubmitVotePayload {
  sessionId: string;
  participantId: string;
  value: string;
}

export interface HostRevealVotesPayload {
  sessionId: string;
  hostKey: string;
}

export interface UpdateParticipantProfilePayload {
  sessionId: string;
  participantId: string;
  name: string;
  /** Pass empty string to clear the email */
  email: string;
}

export interface UpdateHostProfilePayload {
  sessionId: string;
  hostKey: string;
  name: string;
  /** Pass empty string to clear the email */
  email: string;
}

// ─── Server → Client ──────────────────────────────────────────────────────────

export interface SessionStatePayload {
  session: Session;
  participants: Participant[];
  /** Participant IDs who have voted in the current round (values hidden until revealed) */
  hasVoted?: string[];
  /** Average vote per URL index for past tickets */
  savedVotes?: Record<number, string>;
  /** Cached ticket scores keyed by Jira key or "url:<url>" — populated on join from MongoDB */
  scores?: Record<string, import('./types').TicketScore>;
}

export interface ParticipantJoinedPayload {
  participant: Participant;
}

export interface ParticipantLeftPayload {
  participantId: string;
}

export interface ParticipantOnlinePayload {
  participantId: string;
  isOnline: boolean;
}

export interface SessionStartedPayload {
  currentUrl: string;
  currentIndex: number;
  total: number;
}

export interface NavigateToPayload {
  url: string;
  index: number;
  total: number;
  /** Average vote per URL index — updated after each navigation */
  savedVotes?: Record<number, string>;
  /**
   * Present only on initial join / page reload — restores who has voted this round.
   * When absent the client treats this as a real navigation and clears voting state.
   */
  hasVoted?: string[];
  /** Present when the host had already revealed votes before the client reconnected. */
  revealedVotes?: Record<string, string>;
  revealedAverage?: string;
}

export interface OpenTabPayload {
  url: string;
}

/**
 * Broadcast when any participant votes. Only reveals WHO has voted,
 * not the actual values — values are hidden until the host reveals them.
 */
export interface VoteUpdatePayload {
  hasVoted: string[]; // participant IDs who have voted this round
}

/**
 * Broadcast by the host to reveal all votes at once.
 */
export interface VotesRevealedPayload {
  votes: Record<string, string>; // participantId → value
  average: string; // computed average (numeric mean or mode of non-numeric values)
}

export interface ParticipantUpdatedPayload {
  participant: Participant;
}

export interface WsErrorPayload {
  message: string;
  code: string;
}

export interface HostGroomingCompletePayload {
  sessionId: string;
  hostKey: string;
}

export interface HostResetVotesPayload {
  sessionId: string;
  hostKey: string;
}

export interface HostSetSavedVotePayload {
  sessionId: string;
  hostKey: string;
  urlIndex: number;
  value: string;
}

export interface HostResetSavedVotePayload {
  sessionId: string;
  hostKey: string;
  urlIndex: number;
}

export interface SavedVotesUpdatedPayload {
  savedVotes: Record<number, string>;
}

export interface TeamQueueProgressUpdatedPayload {
  teamQueueProgress: Record<string, number>;
}

export interface TeamQueueCompletedPayload {
  queueName: string;
}

export interface TicketScoreUpdatePayload {
  /** Jira issue key (e.g. "PROJ-123") or "url:<raw-url>" for non-Jira tickets */
  key: string;
  score: import('./types').TicketScore;
}

// ─── Event name constants ─────────────────────────────────────────────────────

export const WS_EVENTS = {
  // Client → Server
  JOIN_SESSION: 'join_session',
  HOST_START_SESSION: 'host_start_session',
  HOST_NAVIGATE: 'host_navigate',
  HOST_OPEN_URL: 'host_open_url',
  HOST_END_SESSION: 'host_end_session',
  HOST_ADD_URL: 'host_add_url',
  HOST_TOGGLE_LOCK: 'host_toggle_lock',
  HOST_TOGGLE_VOTING: 'host_toggle_voting',
  HOST_TOGGLE_TEAM_QUEUES: 'host_toggle_team_queues',
  HOST_KICK_PARTICIPANT: 'host_kick_participant',
  HOST_REMOVE_URL: 'host_remove_url',
  HOST_REORDER_URLS: 'host_reorder_urls',
  SUBMIT_VOTE: 'submit_vote',
  HOST_REVEAL_VOTES: 'host_reveal_votes',
  LEAVE_SESSION: 'leave_session',
  UPDATE_PARTICIPANT_PROFILE: 'update_participant_profile',
  UPDATE_HOST_PROFILE: 'update_host_profile',

  GROOMING_COMPLETE: 'grooming_complete',
  TEAM_QUEUE_COMPLETED: 'team_queue_completed',
  HOST_SET_SAVED_VOTE: 'host_set_saved_vote',
  HOST_RESET_SAVED_VOTE: 'host_reset_saved_vote',
  HOST_RESET_VOTES: 'host_reset_votes',

  // Server → Client
  SESSION_STATE: 'session_state',
  PARTICIPANT_JOINED: 'participant_joined',
  PARTICIPANT_LEFT: 'participant_left',
  PARTICIPANT_ONLINE: 'participant_online',
  PARTICIPANT_UPDATED: 'participant_updated',
  SESSION_STARTED: 'session_started',
  NAVIGATE_TO: 'navigate_to',
  OPEN_TAB: 'open_tab',
  SESSION_ENDED: 'session_ended',
  KICKED: 'kicked',
  VOTE_UPDATE: 'vote_update',
  VOTES_REVEALED: 'votes_revealed',
  SAVED_VOTES_UPDATED: 'saved_votes_updated',
  TEAM_QUEUE_PROGRESS_UPDATED: 'team_queue_progress_updated',
  TICKET_SCORE_UPDATE: 'ticket_score_update',
  ERROR: 'error',
} as const;
