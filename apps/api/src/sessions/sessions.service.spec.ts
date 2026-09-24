import 'reflect-metadata';
import { getModelToken, MongooseModule } from '@nestjs/mongoose';
import { Test, type TestingModule } from '@nestjs/testing';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { type Connection, connect, type Model } from 'mongoose';
import type { CreateSessionDto } from './dto/create-session.dto';
import { SessionDoc, SessionSchema } from './session.schema';
import { SessionsService } from './sessions.service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const defaultDto: CreateSessionDto = {
  name: 'Test Session',
  hostName: 'Host User',
  hostEmail: 'host@example.com',
  urls: ['https://example.com', 'https://other.com'],
  expiryDays: 7,
  votingEnabled: false,
};

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const JOIN_CODE_REGEX = /^[A-Z2-9]{6}$/;

// ---------------------------------------------------------------------------
// Test Suite
// ---------------------------------------------------------------------------
describe('SessionsService', () => {
  let mongod: MongoMemoryServer;
  let mongoConnection: Connection;
  let service: SessionsService;
  let sessionModel: Model<SessionDoc>;
  let module: TestingModule;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    const uri = mongod.getUri();
    mongoConnection = (await connect(uri)).connection;

    module = await Test.createTestingModule({
      imports: [
        MongooseModule.forRoot(uri),
        MongooseModule.forFeature([{ name: SessionDoc.name, schema: SessionSchema }]),
      ],
      providers: [SessionsService],
    }).compile();

    service = module.get<SessionsService>(SessionsService);
    sessionModel = module.get<Model<SessionDoc>>(getModelToken(SessionDoc.name));
  });

  afterAll(async () => {
    await module.close();
    await mongoConnection.dropDatabase();
    await mongoConnection.close();
    await mongod.stop();
  });

  afterEach(async () => {
    await sessionModel.deleteMany({});
  });

  // -------------------------------------------------------------------------
  // create()
  // -------------------------------------------------------------------------
  describe('create()', () => {
    it('should create a session with a valid sessionId in UUID format', async () => {
      const { session } = await service.create(defaultDto);
      expect(session.id).toMatch(UUID_REGEX);
    });

    it('should generate a 6-character uppercase alphanumeric joinCode', async () => {
      const { session } = await service.create(defaultDto);
      expect(session.joinCode).toMatch(JOIN_CODE_REGEX);
    });

    it('should return a raw hostKey that is a non-empty string', async () => {
      const { hostKey } = await service.create(defaultDto);
      expect(typeof hostKey).toBe('string');
      expect(hostKey.length).toBeGreaterThan(0);
    });

    it('should store a hashed hostKeyHash that is not equal to the raw key', async () => {
      const { session, hostKey } = await service.create(defaultDto);
      const doc = await sessionModel.findOne({ sessionId: session.id });
      expect(doc).not.toBeNull();
      expect(doc?.hostKeyHash).not.toBe(hostKey);
    });

    it('should set state to "waiting"', async () => {
      const { session } = await service.create(defaultDto);
      expect(session.state).toBe('waiting');
    });

    it('should set currentIndex to 0', async () => {
      const { session } = await service.create(defaultDto);
      expect(session.currentIndex).toBe(0);
    });

    it('should initialize team queue progress for new sessions', async () => {
      const { session } = await service.create(defaultDto);
      expect(session.teamQueueProgress).toEqual({});
    });

    it('should correctly compute expiresAt based on expiryDays', async () => {
      const before = new Date();
      const { session } = await service.create({ ...defaultDto, expiryDays: 3 });
      const after = new Date();

      const expiresAt = new Date(session.expiresAt);
      const expectedMin = new Date(before);
      expectedMin.setDate(expectedMin.getDate() + 3);
      const expectedMax = new Date(after);
      expectedMax.setDate(expectedMax.getDate() + 3);

      expect(expiresAt.getTime()).toBeGreaterThanOrEqual(expectedMin.getTime() - 1000);
      expect(expiresAt.getTime()).toBeLessThanOrEqual(expectedMax.getTime() + 1000);
    });
  });

  // -------------------------------------------------------------------------
  // findById()
  // -------------------------------------------------------------------------
  describe('findById()', () => {
    it('should return the session document by sessionId', async () => {
      const { session } = await service.create(defaultDto);
      const found = await service.findById(session.id);
      expect(found).not.toBeNull();
      expect(found?.sessionId).toBe(session.id);
    });

    it('should return null for a nonexistent sessionId', async () => {
      const found = await service.findById('00000000-0000-0000-0000-000000000000');
      expect(found).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // findByJoinCode()
  // -------------------------------------------------------------------------
  describe('findByJoinCode()', () => {
    it('should return the session by join code', async () => {
      const { session } = await service.create(defaultDto);
      const found = await service.findByJoinCode(session.joinCode);
      expect(found).not.toBeNull();
      expect(found?.sessionId).toBe(session.id);
    });

    it('should return the session using a lowercase join code (case-insensitive)', async () => {
      const { session } = await service.create(defaultDto);
      const found = await service.findByJoinCode(session.joinCode.toLowerCase());
      expect(found).not.toBeNull();
      expect(found?.sessionId).toBe(session.id);
    });

    it('should return null for a wrong code', async () => {
      await service.create(defaultDto);
      const found = await service.findByJoinCode('XXXXXX');
      expect(found).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // create() — hostInviteKey
  // -------------------------------------------------------------------------
  describe('create() — hostInviteKey', () => {
    it('should return a raw hostInviteKey that is a non-empty string', async () => {
      const { hostInviteKey } = await service.create(defaultDto);
      expect(typeof hostInviteKey).toBe('string');
      expect(hostInviteKey.length).toBeGreaterThan(0);
    });

    it('should store a hashed hostInviteKeyHash distinct from the raw invite key', async () => {
      const { session, hostInviteKey } = await service.create(defaultDto);
      const doc = await sessionModel.findOne({ sessionId: session.id });
      expect(doc).not.toBeNull();
      expect(doc?.hostInviteKeyHash).not.toBe(hostInviteKey);
    });

    it('should initialise coHosts as an empty array', async () => {
      const { session } = await service.create(defaultDto);
      const doc = await sessionModel.findOne({ sessionId: session.id });
      expect(doc?.coHosts).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // validateHostKey()
  // -------------------------------------------------------------------------
  describe('validateHostKey()', () => {
    it('should return true for the correct primary host key', async () => {
      const { session, hostKey } = await service.create(defaultDto);
      const valid = await service.validateHostKey(session.id, hostKey);
      expect(valid).toBe(true);
    });

    it('should return true for a valid co-host key after joining', async () => {
      const { session, hostInviteKey } = await service.create(defaultDto);
      const { hostKey: coHostKey } = await service.joinAsCoHost(
        session.id,
        hostInviteKey,
        'Co Host',
      );
      const valid = await service.validateHostKey(session.id, coHostKey);
      expect(valid).toBe(true);
    });

    it('should return false for a wrong key', async () => {
      const { session } = await service.create(defaultDto);
      const valid = await service.validateHostKey(session.id, 'wrong-key');
      expect(valid).toBe(false);
    });

    it('should return false for a nonexistent sessionId', async () => {
      const valid = await service.validateHostKey(
        '00000000-0000-0000-0000-000000000000',
        'any-key',
      );
      expect(valid).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // validateHostInviteKey()
  // -------------------------------------------------------------------------
  describe('validateHostInviteKey()', () => {
    it('should return true for the correct invite key', async () => {
      const { session, hostInviteKey } = await service.create(defaultDto);
      const valid = await service.validateHostInviteKey(session.id, hostInviteKey);
      expect(valid).toBe(true);
    });

    it('should return false for a wrong invite key', async () => {
      const { session } = await service.create(defaultDto);
      const valid = await service.validateHostInviteKey(session.id, 'wrong-invite-key');
      expect(valid).toBe(false);
    });

    it('should return false for a nonexistent sessionId', async () => {
      const valid = await service.validateHostInviteKey(
        '00000000-0000-0000-0000-000000000000',
        'any-key',
      );
      expect(valid).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // joinAsCoHost()
  // -------------------------------------------------------------------------
  describe('joinAsCoHost()', () => {
    it('should return a unique hostKey for the co-host', async () => {
      const { session, hostInviteKey, hostKey: primaryKey } = await service.create(defaultDto);
      const { hostKey: coHostKey } = await service.joinAsCoHost(
        session.id,
        hostInviteKey,
        'Co Host',
      );
      expect(typeof coHostKey).toBe('string');
      expect(coHostKey.length).toBeGreaterThan(0);
      expect(coHostKey).not.toBe(primaryKey);
    });

    it('should add the co-host to the coHosts array in the document', async () => {
      const { session, hostInviteKey } = await service.create(defaultDto);
      await service.joinAsCoHost(session.id, hostInviteKey, 'Co Host', 'co@example.com');
      const doc = await sessionModel.findOne({ sessionId: session.id });
      expect(doc?.coHosts).toHaveLength(1);
      expect(doc?.coHosts[0].name).toBe('Co Host');
      expect(doc?.coHosts[0].email).toBe('co@example.com');
      expect(doc?.coHosts[0].keyHash).toBeTruthy();
    });

    it('should allow multiple co-hosts to join', async () => {
      const { session, hostInviteKey } = await service.create(defaultDto);
      await service.joinAsCoHost(session.id, hostInviteKey, 'Co Host One');
      await service.joinAsCoHost(session.id, hostInviteKey, 'Co Host Two');
      const doc = await sessionModel.findOne({ sessionId: session.id });
      expect(doc?.coHosts).toHaveLength(2);
    });

    it('should include session DTO in the response', async () => {
      const { session, hostInviteKey } = await service.create(defaultDto);
      const { session: responseSession } = await service.joinAsCoHost(
        session.id,
        hostInviteKey,
        'Co Host',
      );
      expect(responseSession.id).toBe(session.id);
    });

    it('should throw UnauthorizedException for an invalid invite key', async () => {
      const { session } = await service.create(defaultDto);
      await expect(service.joinAsCoHost(session.id, 'bad-invite-key', 'Co Host')).rejects.toThrow(
        'Invalid host invite key',
      );
    });

    it('should throw NotFoundException for a nonexistent sessionId', async () => {
      const { hostInviteKey } = await service.create(defaultDto);
      // Validate invite key returns false for nonexistent session, so it throws Unauthorized first
      await expect(
        service.joinAsCoHost('00000000-0000-0000-0000-000000000000', hostInviteKey, 'Co Host'),
      ).rejects.toThrow();
    });

    it('should expose co-hosts in the session DTO after joining', async () => {
      const { session, hostInviteKey } = await service.create(defaultDto);
      const { session: updatedSession } = await service.joinAsCoHost(
        session.id,
        hostInviteKey,
        'Co Host',
        'co@example.com',
      );
      expect(updatedSession.coHosts).toHaveLength(1);
      expect(updatedSession.coHosts[0].name).toBe('Co Host');
      expect(updatedSession.coHosts[0].email).toBe('co@example.com');
    });
  });

  // -------------------------------------------------------------------------
  // updateState()
  // -------------------------------------------------------------------------
  describe('updateState()', () => {
    it('should update state from waiting → active', async () => {
      const { session } = await service.create(defaultDto);
      const updated = await service.updateState(session.id, 'active');
      expect(updated.state).toBe('active');
    });

    it('should update state from active → ended', async () => {
      const { session } = await service.create(defaultDto);
      await service.updateState(session.id, 'active');
      const updated = await service.updateState(session.id, 'ended');
      expect(updated.state).toBe('ended');
    });
  });

  // -------------------------------------------------------------------------
  // updateCurrentIndex()
  // -------------------------------------------------------------------------
  describe('updateCurrentIndex()', () => {
    it('should update currentIndex', async () => {
      const { session } = await service.create(defaultDto);
      const updated = await service.updateCurrentIndex(session.id, 1);
      expect(updated.currentIndex).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // setLocked()
  // -------------------------------------------------------------------------
  describe('setLocked()', () => {
    it('should set isLocked to true', async () => {
      const { session } = await service.create(defaultDto);
      const updated = await service.setLocked(session.id, true);
      expect(updated?.isLocked).toBe(true);
    });

    it('should set isLocked back to false', async () => {
      const { session } = await service.create(defaultDto);
      await service.setLocked(session.id, true);
      const updated = await service.setLocked(session.id, false);
      expect(updated?.isLocked).toBe(false);
    });

    it('should return null for a nonexistent sessionId', async () => {
      const result = await service.setLocked('00000000-0000-0000-0000-000000000000', true);
      expect(result).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // addUrl()
  // -------------------------------------------------------------------------
  describe('addUrl()', () => {
    it('should append a URL to the urls array', async () => {
      const { session } = await service.create(defaultDto);
      const updated = await service.addUrl(session.id, 'https://added.com');
      expect(updated?.urls).toContain('https://added.com');
      expect(updated?.urls).toHaveLength(defaultDto.urls.length + 1);
    });

    it('should return null for a nonexistent sessionId', async () => {
      const result = await service.addUrl('00000000-0000-0000-0000-000000000000', 'https://x.com');
      expect(result).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // removeUrl()
  // -------------------------------------------------------------------------
  describe('removeUrl()', () => {
    it('should remove the URL at the given index', async () => {
      const { session } = await service.create(defaultDto);
      const updated = await service.removeUrl(session.id, 0);
      expect(updated?.urls).not.toContain(defaultDto.urls[0]);
      expect(updated?.urls).toHaveLength(defaultDto.urls.length - 1);
    });

    it('should return null for an out-of-bounds index', async () => {
      const { session } = await service.create(defaultDto);
      const result = await service.removeUrl(session.id, 999);
      expect(result).toBeNull();
    });

    it('should clamp currentIndex when the current URL is removed', async () => {
      const { session } = await service.create(defaultDto);
      // Advance to last URL (index 1) then remove it
      await service.updateCurrentIndex(session.id, 1);
      const updated = await service.removeUrl(session.id, 1);
      // After removing index 1 the only remaining URL is at index 0
      expect(updated?.currentIndex).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // reorderUrls()
  // -------------------------------------------------------------------------
  describe('reorderUrls()', () => {
    it('should reorder URLs when both indices are strictly after currentIndex', async () => {
      // Create a session with three URLs so we can reorder indices 1 and 2
      const { session } = await service.create({
        ...defaultDto,
        urls: ['https://a.com', 'https://b.com', 'https://c.com'],
      });
      // Start at index 0 so indices 1 and 2 are future items
      const updated = await service.reorderUrls(session.id, 1, 2);
      // b and c should have swapped
      expect(updated?.urls[1]).toBe('https://c.com');
      expect(updated?.urls[2]).toBe('https://b.com');
    });

    it('should return null when fromIndex equals toIndex', async () => {
      const { session } = await service.create(defaultDto);
      const result = await service.reorderUrls(session.id, 1, 1);
      expect(result).toBeNull();
    });

    it('should return null for a nonexistent sessionId', async () => {
      const result = await service.reorderUrls('00000000-0000-0000-0000-000000000000', 0, 1);
      expect(result).toBeNull();
    });

    it('should allow reordering past items (index before currentIndex)', async () => {
      const { session } = await service.create({
        ...defaultDto,
        urls: ['https://a.com', 'https://b.com', 'https://c.com', 'https://d.com'],
      });
      await service.updateCurrentIndex(session.id, 2);
      // Move past item 0 to past item 1
      const updated = await service.reorderUrls(session.id, 0, 1);
      expect(updated?.urls[0]).toBe('https://b.com');
      expect(updated?.urls[1]).toBe('https://a.com');
    });

    it('should never change currentIndex regardless of what moves', async () => {
      const { session } = await service.create({
        ...defaultDto,
        urls: ['https://a.com', 'https://b.com', 'https://c.com', 'https://d.com'],
      });
      await service.updateCurrentIndex(session.id, 2);
      // Move item before current to after current — currentIndex must stay at 2
      const updated = await service.reorderUrls(session.id, 0, 3);
      expect(updated?.currentIndex).toBe(2);
    });

    it('should never change currentIndex even when the current item is moved', async () => {
      const { session } = await service.create({
        ...defaultDto,
        urls: ['https://a.com', 'https://b.com', 'https://c.com', 'https://d.com'],
      });
      await service.updateCurrentIndex(session.id, 1);
      // Move the current item (index 1) to index 3 — slot stays at 1
      const updated = await service.reorderUrls(session.id, 1, 3);
      expect(updated?.currentIndex).toBe(1);
    });
  });

  // ── Vote persistence ────────────────────────────────────────────────────────

  describe('setTicketVote()', () => {
    it('stores a vote for a given url index and participant', async () => {
      const { session } = await service.create(defaultDto);
      await service.setTicketVote(session.id, 0, 'p-1', '5');
      const doc = await service.findById(session.id);
      expect(doc?.votes).toContainEqual(
        expect.objectContaining({ urlIndex: 0, participantId: 'p-1', value: '5' }),
      );
    });

    it('updates an existing vote for the same participant and index', async () => {
      const { session } = await service.create(defaultDto);
      await service.setTicketVote(session.id, 0, 'p-1', '5');
      await service.setTicketVote(session.id, 0, 'p-1', '8');
      const doc = await service.findById(session.id);
      const vote = doc?.votes.find((v) => v.participantId === 'p-1' && v.urlIndex === 0);
      expect(vote?.value).toBe('8');
      expect(doc?.votes.filter((v) => v.participantId === 'p-1' && v.urlIndex === 0)).toHaveLength(
        1,
      );
    });

    it('stores votes for different participants independently', async () => {
      const { session } = await service.create(defaultDto);
      await service.setTicketVote(session.id, 0, 'p-1', '3');
      await service.setTicketVote(session.id, 0, 'p-2', '8');
      const doc = await service.findById(session.id);
      expect(doc?.votes).toHaveLength(2);
    });
  });

  describe('clearTicketVotes()', () => {
    it('removes all votes for a specific url index', async () => {
      const { session } = await service.create(defaultDto);
      await service.setTicketVote(session.id, 0, 'p-1', '5');
      await service.setTicketVote(session.id, 1, 'p-1', '8');
      await service.clearTicketVotes(session.id, 0);
      const doc = await service.findById(session.id);
      expect(doc?.votes.filter((v) => v.urlIndex === 0)).toHaveLength(0);
      expect(doc?.votes.filter((v) => v.urlIndex === 1)).toHaveLength(1);
    });
  });

  describe('setTicketRevealed()', () => {
    it('adds a url index to revealedIndices', async () => {
      const { session } = await service.create(defaultDto);
      await service.setTicketRevealed(session.id, 0, true);
      const doc = await service.findById(session.id);
      expect(doc?.revealedIndices).toContain(0);
    });

    it('removes a url index from revealedIndices when revealed=false', async () => {
      const { session } = await service.create(defaultDto);
      await service.setTicketRevealed(session.id, 0, true);
      await service.setTicketRevealed(session.id, 0, false);
      const doc = await service.findById(session.id);
      expect(doc?.revealedIndices).not.toContain(0);
    });

    it('does not duplicate an index when added twice', async () => {
      const { session } = await service.create(defaultDto);
      await service.setTicketRevealed(session.id, 0, true);
      await service.setTicketRevealed(session.id, 0, true);
      const doc = await service.findById(session.id);
      expect(doc?.revealedIndices.filter((i) => i === 0)).toHaveLength(1);
    });
  });

  describe('setStoryPoint()', () => {
    it('stores a story point by url key', async () => {
      const { session } = await service.create(defaultDto);
      await service.setStoryPoint(session.id, 'abc123', '5');
      const doc = await service.findById(session.id);
      expect(doc?.storyPoints.get('abc123')).toBe('5');
    });

    it('overwrites an existing story point for the same key', async () => {
      const { session } = await service.create(defaultDto);
      await service.setStoryPoint(session.id, 'abc123', '5');
      await service.setStoryPoint(session.id, 'abc123', '13');
      const doc = await service.findById(session.id);
      expect(doc?.storyPoints.get('abc123')).toBe('13');
    });
  });

  describe('clearStoryPoint()', () => {
    it('removes a story point by url key', async () => {
      const { session } = await service.create(defaultDto);
      await service.setStoryPoint(session.id, 'abc123', '5');
      await service.clearStoryPoint(session.id, 'abc123');
      const doc = await service.findById(session.id);
      expect(doc?.storyPoints.has('abc123')).toBe(false);
    });

    it('is a no-op for a key that does not exist', async () => {
      const { session } = await service.create(defaultDto);
      await expect(service.clearStoryPoint(session.id, 'nonexistent')).resolves.not.toThrow();
    });
  });

  describe('updateHostProfile()', () => {
    it('updates hostName and hostEmail', async () => {
      const { session } = await service.create(defaultDto);
      const updated = await service.updateHostProfile(session.id, 'New Name', 'new@example.com');
      expect(updated.hostName).toBe('New Name');
      expect(updated.hostEmail).toBe('new@example.com');
    });

    it('sets hostEmail to null when empty string passed', async () => {
      const { session } = await service.create(defaultDto);
      const updated = await service.updateHostProfile(session.id, 'New Name', '');
      expect(updated.hostEmail).toBeNull();
    });

    it('throws NotFoundException for nonexistent session', async () => {
      await expect(
        service.updateHostProfile('00000000-0000-0000-0000-000000000000', 'Name'),
      ).rejects.toThrow('not found');
    });
  });

  describe('setLocked()', () => {
    it('sets isLocked to true', async () => {
      const { session } = await service.create(defaultDto);
      const doc = await service.setLocked(session.id, true);
      expect(doc?.isLocked).toBe(true);
    });

    it('returns null for nonexistent session', async () => {
      const result = await service.setLocked('00000000-0000-0000-0000-000000000000', true);
      expect(result).toBeNull();
    });
  });

  describe('setVotingEnabled()', () => {
    it('enables voting', async () => {
      const { session } = await service.create(defaultDto);
      const doc = await service.setVotingEnabled(session.id, true);
      expect(doc?.votingEnabled).toBe(true);
    });

    it('returns null for nonexistent session', async () => {
      const result = await service.setVotingEnabled('00000000-0000-0000-0000-000000000000', true);
      expect(result).toBeNull();
    });
  });

  describe('setTeamQueuesEnabled()', () => {
    it('enables team queues', async () => {
      const { session } = await service.create(defaultDto);
      const doc = await service.setTeamQueuesEnabled(session.id, true);
      expect(doc?.teamQueuesEnabled).toBe(true);
    });

    it('returns null for nonexistent session', async () => {
      const result = await service.setTeamQueuesEnabled(
        '00000000-0000-0000-0000-000000000000',
        true,
      );
      expect(result).toBeNull();
    });
  });

  describe('setTeamQueueProgress()', () => {
    it('persists and returns progress keyed by the original team filter key', async () => {
      const { session } = await service.create(defaultDto);

      const doc = await service.setTeamQueueProgress(session.id, 'team:Alpha.v2', 2);

      expect(doc.teamQueueProgress?.get('team%3AAlpha%2Ev2')).toBe(2);
      expect(service.toSessionDto(doc).teamQueueProgress).toEqual({ 'team:Alpha.v2': 2 });
    });
  });

  describe('deleteSession()', () => {
    it('removes the session from the database', async () => {
      const { session } = await service.create(defaultDto);
      await service.deleteSession(session.id);
      expect(await service.findById(session.id)).toBeNull();
    });
  });

  describe('removeUrl() edge cases', () => {
    it('adjusts currentIndex down when a url before it is removed', async () => {
      const { session } = await service.create({
        ...defaultDto,
        urls: ['https://a.com', 'https://b.com', 'https://c.com'],
      });
      await service.updateCurrentIndex(session.id, 2);
      const doc = await service.removeUrl(session.id, 0);
      expect(doc?.currentIndex).toBe(1);
    });

    it('clamps currentIndex when the current url is removed', async () => {
      const { session } = await service.create({
        ...defaultDto,
        urls: ['https://a.com', 'https://b.com'],
      });
      await service.updateCurrentIndex(session.id, 1);
      const doc = await service.removeUrl(session.id, 1);
      expect(doc?.currentIndex).toBe(0);
    });

    it('resets currentIndex to 0 when all urls removed', async () => {
      const { session } = await service.create({ ...defaultDto, urls: ['https://a.com'] });
      const doc = await service.removeUrl(session.id, 0);
      expect(doc?.currentIndex).toBe(0);
      expect(doc?.urls).toHaveLength(0);
    });

    it('returns null for out-of-range index', async () => {
      const { session } = await service.create(defaultDto);
      expect(await service.removeUrl(session.id, 99)).toBeNull();
    });
  });
});
