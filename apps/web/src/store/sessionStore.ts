import type { Participant, Session } from '@tabpilot/shared';
import { create } from 'zustand';

// ─── Saved session record (host or participant) ───────────────────────────────

export interface SavedSession {
  sessionId: string;
  name: string;
  joinCode: string;
  urlCount: number;
  expiresAt: string;
  createdAt: string;
  role: 'host' | 'participant';
  participantId?: string; // only for role === 'participant'
}

const SAVED_SESSIONS_KEY = 'tabpilot_saved_sessions';
// Credentials stay in memory only. Browser storage is readable by any script
// running on this origin, so a persistent copy would expose session access.
const participantSecrets = new Map<string, string>();

// Remove credentials written by older versions so they do not remain at rest.
try {
  for (let index = localStorage.length - 1; index >= 0; index -= 1) {
    const key = localStorage.key(index);
    if (key?.startsWith('tabpilot_participant_secret_')) localStorage.removeItem(key);
  }
} catch {
  // Storage may be unavailable in restricted browser contexts.
}

function readSavedSessions(): SavedSession[] {
  try {
    const raw = localStorage.getItem(SAVED_SESSIONS_KEY);
    if (!raw) return [];
    const parsed: SavedSession[] = JSON.parse(raw);
    // Filter out sessions that have already expired
    const now = new Date();
    return parsed.filter((s) => new Date(s.expiresAt) > now);
  } catch {
    return [];
  }
}

function writeSavedSessions(sessions: SavedSession[]) {
  try {
    localStorage.setItem(SAVED_SESSIONS_KEY, JSON.stringify(sessions));
  } catch {
    // localStorage may not be available
  }
}

// ─── Store interface ──────────────────────────────────────────────────────────

interface SessionStore {
  session: Session | null;
  participants: Participant[];
  participantId: string | null;
  participantSecret: string | null;
  isHost: boolean;
  hostKey: string | null;
  tabSyncEnabled: boolean;
  syncedWindow: Window | null;
  currentNavigateUrl: string | null;

  /** Participant IDs who have voted in the current round (values hidden until revealed) */
  votedParticipantIds: string[];
  /** Actual vote values after host reveals — null means not yet revealed */
  revealedVotes: Record<string, string> | null;
  /** Average vote per URL index for past tickets */
  savedVotesMap: Record<number, string>;

  setSession: (session: Session | null) => void;
  setParticipants: (participants: Participant[]) => void;
  addParticipant: (participant: Participant) => void;
  removeParticipant: (participantId: string) => void;
  updateParticipant: (participantId: string, updates: Partial<Participant>) => void;
  setParticipantId: (id: string | null) => void;
  setParticipantSecret: (secret: string | null) => void;
  setIsHost: (isHost: boolean) => void;
  setHostKey: (hostKey: string | null) => void;
  setTabSyncEnabled: (enabled: boolean) => void;
  setSyncedWindow: (win: Window | null) => void;
  setCurrentNavigateUrl: (url: string | null) => void;
  setVotedParticipantIds: (ids: string[]) => void;
  setRevealedVotes: (votes: Record<string, string> | null) => void;
  setSavedVotesMap: (map: Record<number, string>) => void;
  clearVotingRound: () => void;

  saveHostKey: (sessionId: string, hostKey: string) => void;
  loadHostKey: (sessionId: string) => string | null;
  saveHostInviteKey: (sessionId: string, inviteKey: string) => void;
  loadHostInviteKey: (sessionId: string) => string | null;
  saveParticipantId: (sessionId: string, participantId: string) => void;
  loadParticipantId: (sessionId: string) => string | null;
  saveParticipantSecret: (sessionId: string, secret: string) => void;
  loadParticipantSecret: (sessionId: string) => string | null;

  getSavedSessions: () => SavedSession[];
  saveHostSession: (session: Session, hostKey: string, hostInviteKey?: string) => void;
  saveParticipantSession: (session: Session, participantId: string) => void;
  removeSavedSession: (sessionId: string) => void;

  /** Resets live session state only; does not clear saved sessions. */
  reset: () => void;
}

const initialState = {
  session: null,
  participants: [],
  participantId: null,
  participantSecret: null,
  isHost: false,
  hostKey: null,
  tabSyncEnabled: false,
  syncedWindow: null,
  currentNavigateUrl: null,
  votedParticipantIds: [] as string[],
  revealedVotes: null as Record<string, string> | null,
  savedVotesMap: {} as Record<number, string>,
};

export const useSessionStore = create<SessionStore>((set, get) => ({
  ...initialState,

  setSession: (session) => set({ session }),

  setParticipants: (participants) => set({ participants }),

  addParticipant: (participant) =>
    set((state) => {
      const exists = state.participants.some((p) => p.id === participant.id);
      if (exists) {
        return {
          participants: state.participants.map((p) =>
            p.id === participant.id ? { ...p, ...participant } : p,
          ),
        };
      }
      return { participants: [...state.participants, participant] };
    }),

  removeParticipant: (participantId) =>
    set((state) => ({
      participants: state.participants.filter((p) => p.id !== participantId),
    })),

  updateParticipant: (participantId, updates) =>
    set((state) => ({
      participants: state.participants.map((p) =>
        p.id === participantId ? { ...p, ...updates } : p,
      ),
    })),

  setParticipantId: (id) => set({ participantId: id }),
  setParticipantSecret: (secret) => set({ participantSecret: secret }),
  setIsHost: (isHost) => set({ isHost }),
  setHostKey: (hostKey) => set({ hostKey }),
  setTabSyncEnabled: (enabled) => set({ tabSyncEnabled: enabled }),
  setSyncedWindow: (win) => set({ syncedWindow: win }),
  setCurrentNavigateUrl: (url) => set({ currentNavigateUrl: url }),
  setVotedParticipantIds: (ids) => set({ votedParticipantIds: ids }),
  setRevealedVotes: (votes) => set({ revealedVotes: votes }),
  setSavedVotesMap: (map) => set({ savedVotesMap: map }),
  clearVotingRound: () => set({ votedParticipantIds: [], revealedVotes: null }),

  // ── Per-session key helpers ────────────────────────────────────────────────

  saveHostKey: (sessionId, hostKey) => {
    try {
      localStorage.setItem(`tabpilot_host_${sessionId}`, hostKey);
    } catch {
      // ignore
    }
  },

  loadHostKey: (sessionId) => {
    try {
      return localStorage.getItem(`tabpilot_host_${sessionId}`);
    } catch {
      return null;
    }
  },

  saveHostInviteKey: (sessionId, inviteKey) => {
    try {
      localStorage.setItem(`tabpilot_host_invite_${sessionId}`, inviteKey);
    } catch {
      // ignore
    }
  },

  loadHostInviteKey: (sessionId) => {
    try {
      return localStorage.getItem(`tabpilot_host_invite_${sessionId}`);
    } catch {
      return null;
    }
  },

  saveParticipantId: (sessionId, participantId) => {
    try {
      localStorage.setItem(`tabpilot_participant_${sessionId}`, participantId);
    } catch {
      // ignore
    }
  },

  loadParticipantId: (sessionId) => {
    try {
      return localStorage.getItem(`tabpilot_participant_${sessionId}`);
    } catch {
      return null;
    }
  },

  saveParticipantSecret: (sessionId, secret) => {
    participantSecrets.set(sessionId, secret);
  },

  loadParticipantSecret: (sessionId) => {
    return participantSecrets.get(sessionId) ?? null;
  },

  // ── Saved sessions list ───────────────────────────────────────────────────

  getSavedSessions: () => readSavedSessions(),

  saveHostSession: (session, hostKey, hostInviteKey?: string) => {
    get().saveHostKey(session.id, hostKey);
    if (hostInviteKey) get().saveHostInviteKey(session.id, hostInviteKey);

    const existing = readSavedSessions().filter((s) => s.sessionId !== session.id);
    const record: SavedSession = {
      sessionId: session.id,
      name: session.name,
      joinCode: session.joinCode,
      urlCount: session.urls.length,
      expiresAt: session.expiresAt,
      createdAt: session.createdAt,
      role: 'host',
    };
    writeSavedSessions([record, ...existing]);
  },

  saveParticipantSession: (session, participantId) => {
    get().saveParticipantId(session.id, participantId);

    const existing = readSavedSessions().filter((s) => s.sessionId !== session.id);
    const record: SavedSession = {
      sessionId: session.id,
      name: session.name,
      joinCode: session.joinCode,
      urlCount: session.urls.length,
      expiresAt: session.expiresAt,
      createdAt: session.createdAt,
      role: 'participant',
      participantId,
    };
    writeSavedSessions([record, ...existing]);
  },

  removeSavedSession: (sessionId) => {
    const updated = readSavedSessions().filter((s) => s.sessionId !== sessionId);
    writeSavedSessions(updated);
    try {
      localStorage.removeItem(`tabpilot_host_${sessionId}`);
      localStorage.removeItem(`tabpilot_host_invite_${sessionId}`);
      localStorage.removeItem(`tabpilot_participant_${sessionId}`);
      participantSecrets.delete(sessionId);
    } catch {
      // ignore
    }
  },

  // ── Live session reset ────────────────────────────────────────────────────

  reset: () => {
    const state = get();
    if (state.syncedWindow && !state.syncedWindow.closed) {
      state.syncedWindow.close();
    }
    set(initialState);
  },
}));
