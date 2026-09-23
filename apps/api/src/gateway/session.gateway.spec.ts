import 'reflect-metadata';
import { Test, type TestingModule } from '@nestjs/testing';
import type { Participant, Session } from '@tabpilot/shared';
import { WS_EVENTS } from '@tabpilot/shared';
import type { Socket } from 'socket.io';
import type { ParticipantDoc, ParticipantDocument } from '../participants/participant.schema';
import { ParticipantsService } from '../participants/participants.service';
import type { SessionDoc, SessionDocument } from '../sessions/session.schema';
import { SessionsService } from '../sessions/sessions.service';
import { SessionGateway } from './session.gateway';

// ---------------------------------------------------------------------------
// Factories for mocked documents / DTOs
// ---------------------------------------------------------------------------
function makeSessionDoc(
  overrides: Partial<SessionDoc & { state: string; currentIndex: number }> = {},
): SessionDocument {
  const base: Partial<SessionDoc> = {
    sessionId: 'session-1',
    name: 'Test',
    joinCode: 'ABC123',
    hostName: 'Host',
    hostKeyHash: 'hash',
    hostInviteKeyHash: 'invite-hash',
    coHosts: [],
    urls: ['https://example.com', 'https://other.com'],
    currentIndex: 0,
    state: 'waiting' as const,
    votingEnabled: false,
    isLocked: false,
    votes: [],
    revealedIndices: [],
    storyPoints: new Map(),
    expiresAt: new Date(Date.now() + 86_400_000),
    ...overrides,
  };
  return {
    ...base,
    toObject: () => ({ ...base, createdAt: new Date(), updatedAt: new Date() }),
  } as unknown as SessionDocument;
}

function makeParticipantDoc(overrides: Partial<ParticipantDoc> = {}): ParticipantDocument {
  const base: Partial<ParticipantDoc> = {
    participantId: 'p-1',
    sessionId: 'session-1',
    name: 'Alice',
    avatarUrl: 'https://api.dicebear.com/...',
    isOnline: false,
    ...overrides,
  };
  return {
    ...base,
    toObject: () => ({ ...base, createdAt: new Date() }),
  } as unknown as ParticipantDocument;
}

function makeParticipantDto(overrides: Partial<Participant> = {}): Participant {
  return {
    id: 'p-1',
    sessionId: 'session-1',
    name: 'Alice',
    avatarUrl: 'https://api.dicebear.com/...',
    isOnline: false,
    joinedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeSessionDto(overrides: Partial<Session> = {}): Session {
  return {
    id: 'session-1',
    name: 'Test',
    joinCode: 'ABC123',
    hostName: 'Host',
    coHosts: [],
    urls: ['https://example.com', 'https://other.com'],
    currentIndex: 0,
    state: 'waiting',
    votingEnabled: false,
    isLocked: false,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Mock socket helper
// ---------------------------------------------------------------------------
function makeMockSocket(id = 'socket-1'): jest.Mocked<Socket> {
  return {
    id,
    emit: jest.fn(),
    join: jest.fn().mockResolvedValue(undefined),
    to: jest.fn().mockReturnThis(),
  } as unknown as jest.Mocked<Socket>;
}

// ---------------------------------------------------------------------------
// Mock services
// ---------------------------------------------------------------------------
function makeMockSessionsService(): jest.Mocked<SessionsService> {
  return {
    findById: jest.fn(),
    findByJoinCode: jest.fn(),
    validateHostKey: jest.fn(),
    validateHostKeyForDoc: jest.fn().mockReturnValue(true),
    validateHostInviteKey: jest.fn(),
    joinAsCoHost: jest.fn(),
    updateState: jest.fn(),
    updateCurrentIndex: jest.fn(),
    toSessionDto: jest.fn(),
    create: jest.fn(),
    setLocked: jest.fn(),
    setVotingEnabled: jest.fn(),
    addUrl: jest.fn(),
    removeUrl: jest.fn(),
    reorderUrls: jest.fn(),
    updateHostProfile: jest.fn(),
    setTicketVote: jest.fn().mockResolvedValue(undefined),
    clearTicketVotes: jest.fn().mockResolvedValue(undefined),
    setTicketRevealed: jest.fn().mockResolvedValue(undefined),
    setStoryPoint: jest.fn().mockResolvedValue(undefined),
    clearStoryPoint: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<SessionsService>;
}

function makeMockParticipantsService(): jest.Mocked<ParticipantsService> {
  return {
    findById: jest.fn(),
    findBySession: jest.fn(),
    create: jest.fn(),
    updateSocketId: jest.fn(),
    updateOnlineStatus: jest.fn(),
    toParticipantDto: jest.fn(),
    deleteParticipant: jest.fn().mockResolvedValue(undefined),
    updateProfile: jest.fn(),
    verifyParticipantSecret: jest.fn().mockResolvedValue(true),
  } as unknown as jest.Mocked<ParticipantsService>;
}

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------
describe('SessionGateway', () => {
  let gateway: SessionGateway;
  let sessionsService: jest.Mocked<SessionsService>;
  let participantsService: jest.Mocked<ParticipantsService>;
  let mockServer: { to: jest.Mock; emit: jest.Mock };

  beforeEach(async () => {
    sessionsService = makeMockSessionsService();
    participantsService = makeMockParticipantsService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SessionGateway,
        { provide: SessionsService, useValue: sessionsService },
        { provide: ParticipantsService, useValue: participantsService },
      ],
    }).compile();

    gateway = module.get<SessionGateway>(SessionGateway);

    // Attach a mock Server so server.to(...).emit(...) works
    mockServer = {
      to: jest.fn().mockReturnThis(),
      emit: jest.fn(),
    };
    (gateway as unknown as { server: typeof mockServer }).server = mockServer;
  });

  // -------------------------------------------------------------------------
  // handleJoinSession()
  // -------------------------------------------------------------------------
  describe('handleJoinSession()', () => {
    it('should emit error if session not found', async () => {
      const client = makeMockSocket();
      sessionsService.findById.mockResolvedValue(null);

      await gateway.handleJoinSession(client, { sessionId: 'bad-id' });

      expect(client.emit).toHaveBeenCalledWith(
        WS_EVENTS.ERROR,
        expect.objectContaining({ code: 'SESSION_NOT_FOUND' }),
      );
    });

    it('should emit error if session has ended', async () => {
      const client = makeMockSocket();
      const endedDoc = makeSessionDoc({ state: 'ended' as const });
      sessionsService.findById.mockResolvedValue(endedDoc);
      sessionsService.validateHostKey.mockResolvedValue(false);
      sessionsService.toSessionDto.mockReturnValue(makeSessionDto({ state: 'ended' }));
      participantsService.findBySession.mockResolvedValue([]);
      participantsService.findById.mockResolvedValue(
        makeParticipantDoc({ sessionId: 'session-1' }),
      );
      participantsService.updateSocketId.mockResolvedValue(makeParticipantDoc());
      participantsService.updateOnlineStatus.mockResolvedValue(makeParticipantDoc());

      // A participant trying to join an ended session still receives session_state
      // with ended state; the gateway does not emit an explicit "ended" error.
      // The client gets a session_state with state=ended.
      await gateway.handleJoinSession(client, {
        sessionId: 'session-1',
        participantId: 'p-1',
        participantSecret: 'test-secret',
      });

      const calls = (client.emit as jest.Mock).mock.calls;
      const sessionStateCall = calls.find(([event]: [string]) => event === WS_EVENTS.SESSION_STATE);
      expect(sessionStateCall).toBeDefined();
      expect(sessionStateCall[1].session.state).toBe('ended');
    });

    it('should emit UNAUTHORIZED error when participantId is provided without participantSecret', async () => {
      const client = makeMockSocket();
      sessionsService.findById.mockResolvedValue(makeSessionDoc());
      sessionsService.validateHostKey.mockResolvedValue(false);

      await gateway.handleJoinSession(client, {
        sessionId: 'session-1',
        participantId: 'p-1',
        // no participantSecret
      });

      expect(client.emit).toHaveBeenCalledWith(
        WS_EVENTS.ERROR,
        expect.objectContaining({ code: 'UNAUTHORIZED' }),
      );
    });

    it('should emit UNAUTHORIZED error when participantSecret is invalid', async () => {
      const client = makeMockSocket();
      sessionsService.findById.mockResolvedValue(makeSessionDoc());
      sessionsService.validateHostKey.mockResolvedValue(false);
      participantsService.verifyParticipantSecret.mockResolvedValue(false);

      await gateway.handleJoinSession(client, {
        sessionId: 'session-1',
        participantId: 'p-1',
        participantSecret: 'wrong-secret',
      });

      expect(client.emit).toHaveBeenCalledWith(
        WS_EVENTS.ERROR,
        expect.objectContaining({ code: 'UNAUTHORIZED' }),
      );
    });

    it('should emit error if host key is invalid', async () => {
      const client = makeMockSocket();
      sessionsService.findById.mockResolvedValue(makeSessionDoc());
      sessionsService.validateHostKey.mockResolvedValue(false);

      await gateway.handleJoinSession(client, {
        sessionId: 'session-1',
        hostKey: 'wrong-key',
      });

      expect(client.emit).toHaveBeenCalledWith(
        WS_EVENTS.ERROR,
        expect.objectContaining({ code: 'INVALID_HOST_KEY' }),
      );
    });

    it('should emit session_state to joining client on success', async () => {
      const client = makeMockSocket();
      sessionsService.findById.mockResolvedValue(makeSessionDoc());
      sessionsService.validateHostKey.mockResolvedValue(true);
      sessionsService.toSessionDto.mockReturnValue(makeSessionDto());
      participantsService.findBySession.mockResolvedValue([]);

      await gateway.handleJoinSession(client, {
        sessionId: 'session-1',
        hostKey: 'valid-key',
      });

      expect(client.emit).toHaveBeenCalledWith(
        WS_EVENTS.SESSION_STATE,
        expect.objectContaining({ session: expect.any(Object) }),
      );
    });

    it('should broadcast participant_online when participant reconnects (wasOffline)', async () => {
      const client = makeMockSocket();
      const participantDoc = makeParticipantDoc({ isOnline: false });
      sessionsService.findById.mockResolvedValue(makeSessionDoc());
      sessionsService.validateHostKey.mockResolvedValue(false);
      sessionsService.toSessionDto.mockReturnValue(makeSessionDto());
      participantsService.findById.mockResolvedValue(participantDoc);
      participantsService.findBySession.mockResolvedValue([]);
      participantsService.updateSocketId.mockResolvedValue(participantDoc);
      participantsService.updateOnlineStatus.mockResolvedValue(
        makeParticipantDoc({ isOnline: true }),
      );
      participantsService.toParticipantDto.mockReturnValue(makeParticipantDto());

      await gateway.handleJoinSession(client, {
        sessionId: 'session-1',
        participantId: 'p-1',
        participantSecret: 'test-secret',
      });

      // server.to(sessionId).emit should have been called with PARTICIPANT_ONLINE
      expect(mockServer.to).toHaveBeenCalledWith('session-1');
      expect(mockServer.emit).toHaveBeenCalledWith(
        WS_EVENTS.PARTICIPANT_ONLINE,
        expect.objectContaining({ participantId: 'p-1', isOnline: true }),
      );
    });

    it('should emit navigate_to if session is already active', async () => {
      const client = makeMockSocket();
      const activeDoc = makeSessionDoc({ state: 'active' as const, currentIndex: 0 });
      sessionsService.findById.mockResolvedValue(activeDoc);
      sessionsService.validateHostKey.mockResolvedValue(true);
      sessionsService.toSessionDto.mockReturnValue(makeSessionDto({ state: 'active' }));
      participantsService.findBySession.mockResolvedValue([]);

      await gateway.handleJoinSession(client, {
        sessionId: 'session-1',
        hostKey: 'valid-key',
      });

      expect(client.emit).toHaveBeenCalledWith(
        WS_EVENTS.NAVIGATE_TO,
        expect.objectContaining({ url: 'https://example.com', index: 0 }),
      );
    });

    it('should allow a co-host to join with their own host key', async () => {
      const client = makeMockSocket();
      // validateHostKey returns true for co-host keys too (checked against coHosts array)
      sessionsService.findById.mockResolvedValue(makeSessionDoc());
      sessionsService.validateHostKey.mockResolvedValue(true);
      sessionsService.toSessionDto.mockReturnValue(makeSessionDto());
      participantsService.findBySession.mockResolvedValue([]);

      await gateway.handleJoinSession(client, {
        sessionId: 'session-1',
        hostKey: 'co-host-key',
      });

      expect(client.emit).toHaveBeenCalledWith(
        WS_EVENTS.SESSION_STATE,
        expect.objectContaining({ session: expect.any(Object) }),
      );
      // Should NOT emit an error
      const errorCall = (client.emit as jest.Mock).mock.calls.find(
        ([event]: [string]) => event === WS_EVENTS.ERROR,
      );
      expect(errorCall).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // handleStartSession()
  // -------------------------------------------------------------------------
  describe('handleStartSession()', () => {
    it('should emit error if host key is invalid', async () => {
      const client = makeMockSocket();
      sessionsService.validateHostKey.mockResolvedValue(false);

      await gateway.handleStartSession(client, {
        sessionId: 'session-1',
        hostKey: 'wrong',
      });

      expect(client.emit).toHaveBeenCalledWith(
        WS_EVENTS.ERROR,
        expect.objectContaining({ code: 'INVALID_HOST_KEY' }),
      );
    });

    it('should update session state to active', async () => {
      const client = makeMockSocket();
      const activeDoc = makeSessionDoc({ state: 'active' as const });
      sessionsService.validateHostKey.mockResolvedValue(true);
      sessionsService.updateState.mockResolvedValue(activeDoc);
      sessionsService.toSessionDto.mockReturnValue(makeSessionDto({ state: 'active' }));
      participantsService.findBySession.mockResolvedValue([]);

      await gateway.handleStartSession(client, {
        sessionId: 'session-1',
        hostKey: 'valid',
      });

      expect(sessionsService.updateState).toHaveBeenCalledWith('session-1', 'active');
    });

    it('should broadcast session_started to the room', async () => {
      const client = makeMockSocket();
      const activeDoc = makeSessionDoc({ state: 'active' as const });
      sessionsService.validateHostKey.mockResolvedValue(true);
      sessionsService.updateState.mockResolvedValue(activeDoc);
      sessionsService.toSessionDto.mockReturnValue(makeSessionDto({ state: 'active' }));
      participantsService.findBySession.mockResolvedValue([]);

      await gateway.handleStartSession(client, {
        sessionId: 'session-1',
        hostKey: 'valid',
      });

      expect(mockServer.emit).toHaveBeenCalledWith(
        WS_EVENTS.SESSION_STARTED,
        expect.objectContaining({ currentIndex: 0 }),
      );
    });

    it('should broadcast navigate_to with the first URL to the room', async () => {
      const client = makeMockSocket();
      const activeDoc = makeSessionDoc({ state: 'active' as const });
      sessionsService.validateHostKey.mockResolvedValue(true);
      sessionsService.updateState.mockResolvedValue(activeDoc);
      sessionsService.toSessionDto.mockReturnValue(makeSessionDto({ state: 'active' }));
      participantsService.findBySession.mockResolvedValue([]);

      await gateway.handleStartSession(client, {
        sessionId: 'session-1',
        hostKey: 'valid',
      });

      expect(mockServer.emit).toHaveBeenCalledWith(
        WS_EVENTS.NAVIGATE_TO,
        expect.objectContaining({ url: 'https://example.com', index: 0 }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // handleNavigate()
  // -------------------------------------------------------------------------
  describe('handleNavigate()', () => {
    it('should emit error if host key is invalid', async () => {
      const client = makeMockSocket();
      sessionsService.findById.mockResolvedValue(makeSessionDoc());
      sessionsService.validateHostKeyForDoc.mockReturnValue(false);

      await gateway.handleNavigate(client, {
        sessionId: 'session-1',
        hostKey: 'wrong',
        direction: 'next',
      });

      expect(client.emit).toHaveBeenCalledWith(
        WS_EVENTS.ERROR,
        expect.objectContaining({ code: 'INVALID_HOST_KEY' }),
      );
    });

    it('should navigate to the next URL (currentIndex + 1)', async () => {
      const client = makeMockSocket();
      const sessionDoc = makeSessionDoc({ currentIndex: 0 });
      sessionsService.validateHostKey.mockResolvedValue(true);
      sessionsService.findById.mockResolvedValue(sessionDoc);
      sessionsService.updateCurrentIndex.mockResolvedValue(makeSessionDoc({ currentIndex: 1 }));

      await gateway.handleNavigate(client, {
        sessionId: 'session-1',
        hostKey: 'valid',
        direction: 'next',
      });

      expect(sessionsService.updateCurrentIndex).toHaveBeenCalledWith('session-1', 1);
      expect(mockServer.emit).toHaveBeenCalledWith(
        WS_EVENTS.NAVIGATE_TO,
        expect.objectContaining({ url: 'https://other.com', index: 1 }),
      );
    });

    it('should navigate to the previous URL (currentIndex - 1)', async () => {
      const client = makeMockSocket();
      const sessionDoc = makeSessionDoc({ currentIndex: 1 });
      sessionsService.validateHostKey.mockResolvedValue(true);
      sessionsService.findById.mockResolvedValue(sessionDoc);
      sessionsService.updateCurrentIndex.mockResolvedValue(makeSessionDoc({ currentIndex: 0 }));

      await gateway.handleNavigate(client, {
        sessionId: 'session-1',
        hostKey: 'valid',
        direction: 'prev',
      });

      expect(sessionsService.updateCurrentIndex).toHaveBeenCalledWith('session-1', 0);
      expect(mockServer.emit).toHaveBeenCalledWith(
        WS_EVENTS.NAVIGATE_TO,
        expect.objectContaining({ url: 'https://example.com', index: 0 }),
      );
    });

    it('should clamp to 0 on prev when already at the first URL', async () => {
      const client = makeMockSocket();
      const sessionDoc = makeSessionDoc({ currentIndex: 0 });
      sessionsService.validateHostKey.mockResolvedValue(true);
      sessionsService.findById.mockResolvedValue(sessionDoc);

      await gateway.handleNavigate(client, {
        sessionId: 'session-1',
        hostKey: 'valid',
        direction: 'prev',
      });

      // Index is already 0 → no change → updateCurrentIndex should NOT be called
      expect(sessionsService.updateCurrentIndex).not.toHaveBeenCalled();
    });

    it('should clamp to length-1 on next when already at the last URL', async () => {
      const client = makeMockSocket();
      const sessionDoc = makeSessionDoc({ currentIndex: 1 }); // last index (2 URLs)
      sessionsService.validateHostKey.mockResolvedValue(true);
      sessionsService.findById.mockResolvedValue(sessionDoc);

      await gateway.handleNavigate(client, {
        sessionId: 'session-1',
        hostKey: 'valid',
        direction: 'next',
      });

      // Index already at last → no change → updateCurrentIndex should NOT be called
      expect(sessionsService.updateCurrentIndex).not.toHaveBeenCalled();
    });

    it('should navigate to a specific index when provided', async () => {
      const client = makeMockSocket();
      const sessionDoc = makeSessionDoc({ currentIndex: 0 });
      sessionsService.validateHostKey.mockResolvedValue(true);
      sessionsService.findById.mockResolvedValue(sessionDoc);
      sessionsService.updateCurrentIndex.mockResolvedValue(makeSessionDoc({ currentIndex: 1 }));

      await gateway.handleNavigate(client, {
        sessionId: 'session-1',
        hostKey: 'valid',
        index: 1,
      });

      expect(sessionsService.updateCurrentIndex).toHaveBeenCalledWith('session-1', 1);
    });

    it('should not emit if the index has not changed', async () => {
      const client = makeMockSocket();
      // currentIndex is already 0, we request index 0
      const sessionDoc = makeSessionDoc({ currentIndex: 0 });
      sessionsService.validateHostKey.mockResolvedValue(true);
      sessionsService.findById.mockResolvedValue(sessionDoc);

      await gateway.handleNavigate(client, {
        sessionId: 'session-1',
        hostKey: 'valid',
        index: 0,
      });

      expect(sessionsService.updateCurrentIndex).not.toHaveBeenCalled();
      expect(mockServer.emit).not.toHaveBeenCalledWith(WS_EVENTS.NAVIGATE_TO, expect.anything());
    });

    it('should mark index as skipped in savedVotes when skip is true', async () => {
      const client = makeMockSocket();
      const sessionDoc = makeSessionDoc({ currentIndex: 0 });
      sessionsService.validateHostKey.mockResolvedValue(true);
      sessionsService.findById.mockResolvedValue(sessionDoc);
      sessionsService.updateCurrentIndex.mockResolvedValue(makeSessionDoc({ currentIndex: 1 }));

      await gateway.handleNavigate(client, {
        sessionId: 'session-1',
        hostKey: 'valid',
        direction: 'next',
        skip: true,
      });

      const emitCalls = (mockServer.emit as jest.Mock).mock.calls;
      const navCall = emitCalls.find(([event]: [string]) => event === WS_EVENTS.NAVIGATE_TO);
      expect(navCall[1].savedVotes).toEqual({ 0: 'skipped' });
    });

    it('should not persist story point to DB when skip is true', async () => {
      const client = makeMockSocket();
      const sessionDoc = makeSessionDoc({ currentIndex: 0 });
      sessionsService.validateHostKey.mockResolvedValue(true);
      sessionsService.findById.mockResolvedValue(sessionDoc);
      sessionsService.updateCurrentIndex.mockResolvedValue(makeSessionDoc({ currentIndex: 1 }));

      await gateway.handleNavigate(client, {
        sessionId: 'session-1',
        hostKey: 'valid',
        direction: 'next',
        skip: true,
      });

      expect(sessionsService.setStoryPoint).not.toHaveBeenCalled();
    });

    it('should not overwrite an existing savedVote when skip is true', async () => {
      const client1 = makeMockSocket('socket-1');
      (gateway as unknown as { socketMeta: Map<string, object> }).socketMeta.set('socket-1', {
        sessionId: 'session-1',
        participantId: 'p-1',
        isHost: false,
      });
      sessionsService.validateHostKey.mockResolvedValue(true);
      const activeDoc = makeSessionDoc({ votingEnabled: true, state: 'active', currentIndex: 0 });
      sessionsService.findById.mockResolvedValue(activeDoc);
      sessionsService.updateCurrentIndex.mockResolvedValue(makeSessionDoc({ currentIndex: 1 }));

      // Votes were cast — skip should still mark as "skipped", not save vote average
      await gateway.handleSubmitVote(client1, {
        sessionId: 'session-1',
        participantId: 'p-1',
        value: '5',
      });

      await gateway.handleNavigate(client1, {
        sessionId: 'session-1',
        hostKey: 'valid',
        direction: 'next',
        skip: true,
      });

      const emitCalls = (mockServer.emit as jest.Mock).mock.calls;
      const navCall = emitCalls.find(([event]: [string]) => event === WS_EVENTS.NAVIGATE_TO);
      expect(navCall[1].savedVotes).toEqual({ 0: 'skipped' });
    });
  });

  // -------------------------------------------------------------------------
  // handleOpenUrl()
  // -------------------------------------------------------------------------
  describe('handleOpenUrl()', () => {
    it('should broadcast open_tab with a valid https URL', async () => {
      const client = makeMockSocket();
      sessionsService.validateHostKey.mockResolvedValue(true);

      await gateway.handleOpenUrl(client, {
        sessionId: 'session-1',
        hostKey: 'valid',
        url: 'https://example.com',
      });

      expect(mockServer.emit).toHaveBeenCalledWith(
        WS_EVENTS.OPEN_TAB,
        expect.objectContaining({ url: 'https://example.com' }),
      );
    });

    it('should emit error for a non-http/https URL (javascript: scheme)', async () => {
      const client = makeMockSocket();
      sessionsService.validateHostKey.mockResolvedValue(true);

      await gateway.handleOpenUrl(client, {
        sessionId: 'session-1',
        hostKey: 'valid',
        url: 'javascript:alert(1)',
      });

      expect(client.emit).toHaveBeenCalledWith(
        WS_EVENTS.ERROR,
        expect.objectContaining({ code: 'INVALID_URL_PROTOCOL' }),
      );
    });

    it('should emit error for a completely invalid URL', async () => {
      const client = makeMockSocket();
      sessionsService.validateHostKey.mockResolvedValue(true);

      await gateway.handleOpenUrl(client, {
        sessionId: 'session-1',
        hostKey: 'valid',
        url: 'not-a-url',
      });

      expect(client.emit).toHaveBeenCalledWith(
        WS_EVENTS.ERROR,
        expect.objectContaining({ code: 'INVALID_URL' }),
      );
    });

    it('should emit error if host key is invalid', async () => {
      const client = makeMockSocket();
      sessionsService.validateHostKey.mockResolvedValue(false);

      await gateway.handleOpenUrl(client, {
        sessionId: 'session-1',
        hostKey: 'wrong',
        url: 'https://example.com',
      });

      expect(client.emit).toHaveBeenCalledWith(
        WS_EVENTS.ERROR,
        expect.objectContaining({ code: 'INVALID_HOST_KEY' }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // handleEndSession()
  // -------------------------------------------------------------------------
  describe('handleEndSession()', () => {
    it('should emit error if host key is invalid', async () => {
      const client = makeMockSocket();
      sessionsService.validateHostKey.mockResolvedValue(false);

      await gateway.handleEndSession(client, {
        sessionId: 'session-1',
        hostKey: 'wrong',
      });

      expect(client.emit).toHaveBeenCalledWith(
        WS_EVENTS.ERROR,
        expect.objectContaining({ code: 'INVALID_HOST_KEY' }),
      );
    });

    it('should update state to ended', async () => {
      const client = makeMockSocket();
      sessionsService.validateHostKey.mockResolvedValue(true);
      sessionsService.updateState.mockResolvedValue(makeSessionDoc({ state: 'ended' as const }));

      await gateway.handleEndSession(client, {
        sessionId: 'session-1',
        hostKey: 'valid',
      });

      expect(sessionsService.updateState).toHaveBeenCalledWith('session-1', 'ended');
    });

    it('should broadcast session_ended to the room', async () => {
      const client = makeMockSocket();
      sessionsService.validateHostKey.mockResolvedValue(true);
      sessionsService.updateState.mockResolvedValue(makeSessionDoc({ state: 'ended' as const }));

      await gateway.handleEndSession(client, {
        sessionId: 'session-1',
        hostKey: 'valid',
      });

      expect(mockServer.to).toHaveBeenCalledWith('session-1');
      expect(mockServer.emit).toHaveBeenCalledWith(WS_EVENTS.SESSION_ENDED, {});
    });
  });

  // -------------------------------------------------------------------------
  // handleJoinSession() — locked session
  // -------------------------------------------------------------------------
  describe('handleJoinSession() — locked session', () => {
    it('should emit SESSION_LOCKED error when a new participant tries to join a locked session', async () => {
      const client = makeMockSocket();
      const lockedDoc = makeSessionDoc({ isLocked: true });
      sessionsService.findById.mockResolvedValue(lockedDoc);
      sessionsService.validateHostKey.mockResolvedValue(false);

      await gateway.handleJoinSession(client, { sessionId: 'session-1' });

      expect(client.emit).toHaveBeenCalledWith(
        WS_EVENTS.ERROR,
        expect.objectContaining({ code: 'SESSION_LOCKED' }),
      );
    });

    it('should allow a participant to reconnect to a locked session using their existing participantId', async () => {
      const client = makeMockSocket();
      const lockedDoc = makeSessionDoc({ isLocked: true });
      const participantDoc = makeParticipantDoc({ isOnline: false });
      sessionsService.findById.mockResolvedValue(lockedDoc);
      sessionsService.validateHostKey.mockResolvedValue(false);
      sessionsService.toSessionDto.mockReturnValue(makeSessionDto({ isLocked: true }));
      participantsService.findById.mockResolvedValue(participantDoc);
      participantsService.findBySession.mockResolvedValue([]);
      participantsService.updateSocketId.mockResolvedValue(participantDoc);
      participantsService.updateOnlineStatus.mockResolvedValue(
        makeParticipantDoc({ isOnline: true }),
      );
      participantsService.toParticipantDto.mockReturnValue(makeParticipantDto());

      await gateway.handleJoinSession(client, {
        sessionId: 'session-1',
        participantId: 'p-1',
        participantSecret: 'test-secret',
      });

      expect(client.emit).toHaveBeenCalledWith(
        WS_EVENTS.SESSION_STATE,
        expect.objectContaining({ session: expect.any(Object) }),
      );
      expect(client.emit).not.toHaveBeenCalledWith(
        WS_EVENTS.ERROR,
        expect.objectContaining({ code: 'SESSION_LOCKED' }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // handleToggleLock()
  // -------------------------------------------------------------------------
  describe('handleToggleLock()', () => {
    it('should emit error if host key is invalid', async () => {
      const client = makeMockSocket();
      sessionsService.validateHostKey.mockResolvedValue(false);

      await gateway.handleToggleLock(client, {
        sessionId: 'session-1',
        hostKey: 'wrong',
        locked: true,
      });

      expect(client.emit).toHaveBeenCalledWith(
        WS_EVENTS.ERROR,
        expect.objectContaining({ code: 'UNAUTHORIZED' }),
      );
    });

    it('should broadcast updated session_state after locking', async () => {
      const client = makeMockSocket();
      const lockedDoc = makeSessionDoc({ isLocked: true });
      sessionsService.validateHostKey.mockResolvedValue(true);
      sessionsService.setLocked.mockResolvedValue(lockedDoc);
      sessionsService.toSessionDto.mockReturnValue(makeSessionDto({ isLocked: true }));
      participantsService.findBySession.mockResolvedValue([]);

      await gateway.handleToggleLock(client, {
        sessionId: 'session-1',
        hostKey: 'valid',
        locked: true,
      });

      expect(sessionsService.setLocked).toHaveBeenCalledWith('session-1', true);
      expect(mockServer.emit).toHaveBeenCalledWith(
        WS_EVENTS.SESSION_STATE,
        expect.objectContaining({ session: expect.objectContaining({ isLocked: true }) }),
      );
    });

    it('should do nothing when setLocked returns null', async () => {
      const client = makeMockSocket();
      sessionsService.validateHostKey.mockResolvedValue(true);
      sessionsService.setLocked.mockResolvedValue(null);

      await gateway.handleToggleLock(client, {
        sessionId: 'session-1',
        hostKey: 'valid',
        locked: true,
      });

      expect(mockServer.emit).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // handleToggleVoting()
  // -------------------------------------------------------------------------
  describe('handleToggleVoting()', () => {
    it('should emit error if host key is invalid', async () => {
      const client = makeMockSocket();
      sessionsService.validateHostKey.mockResolvedValue(false);

      await gateway.handleToggleVoting(client, {
        sessionId: 'session-1',
        hostKey: 'wrong',
        votingEnabled: true,
      });

      expect(client.emit).toHaveBeenCalledWith(
        WS_EVENTS.ERROR,
        expect.objectContaining({ code: 'UNAUTHORIZED' }),
      );
    });

    it('should broadcast updated session_state after enabling voting', async () => {
      const client = makeMockSocket();
      const updatedDoc = makeSessionDoc({ votingEnabled: true });
      sessionsService.validateHostKey.mockResolvedValue(true);
      sessionsService.setVotingEnabled.mockResolvedValue(updatedDoc);
      sessionsService.toSessionDto.mockReturnValue(makeSessionDto({ votingEnabled: true }));
      participantsService.findBySession.mockResolvedValue([]);

      await gateway.handleToggleVoting(client, {
        sessionId: 'session-1',
        hostKey: 'valid',
        votingEnabled: true,
      });

      expect(sessionsService.setVotingEnabled).toHaveBeenCalledWith('session-1', true);
      expect(mockServer.emit).toHaveBeenCalledWith(
        WS_EVENTS.SESSION_STATE,
        expect.objectContaining({ session: expect.objectContaining({ votingEnabled: true }) }),
      );
    });

    it('should do nothing when setVotingEnabled returns null', async () => {
      const client = makeMockSocket();
      sessionsService.validateHostKey.mockResolvedValue(true);
      sessionsService.setVotingEnabled.mockResolvedValue(null);

      await gateway.handleToggleVoting(client, {
        sessionId: 'session-1',
        hostKey: 'valid',
        votingEnabled: true,
      });

      expect(mockServer.emit).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // handleKickParticipant()
  // -------------------------------------------------------------------------
  describe('handleKickParticipant()', () => {
    it('should emit error if host key is invalid', async () => {
      const client = makeMockSocket();
      sessionsService.validateHostKey.mockResolvedValue(false);

      await gateway.handleKickParticipant(client, {
        sessionId: 'session-1',
        hostKey: 'wrong',
        participantId: 'p-1',
      });

      expect(client.emit).toHaveBeenCalledWith(
        WS_EVENTS.ERROR,
        expect.objectContaining({ code: 'UNAUTHORIZED' }),
      );
    });

    it('should delete the participant and broadcast PARTICIPANT_LEFT to the room', async () => {
      const client = makeMockSocket();
      sessionsService.validateHostKey.mockResolvedValue(true);
      participantsService.findById.mockResolvedValue(
        makeParticipantDoc({ participantId: 'p-99', sessionId: 'session-1' }),
      );

      await gateway.handleKickParticipant(client, {
        sessionId: 'session-1',
        hostKey: 'valid',
        participantId: 'p-99',
      });

      expect(participantsService.deleteParticipant).toHaveBeenCalledWith('p-99');
      expect(mockServer.to).toHaveBeenCalledWith('session-1');
      expect(mockServer.emit).toHaveBeenCalledWith(WS_EVENTS.PARTICIPANT_LEFT, {
        participantId: 'p-99',
      });
    });

    it('should emit KICKED to the participant socket and clean up socketMeta', async () => {
      const client = makeMockSocket();
      sessionsService.validateHostKey.mockResolvedValue(true);
      participantsService.findById.mockResolvedValue(
        makeParticipantDoc({ participantId: 'p-1', sessionId: 'session-1' }),
      );

      // Seed the socketMeta map as if p-1 is connected on socket "socket-p1"
      (gateway as unknown as { socketMeta: Map<string, object> }).socketMeta.set('socket-p1', {
        sessionId: 'session-1',
        participantId: 'p-1',
        isHost: false,
      });

      await gateway.handleKickParticipant(client, {
        sessionId: 'session-1',
        hostKey: 'valid',
        participantId: 'p-1',
      });

      expect(mockServer.to).toHaveBeenCalledWith('socket-p1');
      expect(mockServer.emit).toHaveBeenCalledWith(WS_EVENTS.KICKED, { participantId: 'p-1' });

      const meta = (gateway as unknown as { socketMeta: Map<string, object> }).socketMeta.get(
        'socket-p1',
      );
      expect(meta).toBeUndefined();
    });

    it('should emit Unauthorized error when participant belongs to a different session', async () => {
      const client = makeMockSocket();
      sessionsService.validateHostKey.mockResolvedValue(true);
      // Participant belongs to 'session-2', not 'session-1'
      participantsService.findById.mockResolvedValue(
        makeParticipantDoc({ participantId: 'p-1', sessionId: 'session-2' }),
      );

      await gateway.handleKickParticipant(client, {
        sessionId: 'session-1',
        hostKey: 'valid',
        participantId: 'p-1',
      });

      expect(client.emit).toHaveBeenCalledWith(
        WS_EVENTS.ERROR,
        expect.objectContaining({ code: 'UNAUTHORIZED' }),
      );
      expect(participantsService.deleteParticipant).not.toHaveBeenCalled();
    });

    it('should emit Unauthorized error when participant is not found', async () => {
      const client = makeMockSocket();
      sessionsService.validateHostKey.mockResolvedValue(true);
      participantsService.findById.mockResolvedValue(null);

      await gateway.handleKickParticipant(client, {
        sessionId: 'session-1',
        hostKey: 'valid',
        participantId: 'nonexistent-p',
      });

      expect(client.emit).toHaveBeenCalledWith(
        WS_EVENTS.ERROR,
        expect.objectContaining({ code: 'UNAUTHORIZED' }),
      );
      expect(participantsService.deleteParticipant).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // handleAddUrl()
  // -------------------------------------------------------------------------
  describe('handleAddUrl()', () => {
    it('should emit error if host key is invalid', async () => {
      const client = makeMockSocket();
      sessionsService.validateHostKey.mockResolvedValue(false);

      await gateway.handleAddUrl(client, {
        sessionId: 'session-1',
        hostKey: 'wrong',
        url: 'https://example.com',
      });

      expect(client.emit).toHaveBeenCalledWith(
        WS_EVENTS.ERROR,
        expect.objectContaining({ code: 'UNAUTHORIZED' }),
      );
    });

    it('should broadcast updated session_state after adding a URL', async () => {
      const client = makeMockSocket();
      const updatedDoc = makeSessionDoc({
        urls: ['https://example.com', 'https://other.com', 'https://new.com'],
      });
      sessionsService.validateHostKey.mockResolvedValue(true);
      sessionsService.addUrl.mockResolvedValue(updatedDoc);
      sessionsService.toSessionDto.mockReturnValue(
        makeSessionDto({ urls: updatedDoc.urls as string[] }),
      );
      participantsService.findBySession.mockResolvedValue([]);

      await gateway.handleAddUrl(client, {
        sessionId: 'session-1',
        hostKey: 'valid',
        url: 'https://new.com',
      });

      expect(sessionsService.addUrl).toHaveBeenCalledWith('session-1', 'https://new.com');
      expect(mockServer.emit).toHaveBeenCalledWith(
        WS_EVENTS.SESSION_STATE,
        expect.objectContaining({ session: expect.any(Object) }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // handleRemoveUrl()
  // -------------------------------------------------------------------------
  describe('handleRemoveUrl()', () => {
    it('should emit error if host key is invalid', async () => {
      const client = makeMockSocket();
      sessionsService.validateHostKey.mockResolvedValue(false);

      await gateway.handleRemoveUrl(client, {
        sessionId: 'session-1',
        hostKey: 'wrong',
        index: 0,
      });

      expect(client.emit).toHaveBeenCalledWith(
        WS_EVENTS.ERROR,
        expect.objectContaining({ code: 'UNAUTHORIZED' }),
      );
    });

    it('should broadcast updated session_state after removing a URL', async () => {
      const client = makeMockSocket();
      const updatedDoc = makeSessionDoc({ urls: ['https://other.com'] });
      sessionsService.validateHostKey.mockResolvedValue(true);
      sessionsService.removeUrl.mockResolvedValue(updatedDoc);
      sessionsService.toSessionDto.mockReturnValue(
        makeSessionDto({ urls: updatedDoc.urls as string[] }),
      );
      participantsService.findBySession.mockResolvedValue([]);

      await gateway.handleRemoveUrl(client, {
        sessionId: 'session-1',
        hostKey: 'valid',
        index: 0,
      });

      expect(sessionsService.removeUrl).toHaveBeenCalledWith('session-1', 0);
      expect(mockServer.emit).toHaveBeenCalledWith(
        WS_EVENTS.SESSION_STATE,
        expect.objectContaining({ session: expect.any(Object) }),
      );
    });

    it('should do nothing when removeUrl returns null', async () => {
      const client = makeMockSocket();
      sessionsService.validateHostKey.mockResolvedValue(true);
      sessionsService.removeUrl.mockResolvedValue(null);

      await gateway.handleRemoveUrl(client, {
        sessionId: 'session-1',
        hostKey: 'valid',
        index: 99,
      });

      expect(mockServer.emit).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // handleReorderUrls()
  // -------------------------------------------------------------------------
  describe('handleReorderUrls()', () => {
    it('should emit error if host key is invalid', async () => {
      const client = makeMockSocket();
      sessionsService.validateHostKey.mockResolvedValue(false);

      await gateway.handleReorderUrls(client, {
        sessionId: 'session-1',
        hostKey: 'wrong',
        fromIndex: 1,
        toIndex: 2,
      });

      expect(client.emit).toHaveBeenCalledWith(
        WS_EVENTS.ERROR,
        expect.objectContaining({ code: 'UNAUTHORIZED' }),
      );
    });

    it('should broadcast updated session_state after reordering URLs', async () => {
      const client = makeMockSocket();
      const reorderedDoc = makeSessionDoc({
        urls: ['https://example.com', 'https://c.com', 'https://other.com'],
      });
      sessionsService.validateHostKey.mockResolvedValue(true);
      sessionsService.reorderUrls.mockResolvedValue(reorderedDoc);
      sessionsService.toSessionDto.mockReturnValue(
        makeSessionDto({ urls: reorderedDoc.urls as string[] }),
      );
      participantsService.findBySession.mockResolvedValue([]);

      await gateway.handleReorderUrls(client, {
        sessionId: 'session-1',
        hostKey: 'valid',
        fromIndex: 1,
        toIndex: 2,
      });

      expect(sessionsService.reorderUrls).toHaveBeenCalledWith('session-1', 1, 2);
      expect(mockServer.emit).toHaveBeenCalledWith(
        WS_EVENTS.SESSION_STATE,
        expect.objectContaining({ session: expect.any(Object) }),
      );
    });

    it('should emit error when reorderUrls returns null', async () => {
      const client = makeMockSocket();
      sessionsService.validateHostKey.mockResolvedValue(true);
      sessionsService.reorderUrls.mockResolvedValue(null);

      await gateway.handleReorderUrls(client, {
        sessionId: 'session-1',
        hostKey: 'valid',
        fromIndex: 0,
        toIndex: 1,
      });

      expect(client.emit).toHaveBeenCalledWith(
        WS_EVENTS.ERROR,
        expect.objectContaining({ code: 'REORDER_NOT_ALLOWED' }),
      );
    });

    it('should not remap in-memory savedVotes after reorder (slot-based, not URL-based)', async () => {
      const client = makeMockSocket();
      const savedVotesMap = (gateway as unknown as { savedVotes: Map<string, Map<number, string>> })
        .savedVotes;
      savedVotesMap.set(
        'session-1',
        new Map([
          [0, '5'],
          [1, '8'],
        ]),
      );

      const reorderedDoc = makeSessionDoc({ urls: ['https://other.com', 'https://example.com'] });
      sessionsService.validateHostKey.mockResolvedValue(true);
      sessionsService.reorderUrls.mockResolvedValue(reorderedDoc);
      sessionsService.toSessionDto.mockReturnValue(makeSessionDto());
      participantsService.findBySession.mockResolvedValue([]);

      await gateway.handleReorderUrls(client, {
        sessionId: 'session-1',
        hostKey: 'valid',
        fromIndex: 0,
        toIndex: 1,
      });

      // Slot 0 still has '5', slot 1 still has '8' — unchanged
      const sv = savedVotesMap.get('session-1');
      expect(sv?.get(0)).toBe('5');
      expect(sv?.get(1)).toBe('8');
    });
  });

  // -------------------------------------------------------------------------
  // handleSubmitVote()
  // -------------------------------------------------------------------------
  describe('handleSubmitVote()', () => {
    beforeEach(() => {
      // socket-1 owns participant p-1 by default
      (gateway as unknown as { socketMeta: Map<string, object> }).socketMeta.set('socket-1', {
        sessionId: 'session-1',
        participantId: 'p-1',
        isHost: false,
      });
    });

    it('should emit error if session not found', async () => {
      const client = makeMockSocket();
      sessionsService.findById.mockResolvedValue(null);

      await gateway.handleSubmitVote(client, {
        sessionId: 'session-1',
        participantId: 'p-1',
        value: '5',
      });

      expect(client.emit).toHaveBeenCalledWith(
        WS_EVENTS.ERROR,
        expect.objectContaining({ code: 'SESSION_NOT_FOUND' }),
      );
    });

    it('should emit error if voting is disabled', async () => {
      const client = makeMockSocket();
      sessionsService.findById.mockResolvedValue(makeSessionDoc({ votingEnabled: false }));

      await gateway.handleSubmitVote(client, {
        sessionId: 'session-1',
        participantId: 'p-1',
        value: '5',
      });

      expect(client.emit).toHaveBeenCalledWith(
        WS_EVENTS.ERROR,
        expect.objectContaining({ code: 'VOTING_DISABLED' }),
      );
    });

    it('should emit error if session is not active', async () => {
      const client = makeMockSocket();
      sessionsService.findById.mockResolvedValue(
        makeSessionDoc({ votingEnabled: true, state: 'waiting' }),
      );

      await gateway.handleSubmitVote(client, {
        sessionId: 'session-1',
        participantId: 'p-1',
        value: '5',
      });

      expect(client.emit).toHaveBeenCalledWith(
        WS_EVENTS.ERROR,
        expect.objectContaining({ code: 'SESSION_NOT_ACTIVE' }),
      );
    });

    it('should broadcast VOTE_UPDATE with hasVoted IDs (not the values) to the room', async () => {
      const client = makeMockSocket();
      sessionsService.findById.mockResolvedValue(
        makeSessionDoc({ votingEnabled: true, state: 'active' }),
      );

      await gateway.handleSubmitVote(client, {
        sessionId: 'session-1',
        participantId: 'p-1',
        value: '5',
      });

      expect(mockServer.to).toHaveBeenCalledWith('session-1');
      expect(mockServer.emit).toHaveBeenCalledWith(WS_EVENTS.VOTE_UPDATE, {
        hasVoted: ['p-1'],
      });
      // The actual vote value must NOT appear in the broadcast
      const emitCalls = (mockServer.emit as jest.Mock).mock.calls;
      const voteUpdateCall = emitCalls.find(([event]: [string]) => event === WS_EVENTS.VOTE_UPDATE);
      expect(JSON.stringify(voteUpdateCall[1])).not.toContain('"5"');
    });

    it('should accumulate multiple votes — hasVoted contains all voter IDs', async () => {
      const client1 = makeMockSocket('socket-1');
      const client2 = makeMockSocket('socket-2');
      (gateway as unknown as { socketMeta: Map<string, object> }).socketMeta.set('socket-2', {
        sessionId: 'session-1',
        participantId: 'p-2',
        isHost: false,
      });
      sessionsService.findById.mockResolvedValue(
        makeSessionDoc({ votingEnabled: true, state: 'active' }),
      );

      await gateway.handleSubmitVote(client1, {
        sessionId: 'session-1',
        participantId: 'p-1',
        value: '5',
      });
      await gateway.handleSubmitVote(client2, {
        sessionId: 'session-1',
        participantId: 'p-2',
        value: '8',
      });

      const emitCalls = (mockServer.emit as jest.Mock).mock.calls;
      const lastVoteUpdate = emitCalls
        .filter(([event]: [string]) => event === WS_EVENTS.VOTE_UPDATE)
        .at(-1);
      expect(lastVoteUpdate[1].hasVoted).toEqual(expect.arrayContaining(['p-1', 'p-2']));
      expect(lastVoteUpdate[1].hasVoted).toHaveLength(2);
    });
  });

  // -------------------------------------------------------------------------
  // handleRevealVotes()
  // -------------------------------------------------------------------------
  describe('handleRevealVotes()', () => {
    it('should emit error if host key is invalid', async () => {
      const client = makeMockSocket();
      sessionsService.findById.mockResolvedValue(makeSessionDoc({ hostKeyHash: 'bad-hash' }));
      sessionsService.validateHostKeyForDoc.mockReturnValue(false);

      await gateway.handleRevealVotes(client, {
        sessionId: 'session-1',
        hostKey: 'wrong',
      });

      expect(client.emit).toHaveBeenCalledWith(
        WS_EVENTS.ERROR,
        expect.objectContaining({ code: 'INVALID_HOST_KEY' }),
      );
    });

    it('should emit NO_VOTES error if there are no votes to reveal', async () => {
      const client = makeMockSocket();
      sessionsService.findById.mockResolvedValue(makeSessionDoc({ currentIndex: 0 }));
      sessionsService.validateHostKeyForDoc.mockReturnValue(true);

      await gateway.handleRevealVotes(client, {
        sessionId: 'session-1',
        hostKey: 'valid',
      });

      expect(client.emit).toHaveBeenCalledWith(
        WS_EVENTS.ERROR,
        expect.objectContaining({ code: 'NO_VOTES' }),
      );
    });

    it('should broadcast VOTES_REVEALED with actual values and numeric average', async () => {
      const client1 = makeMockSocket('socket-1');
      const client2 = makeMockSocket('socket-2');
      (gateway as unknown as { socketMeta: Map<string, object> }).socketMeta.set('socket-1', {
        sessionId: 'session-1',
        participantId: 'p-1',
        isHost: false,
      });
      (gateway as unknown as { socketMeta: Map<string, object> }).socketMeta.set('socket-2', {
        sessionId: 'session-1',
        participantId: 'p-2',
        isHost: false,
      });
      sessionsService.validateHostKey.mockResolvedValue(true);
      sessionsService.findById.mockResolvedValue(
        makeSessionDoc({ votingEnabled: true, state: 'active' }),
      );

      // Seed two votes: 3 and 5 → average 4
      await gateway.handleSubmitVote(client1, {
        sessionId: 'session-1',
        participantId: 'p-1',
        value: '3',
      });
      await gateway.handleSubmitVote(client2, {
        sessionId: 'session-1',
        participantId: 'p-2',
        value: '5',
      });

      (mockServer.emit as jest.Mock).mockClear();

      await gateway.handleRevealVotes(client1, {
        sessionId: 'session-1',
        hostKey: 'valid',
      });

      expect(mockServer.to).toHaveBeenCalledWith('session-1');
      expect(mockServer.emit).toHaveBeenCalledWith(WS_EVENTS.VOTES_REVEALED, {
        votes: { 'p-1': '3', 'p-2': '5' },
        average: '4',
      });
    });

    it('should round average to the nearest integer', async () => {
      const client1 = makeMockSocket('socket-1');
      const client2 = makeMockSocket('socket-2');
      (gateway as unknown as { socketMeta: Map<string, object> }).socketMeta.set('socket-1', {
        sessionId: 'session-1',
        participantId: 'p-1',
        isHost: false,
      });
      (gateway as unknown as { socketMeta: Map<string, object> }).socketMeta.set('socket-2', {
        sessionId: 'session-1',
        participantId: 'p-2',
        isHost: false,
      });
      sessionsService.validateHostKey.mockResolvedValue(true);
      sessionsService.findById.mockResolvedValue(
        makeSessionDoc({ votingEnabled: true, state: 'active' }),
      );

      // Votes: 1, 2 → average 1.5 → rounds to 2
      await gateway.handleSubmitVote(client1, {
        sessionId: 'session-1',
        participantId: 'p-1',
        value: '1',
      });
      await gateway.handleSubmitVote(client2, {
        sessionId: 'session-1',
        participantId: 'p-2',
        value: '2',
      });

      await gateway.handleRevealVotes(client1, {
        sessionId: 'session-1',
        hostKey: 'valid',
      });

      const emitCalls = (mockServer.emit as jest.Mock).mock.calls;
      const revealCall = emitCalls.find(([event]: [string]) => event === WS_EVENTS.VOTES_REVEALED);
      expect(revealCall[1].average).toBe('2');
    });

    it('should return mode for all non-numeric votes (e.g. ?, ☕)', async () => {
      const client1 = makeMockSocket('socket-1');
      const client2 = makeMockSocket('socket-2');
      const client3 = makeMockSocket('socket-3');
      (gateway as unknown as { socketMeta: Map<string, object> }).socketMeta.set('socket-1', {
        sessionId: 'session-1',
        participantId: 'p-1',
        isHost: false,
      });
      (gateway as unknown as { socketMeta: Map<string, object> }).socketMeta.set('socket-2', {
        sessionId: 'session-1',
        participantId: 'p-2',
        isHost: false,
      });
      (gateway as unknown as { socketMeta: Map<string, object> }).socketMeta.set('socket-3', {
        sessionId: 'session-1',
        participantId: 'p-3',
        isHost: false,
      });
      sessionsService.validateHostKey.mockResolvedValue(true);
      sessionsService.findById.mockResolvedValue(
        makeSessionDoc({ votingEnabled: true, state: 'active' }),
      );

      await gateway.handleSubmitVote(client1, {
        sessionId: 'session-1',
        participantId: 'p-1',
        value: '?',
      });
      await gateway.handleSubmitVote(client2, {
        sessionId: 'session-1',
        participantId: 'p-2',
        value: '?',
      });
      await gateway.handleSubmitVote(client3, {
        sessionId: 'session-1',
        participantId: 'p-3',
        value: '☕',
      });

      await gateway.handleRevealVotes(client1, {
        sessionId: 'session-1',
        hostKey: 'valid',
      });

      const emitCalls = (mockServer.emit as jest.Mock).mock.calls;
      const revealCall = emitCalls.find(([event]: [string]) => event === WS_EVENTS.VOTES_REVEALED);
      // Mode is '?' (appears twice)
      expect(revealCall[1].average).toBe('?');
    });
  });

  // -------------------------------------------------------------------------
  // handleNavigate() — voting integration
  // -------------------------------------------------------------------------
  describe('handleNavigate() — voting state', () => {
    it('should clear votes and broadcast VOTE_UPDATE with empty hasVoted on navigation', async () => {
      const client = makeMockSocket();
      (gateway as unknown as { socketMeta: Map<string, object> }).socketMeta.set('socket-1', {
        sessionId: 'session-1',
        participantId: 'p-1',
        isHost: false,
      });
      sessionsService.validateHostKey.mockResolvedValue(true);
      sessionsService.findById.mockResolvedValue(makeSessionDoc({ currentIndex: 0 }));
      sessionsService.updateCurrentIndex.mockResolvedValue(makeSessionDoc({ currentIndex: 1 }));
      sessionsService.findById.mockResolvedValue(
        makeSessionDoc({ votingEnabled: true, state: 'active', currentIndex: 0 }),
      );

      // Seed a vote first
      await gateway.handleSubmitVote(client, {
        sessionId: 'session-1',
        participantId: 'p-1',
        value: '5',
      });

      (mockServer.emit as jest.Mock).mockClear();

      await gateway.handleNavigate(client, {
        sessionId: 'session-1',
        hostKey: 'valid',
        direction: 'next',
      });

      // Votes persist across navigation — NAVIGATE_TO carries the new ticket's state
      const emitCalls = (mockServer.emit as jest.Mock).mock.calls;
      const navCall = emitCalls.find(([event]: [string]) => event === WS_EVENTS.NAVIGATE_TO);
      expect(navCall).toBeDefined();
      // New ticket (index 1) has no votes yet
      expect(navCall[1].hasVoted).toEqual([]);
      // Old ticket (index 0) vote is preserved — no VOTE_UPDATE wipe broadcast
      expect(mockServer.emit).not.toHaveBeenCalledWith(WS_EVENTS.VOTE_UPDATE, { hasVoted: [] });
    });

    it('should save average vote in savedVotes before navigating', async () => {
      const client1 = makeMockSocket('socket-1');
      const client2 = makeMockSocket('socket-2');
      (gateway as unknown as { socketMeta: Map<string, object> }).socketMeta.set('socket-1', {
        sessionId: 'session-1',
        participantId: 'p-1',
        isHost: false,
      });
      (gateway as unknown as { socketMeta: Map<string, object> }).socketMeta.set('socket-2', {
        sessionId: 'session-1',
        participantId: 'p-2',
        isHost: false,
      });
      sessionsService.validateHostKey.mockResolvedValue(true);
      const activeDoc = makeSessionDoc({ votingEnabled: true, state: 'active', currentIndex: 0 });
      sessionsService.findById.mockResolvedValue(activeDoc);
      sessionsService.updateCurrentIndex.mockResolvedValue(makeSessionDoc({ currentIndex: 1 }));

      // Seed votes: 4 and 8 → average 6
      await gateway.handleSubmitVote(client1, {
        sessionId: 'session-1',
        participantId: 'p-1',
        value: '4',
      });
      await gateway.handleSubmitVote(client2, {
        sessionId: 'session-1',
        participantId: 'p-2',
        value: '8',
      });

      await gateway.handleNavigate(client1, {
        sessionId: 'session-1',
        hostKey: 'valid',
        direction: 'next',
      });

      // NAVIGATE_TO should include savedVotes with the computed average for index 0
      const emitCalls = (mockServer.emit as jest.Mock).mock.calls;
      const navCall = emitCalls.find(([event]: [string]) => event === WS_EVENTS.NAVIGATE_TO);
      expect(navCall[1].savedVotes).toEqual({ 0: '6' });
    });

    it('should not save votes if no one voted before navigating', async () => {
      const client = makeMockSocket();
      sessionsService.validateHostKey.mockResolvedValue(true);
      sessionsService.findById.mockResolvedValue(makeSessionDoc({ currentIndex: 0 }));
      sessionsService.updateCurrentIndex.mockResolvedValue(makeSessionDoc({ currentIndex: 1 }));

      await gateway.handleNavigate(client, {
        sessionId: 'session-1',
        hostKey: 'valid',
        direction: 'next',
      });

      const emitCalls = (mockServer.emit as jest.Mock).mock.calls;
      const navCall = emitCalls.find(([event]: [string]) => event === WS_EVENTS.NAVIGATE_TO);
      // savedVotes should be empty (no votes were cast)
      expect(navCall[1].savedVotes).toEqual({});
    });

    it('should accumulate savedVotes across multiple navigations', async () => {
      const client = makeMockSocket();
      (gateway as unknown as { socketMeta: Map<string, object> }).socketMeta.set('socket-1', {
        sessionId: 'session-1',
        participantId: 'p-1',
        isHost: false,
      });
      sessionsService.validateHostKey.mockResolvedValue(true);
      sessionsService.findById.mockResolvedValue(
        makeSessionDoc({ votingEnabled: true, state: 'active', currentIndex: 0 }),
      );
      sessionsService.updateCurrentIndex.mockResolvedValue(makeSessionDoc({ currentIndex: 1 }));

      // Vote on ticket 0 and navigate
      await gateway.handleSubmitVote(client, {
        sessionId: 'session-1',
        participantId: 'p-1',
        value: '5',
      });
      await gateway.handleNavigate(client, {
        sessionId: 'session-1',
        hostKey: 'valid',
        direction: 'next',
      });

      // Now on ticket 1 — vote and navigate back
      sessionsService.findById.mockResolvedValue(
        makeSessionDoc({ votingEnabled: true, state: 'active', currentIndex: 1 }),
      );
      sessionsService.updateCurrentIndex.mockResolvedValue(makeSessionDoc({ currentIndex: 0 }));

      await gateway.handleSubmitVote(client, {
        sessionId: 'session-1',
        participantId: 'p-1',
        value: '8',
      });
      await gateway.handleNavigate(client, {
        sessionId: 'session-1',
        hostKey: 'valid',
        direction: 'prev',
      });

      const emitCalls = (mockServer.emit as jest.Mock).mock.calls;
      const navCalls = emitCalls.filter(([event]: [string]) => event === WS_EVENTS.NAVIGATE_TO);
      const lastNav = navCalls.at(-1);
      // Should have saved votes for both index 0 and index 1
      expect(lastNav[1].savedVotes).toEqual({ 0: '5', 1: '8' });
    });
  });

  // -------------------------------------------------------------------------
  // handleDisconnect()
  // -------------------------------------------------------------------------
  describe('handleDisconnect()', () => {
    it('should mark the participant offline on disconnect', async () => {
      const client = makeMockSocket('socket-99');
      // Seed socket metadata as if the participant joined
      (gateway as unknown as { socketMeta: Map<string, object> }).socketMeta.set('socket-99', {
        sessionId: 'session-1',
        participantId: 'p-1',
        isHost: false,
      });
      participantsService.updateOnlineStatus.mockResolvedValue(
        makeParticipantDoc({ isOnline: false }),
      );

      await gateway.handleDisconnect(client);

      expect(participantsService.updateOnlineStatus).toHaveBeenCalledWith('p-1', false);
    });

    it('should broadcast participant_online(false) to the room on disconnect', async () => {
      const client = makeMockSocket('socket-99');
      (gateway as unknown as { socketMeta: Map<string, object> }).socketMeta.set('socket-99', {
        sessionId: 'session-1',
        participantId: 'p-1',
        isHost: false,
      });
      participantsService.updateOnlineStatus.mockResolvedValue(
        makeParticipantDoc({ isOnline: false }),
      );

      await gateway.handleDisconnect(client);

      expect(mockServer.to).toHaveBeenCalledWith('session-1');
      expect(mockServer.emit).toHaveBeenCalledWith(WS_EVENTS.PARTICIPANT_ONLINE, {
        participantId: 'p-1',
        isOnline: false,
      });
    });

    it('should not mark offline if participant has another active socket', async () => {
      const client = makeMockSocket('socket-99');
      const socketMeta = (gateway as unknown as { socketMeta: Map<string, object> }).socketMeta;
      socketMeta.set('socket-99', {
        sessionId: 'session-1',
        participantId: 'p-1',
        isHost: false,
      });
      socketMeta.set('socket-100', {
        sessionId: 'session-1',
        participantId: 'p-1',
        isHost: false,
      });

      await gateway.handleDisconnect(client);

      expect(participantsService.updateOnlineStatus).not.toHaveBeenCalled();
      expect(mockServer.emit).not.toHaveBeenCalledWith(
        WS_EVENTS.PARTICIPANT_ONLINE,
        expect.anything(),
      );
    });

    it('should do nothing if there is no socket metadata for the client', async () => {
      const client = makeMockSocket('unknown-socket');
      await gateway.handleDisconnect(client);
      expect(participantsService.updateOnlineStatus).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // handleUpdateParticipantProfile()
  // -------------------------------------------------------------------------
  describe('handleUpdateParticipantProfile()', () => {
    beforeEach(() => {
      // Seed socket meta so the ownership check passes (socket-1 owns p-1)
      (gateway as unknown as { socketMeta: Map<string, object> }).socketMeta.set('socket-1', {
        sessionId: 'session-1',
        participantId: 'p-1',
        isHost: false,
      });
    });

    it('should update the participant and broadcast PARTICIPANT_UPDATED to the room', async () => {
      const client = makeMockSocket();
      const updatedDoc = makeParticipantDoc({ name: 'Alicia', email: 'alicia@example.com' });
      const updatedDto = makeParticipantDto({ name: 'Alicia', email: 'alicia@example.com' });
      participantsService.updateProfile = jest.fn().mockResolvedValue(updatedDoc);
      participantsService.toParticipantDto.mockReturnValue(updatedDto);

      await gateway.handleUpdateParticipantProfile(client, {
        sessionId: 'session-1',
        participantId: 'p-1',
        name: 'Alicia',
        email: 'alicia@example.com',
      });

      expect(participantsService.updateProfile).toHaveBeenCalledWith(
        'p-1',
        'Alicia',
        'alicia@example.com',
      );
      expect(mockServer.to).toHaveBeenCalledWith('session-1');
      expect(mockServer.emit).toHaveBeenCalledWith(
        WS_EVENTS.PARTICIPANT_UPDATED,
        expect.objectContaining({ participant: updatedDto }),
      );
    });

    it('should emit error when name is empty', async () => {
      const client = makeMockSocket();

      await gateway.handleUpdateParticipantProfile(client, {
        sessionId: 'session-1',
        participantId: 'p-1',
        name: '   ',
        email: '',
      });

      expect(client.emit).toHaveBeenCalledWith(
        WS_EVENTS.ERROR,
        expect.objectContaining({ code: 'INVALID_NAME' }),
      );
    });

    it('should emit error when name exceeds 50 characters', async () => {
      const client = makeMockSocket();

      await gateway.handleUpdateParticipantProfile(client, {
        sessionId: 'session-1',
        participantId: 'p-1',
        name: 'A'.repeat(51),
        email: '',
      });

      expect(client.emit).toHaveBeenCalledWith(
        WS_EVENTS.ERROR,
        expect.objectContaining({ code: 'INVALID_NAME' }),
      );
    });

    it('should emit error when updateProfile throws', async () => {
      const client = makeMockSocket();
      participantsService.updateProfile = jest.fn().mockRejectedValue(new Error('not found'));

      await gateway.handleUpdateParticipantProfile(client, {
        sessionId: 'session-1',
        participantId: 'p-1',
        name: 'Ghost',
        email: '',
      });

      expect(client.emit).toHaveBeenCalledWith(
        WS_EVENTS.ERROR,
        expect.objectContaining({ code: 'UPDATE_FAILED' }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // handleUpdateHostProfile()
  // -------------------------------------------------------------------------
  describe('handleUpdateHostProfile()', () => {
    it('should update the session and broadcast SESSION_STATE to the room', async () => {
      const client = makeMockSocket();
      const updatedDoc = makeSessionDoc({ hostName: 'New Host' });
      const updatedDto = makeSessionDto({ hostName: 'New Host' });
      sessionsService.validateHostKey.mockResolvedValue(true);
      sessionsService.updateHostProfile = jest.fn().mockResolvedValue(updatedDoc);
      sessionsService.toSessionDto.mockReturnValue(updatedDto);
      participantsService.findBySession.mockResolvedValue([makeParticipantDto()]);

      await gateway.handleUpdateHostProfile(client, {
        sessionId: 'session-1',
        hostKey: 'valid-key',
        name: 'New Host',
        email: '',
      });

      expect(sessionsService.updateHostProfile).toHaveBeenCalledWith('session-1', 'New Host', '');
      expect(mockServer.to).toHaveBeenCalledWith('session-1');
      expect(mockServer.emit).toHaveBeenCalledWith(
        WS_EVENTS.SESSION_STATE,
        expect.objectContaining({ session: updatedDto }),
      );
    });

    it('should emit error when host key is invalid', async () => {
      const client = makeMockSocket();
      sessionsService.validateHostKey.mockResolvedValue(false);

      await gateway.handleUpdateHostProfile(client, {
        sessionId: 'session-1',
        hostKey: 'wrong-key',
        name: 'New Host',
        email: '',
      });

      expect(client.emit).toHaveBeenCalledWith(
        WS_EVENTS.ERROR,
        expect.objectContaining({ code: 'INVALID_HOST_KEY' }),
      );
    });

    it('should emit error when name is empty', async () => {
      const client = makeMockSocket();
      sessionsService.validateHostKey.mockResolvedValue(true);

      await gateway.handleUpdateHostProfile(client, {
        sessionId: 'session-1',
        hostKey: 'valid-key',
        name: '',
        email: '',
      });

      expect(client.emit).toHaveBeenCalledWith(
        WS_EVENTS.ERROR,
        expect.objectContaining({ code: 'INVALID_NAME' }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // handleGroomingComplete()
  // -------------------------------------------------------------------------
  describe('handleGroomingComplete()', () => {
    it('should emit error when host key is invalid', async () => {
      const client = makeMockSocket();
      sessionsService.validateHostKey.mockResolvedValue(false);

      await gateway.handleGroomingComplete(client, {
        sessionId: 'session-1',
        hostKey: 'wrong-key',
      });

      expect(client.emit).toHaveBeenCalledWith(
        WS_EVENTS.ERROR,
        expect.objectContaining({ code: 'INVALID_HOST_KEY' }),
      );
    });

    it('should broadcast GROOMING_COMPLETE to the room excluding the sender', async () => {
      const client = makeMockSocket();
      sessionsService.validateHostKey.mockResolvedValue(true);

      await gateway.handleGroomingComplete(client, {
        sessionId: 'session-1',
        hostKey: 'valid-key',
      });

      expect(client.to).toHaveBeenCalledWith('session-1');
      expect(client.emit).toHaveBeenCalledWith(WS_EVENTS.GROOMING_COMPLETE, {});
    });

    it('should not use the global server broadcast (only room minus sender)', async () => {
      const client = makeMockSocket();
      sessionsService.validateHostKey.mockResolvedValue(true);

      await gateway.handleGroomingComplete(client, {
        sessionId: 'session-1',
        hostKey: 'valid-key',
      });

      expect(mockServer.emit).not.toHaveBeenCalledWith(
        WS_EVENTS.GROOMING_COMPLETE,
        expect.anything(),
      );
    });
  });

  // -------------------------------------------------------------------------
  // handleSetSavedVote()
  // -------------------------------------------------------------------------
  describe('handleSetSavedVote()', () => {
    it('should emit INVALID_HOST_KEY error if host key is invalid', async () => {
      const client = makeMockSocket();
      sessionsService.validateHostKey.mockResolvedValue(false);

      await gateway.handleSetSavedVote(client, {
        sessionId: 'session-1',
        hostKey: 'bad',
        urlIndex: 0,
        value: '5',
      });

      expect(client.emit).toHaveBeenCalledWith(
        WS_EVENTS.ERROR,
        expect.objectContaining({ code: 'INVALID_HOST_KEY' }),
      );
      expect(mockServer.emit).not.toHaveBeenCalledWith(
        WS_EVENTS.SAVED_VOTES_UPDATED,
        expect.anything(),
      );
    });

    it('should set a story point and broadcast SAVED_VOTES_UPDATED to the room', async () => {
      const client = makeMockSocket();
      sessionsService.findById.mockResolvedValue(makeSessionDoc());
      sessionsService.validateHostKeyForDoc.mockReturnValue(true);

      await gateway.handleSetSavedVote(client, {
        sessionId: 'session-1',
        hostKey: 'valid',
        urlIndex: 2,
        value: '8',
      });

      expect(mockServer.to).toHaveBeenCalledWith('session-1');
      expect(mockServer.emit).toHaveBeenCalledWith(WS_EVENTS.SAVED_VOTES_UPDATED, {
        savedVotes: { 2: '8' },
      });
    });

    it('should override an existing saved vote', async () => {
      const client = makeMockSocket();
      sessionsService.findById.mockResolvedValue(makeSessionDoc());
      sessionsService.validateHostKeyForDoc.mockReturnValue(true);

      await gateway.handleSetSavedVote(client, {
        sessionId: 'session-1',
        hostKey: 'valid',
        urlIndex: 0,
        value: '5',
      });
      (mockServer.emit as jest.Mock).mockClear();

      await gateway.handleSetSavedVote(client, {
        sessionId: 'session-1',
        hostKey: 'valid',
        urlIndex: 0,
        value: '13',
      });

      expect(mockServer.emit).toHaveBeenCalledWith(WS_EVENTS.SAVED_VOTES_UPDATED, {
        savedVotes: { 0: '13' },
      });
    });

    it('should prevent navigate from overwriting a manually set story point', async () => {
      const client = makeMockSocket();
      (gateway as unknown as { socketMeta: Map<string, object> }).socketMeta.set('socket-1', {
        sessionId: 'session-1',
        participantId: 'p-1',
        isHost: false,
      });
      sessionsService.validateHostKey.mockResolvedValue(true);
      const activeDoc = makeSessionDoc({ votingEnabled: true, state: 'active', currentIndex: 0 });
      sessionsService.findById.mockResolvedValue(activeDoc);
      sessionsService.updateCurrentIndex.mockResolvedValue(makeSessionDoc({ currentIndex: 1 }));

      // Manually set story point for index 0
      await gateway.handleSetSavedVote(client, {
        sessionId: 'session-1',
        hostKey: 'valid',
        urlIndex: 0,
        value: '13',
      });

      // Seed a vote (average would be 5)
      await gateway.handleSubmitVote(client, {
        sessionId: 'session-1',
        participantId: 'p-1',
        value: '5',
      });
      (mockServer.emit as jest.Mock).mockClear();

      // Navigate away — should NOT overwrite the manually set 13
      await gateway.handleNavigate(client, {
        sessionId: 'session-1',
        hostKey: 'valid',
        direction: 'next',
      });

      const emitCalls = (mockServer.emit as jest.Mock).mock.calls;
      const navCall = emitCalls.find(([event]: [string]) => event === WS_EVENTS.NAVIGATE_TO);
      expect(navCall[1].savedVotes).toEqual({ 0: '13' });
    });
  });

  // -------------------------------------------------------------------------
  // handleResetSavedVote()
  // -------------------------------------------------------------------------
  describe('handleResetSavedVote()', () => {
    it('should emit INVALID_HOST_KEY error if host key is invalid', async () => {
      const client = makeMockSocket();
      sessionsService.validateHostKey.mockResolvedValue(false);

      await gateway.handleResetSavedVote(client, {
        sessionId: 'session-1',
        hostKey: 'bad',
        urlIndex: 0,
      });

      expect(client.emit).toHaveBeenCalledWith(
        WS_EVENTS.ERROR,
        expect.objectContaining({ code: 'INVALID_HOST_KEY' }),
      );
    });

    it('should remove a saved vote and broadcast SAVED_VOTES_UPDATED', async () => {
      const client = makeMockSocket();
      sessionsService.findById.mockResolvedValue(makeSessionDoc());
      sessionsService.validateHostKeyForDoc.mockReturnValue(true);

      // Set a vote first
      await gateway.handleSetSavedVote(client, {
        sessionId: 'session-1',
        hostKey: 'valid',
        urlIndex: 1,
        value: '5',
      });
      (mockServer.emit as jest.Mock).mockClear();

      await gateway.handleResetSavedVote(client, {
        sessionId: 'session-1',
        hostKey: 'valid',
        urlIndex: 1,
      });

      expect(mockServer.to).toHaveBeenCalledWith('session-1');
      expect(mockServer.emit).toHaveBeenCalledWith(WS_EVENTS.SAVED_VOTES_UPDATED, {
        savedVotes: {},
      });
    });

    it('should be a no-op (no error) when resetting an index with no saved vote', async () => {
      const client = makeMockSocket();
      sessionsService.findById.mockResolvedValue(makeSessionDoc());
      sessionsService.validateHostKeyForDoc.mockReturnValue(true);

      await gateway.handleResetSavedVote(client, {
        sessionId: 'session-1',
        hostKey: 'valid',
        urlIndex: 99,
      });

      expect(mockServer.emit).toHaveBeenCalledWith(WS_EVENTS.SAVED_VOTES_UPDATED, {
        savedVotes: {},
      });
    });
  });

  describe('handleResetVotes()', () => {
    it('should emit error if host key is invalid', async () => {
      const client = makeMockSocket();
      sessionsService.validateHostKey.mockResolvedValue(false);

      await gateway.handleResetVotes(client, { sessionId: 'session-1', hostKey: 'wrong' });

      expect(client.emit).toHaveBeenCalledWith(
        WS_EVENTS.ERROR,
        expect.objectContaining({ code: 'INVALID_HOST_KEY' }),
      );
    });

    it('should broadcast empty VOTE_UPDATE after resetting', async () => {
      const client = makeMockSocket();
      sessionsService.validateHostKey.mockResolvedValue(true);
      sessionsService.findById.mockResolvedValue(makeSessionDoc({ currentIndex: 0 }));

      await gateway.handleResetVotes(client, { sessionId: 'session-1', hostKey: 'valid' });

      expect(mockServer.emit).toHaveBeenCalledWith(WS_EVENTS.VOTE_UPDATE, { hasVoted: [] });
    });

    it('should be a no-op when session not found after validation', async () => {
      const client = makeMockSocket();
      sessionsService.validateHostKey.mockResolvedValue(true);
      sessionsService.findById.mockResolvedValue(null);

      await gateway.handleResetVotes(client, { sessionId: 'session-1', hostKey: 'valid' });

      expect(mockServer.emit).not.toHaveBeenCalled();
    });
  });

  describe('handleNavigate() — session not found', () => {
    it('should emit error when session is not found', async () => {
      const client = makeMockSocket();
      sessionsService.findById.mockResolvedValue(null);

      await gateway.handleNavigate(client, {
        sessionId: 'session-1',
        hostKey: 'valid',
        direction: 'next',
      });

      expect(client.emit).toHaveBeenCalledWith(
        WS_EVENTS.ERROR,
        expect.objectContaining({ code: 'SESSION_NOT_FOUND' }),
      );
    });
  });
});
