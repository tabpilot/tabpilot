import { createHash, randomInt, randomUUID } from 'node:crypto';
import { Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type {
  CreateSessionResponse,
  JoinAsCoHostResponse,
  Session,
  SessionState,
} from '@tabpilot/shared';
import { decodeTeamQueueProgressKey, encodeTeamQueueProgressKey } from '@tabpilot/shared';
import type { Model } from 'mongoose';
import { CreateSessionDto } from './dto/create-session.dto';
import { SessionDoc, type SessionDocument } from './session.schema';

function generateJoinCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 6 }, () => chars[randomInt(chars.length)]).join('');
}

function hashKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

@Injectable()
export class SessionsService {
  constructor(
    @InjectModel(SessionDoc.name)
    private readonly sessionModel: Model<SessionDocument>,
  ) {}

  async create(dto: CreateSessionDto): Promise<CreateSessionResponse> {
    const sessionId = randomUUID();
    const joinCode = generateJoinCode();
    const hostKey = randomUUID();
    const hostKeyHash = hashKey(hostKey);
    const hostInviteKey = randomUUID();
    const hostInviteKeyHash = hashKey(hostInviteKey);

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + dto.expiryDays);

    const doc = await this.sessionModel.create({
      sessionId,
      name: dto.name,
      joinCode,
      hostName: dto.hostName,
      hostEmail: dto.hostEmail,
      hostKeyHash,
      hostInviteKeyHash,
      coHosts: [],
      urls: dto.urls,
      currentIndex: 0,
      state: 'waiting',
      votingEnabled: dto.votingEnabled ?? false,
      expiresAt,
    });

    return {
      session: this.toSessionDto(doc),
      hostKey,
      hostInviteKey,
    };
  }

  async findById(sessionId: string): Promise<SessionDocument | null> {
    if (typeof sessionId !== 'string') return null;
    return this.sessionModel.findOne({ sessionId: { $eq: sessionId } }).exec();
  }

  async findByJoinCode(code: string): Promise<SessionDocument | null> {
    if (typeof code !== 'string') return null;
    return this.sessionModel.findOne({ joinCode: { $eq: code.toUpperCase() } }).exec();
  }

  async validateHostKey(sessionId: string, hostKey: string): Promise<boolean> {
    const doc = await this.findById(sessionId);
    if (!doc) return false;
    return this.validateHostKeyForDoc(doc, hostKey);
  }

  validateHostKeyForDoc(doc: SessionDocument, hostKey: string): boolean {
    const hash = hashKey(hostKey);
    if (doc.hostKeyHash === hash) return true;
    return doc.coHosts.some((ch) => ch.keyHash === hash);
  }

  async validateHostInviteKey(sessionId: string, inviteKey: string): Promise<boolean> {
    const doc = await this.findById(sessionId);
    if (!doc) return false;
    return doc.hostInviteKeyHash === hashKey(inviteKey);
  }

  async joinAsCoHost(
    sessionId: string,
    inviteKey: string,
    name: string,
    email?: string,
  ): Promise<JoinAsCoHostResponse> {
    const valid = await this.validateHostInviteKey(sessionId, inviteKey);
    if (!valid) throw new UnauthorizedException('Invalid host invite key.');

    const coHostKey = randomUUID();
    const coHostKeyHash = hashKey(coHostKey);

    const doc = await this.sessionModel
      .findOneAndUpdate(
        { sessionId },
        {
          $push: {
            coHosts: {
              keyHash: coHostKeyHash,
              name,
              email: email || undefined,
              joinedAt: new Date(),
            },
          },
        },
        { returnDocument: 'after' },
      )
      .exec();

    if (!doc) throw new NotFoundException(`Session ${sessionId} not found`);

    return {
      session: this.toSessionDto(doc),
      hostKey: coHostKey,
    };
  }

  async updateState(sessionId: string, state: SessionState): Promise<SessionDocument> {
    const doc = await this.sessionModel
      .findOneAndUpdate({ sessionId }, { state }, { returnDocument: 'after' })
      .exec();
    if (!doc) throw new NotFoundException(`Session ${sessionId} not found`);
    return doc;
  }

  async updateCurrentIndex(sessionId: string, index: number): Promise<SessionDocument> {
    const doc = await this.sessionModel
      .findOneAndUpdate({ sessionId }, { currentIndex: index }, { returnDocument: 'after' })
      .exec();
    if (!doc) throw new NotFoundException(`Session ${sessionId} not found`);
    return doc;
  }

  async setTeamQueueProgress(
    sessionId: string,
    queueKey: string,
    position: number,
  ): Promise<SessionDocument> {
    const storageKey = encodeTeamQueueProgressKey(queueKey);
    const doc = await this.sessionModel
      .findOneAndUpdate(
        { sessionId },
        { $set: { [`teamQueueProgress.${storageKey}`]: position } },
        { returnDocument: 'after' },
      )
      .exec();
    if (!doc) throw new NotFoundException(`Session ${sessionId} not found`);
    return doc;
  }

  toSessionDto(doc: SessionDocument): Session {
    const obj = doc.toObject() as SessionDoc & {
      createdAt?: Date;
      updatedAt?: Date;
    };
    const storedQueueProgress = obj.teamQueueProgress ?? new Map<string, number>();
    const queueProgressEntries =
      storedQueueProgress instanceof Map
        ? Array.from(storedQueueProgress.entries())
        : (Object.entries(storedQueueProgress) as Array<[string, number]>);
    return {
      id: obj.sessionId,
      name: obj.name,
      joinCode: obj.joinCode,
      hostName: obj.hostName,
      hostEmail: obj.hostEmail,
      coHosts: (obj.coHosts ?? []).map((ch) => ({
        name: ch.name,
        email: ch.email,
        joinedAt: ch.joinedAt.toISOString(),
      })),
      urls: obj.urls,
      currentIndex: obj.currentIndex,
      state: obj.state,
      votingEnabled: obj.votingEnabled,
      teamQueuesEnabled: obj.teamQueuesEnabled ?? false,
      teamQueueProgress: Object.fromEntries(
        queueProgressEntries.map(([key, position]) => [decodeTeamQueueProgressKey(key), position]),
      ),
      isLocked: obj.isLocked ?? false,
      createdAt: obj.createdAt ? obj.createdAt.toISOString() : new Date().toISOString(),
      expiresAt: obj.expiresAt.toISOString(),
    };
  }

  async updateHostProfile(sessionId: string, name: string, email = ''): Promise<SessionDocument> {
    const update: Record<string, unknown> = { hostName: name, hostEmail: email || null };
    const doc = await this.sessionModel
      .findOneAndUpdate({ sessionId }, update, { returnDocument: 'after' })
      .exec();
    if (!doc) throw new NotFoundException(`Session ${sessionId} not found`);
    return doc;
  }

  async setLocked(sessionId: string, isLocked: boolean): Promise<SessionDocument | null> {
    return this.sessionModel
      .findOneAndUpdate({ sessionId }, { isLocked }, { returnDocument: 'after' })
      .exec();
  }

  async setVotingEnabled(
    sessionId: string,
    votingEnabled: boolean,
  ): Promise<SessionDocument | null> {
    return this.sessionModel
      .findOneAndUpdate({ sessionId }, { votingEnabled }, { returnDocument: 'after' })
      .exec();
  }

  async setTeamQueuesEnabled(
    sessionId: string,
    teamQueuesEnabled: boolean,
  ): Promise<SessionDocument | null> {
    return this.sessionModel
      .findOneAndUpdate({ sessionId }, { teamQueuesEnabled }, { returnDocument: 'after' })
      .exec();
  }

  async deleteSession(sessionId: string): Promise<void> {
    await this.sessionModel.deleteOne({ sessionId }).exec();
  }

  async addUrl(sessionId: string, url: string): Promise<SessionDocument | null> {
    return this.sessionModel
      .findOneAndUpdate({ sessionId }, { $push: { urls: url } }, { returnDocument: 'after' })
      .exec();
  }

  async removeUrl(sessionId: string, index: number): Promise<SessionDocument | null> {
    const doc = await this.sessionModel.findOne({ sessionId }).exec();
    if (!doc || index < 0 || index >= doc.urls.length) return null;

    const urls = [...doc.urls];
    urls.splice(index, 1);

    let currentIndex = doc.currentIndex;
    if (urls.length === 0) {
      currentIndex = 0;
    } else if (index < currentIndex) {
      currentIndex = Math.max(0, currentIndex - 1);
    } else if (index === currentIndex) {
      currentIndex = Math.min(currentIndex, urls.length - 1);
    }

    return this.sessionModel
      .findOneAndUpdate({ sessionId }, { urls, currentIndex }, { returnDocument: 'after' })
      .exec();
  }

  async reorderUrls(
    sessionId: string,
    fromIndex: number,
    toIndex: number,
  ): Promise<SessionDocument | null> {
    const doc = await this.sessionModel.findOne({ sessionId }).exec();
    if (!doc) return null;

    const urls = [...doc.urls];

    if (
      fromIndex < 0 ||
      fromIndex >= urls.length ||
      toIndex < 0 ||
      toIndex >= urls.length ||
      fromIndex === toIndex
    )
      return null;

    const [moved] = urls.splice(fromIndex, 1);
    urls.splice(toIndex, 0, moved);

    // currentIndex is a queue position (slot), not tied to a URL.
    // Reordering never advances or retreats the queue pointer.
    return this.sessionModel
      .findOneAndUpdate({ sessionId }, { urls }, { returnDocument: 'after' })
      .exec();
  }

  // ── Per-ticket vote persistence ───────────────────────────────────────────

  /** Upsert a participant's vote for a specific URL index. */
  async setTicketVote(
    sessionId: string,
    urlIndex: number,
    participantId: string,
    value: string,
  ): Promise<void> {
    // Pull any existing vote for this participant+index, then push the new one
    await this.sessionModel
      .findOneAndUpdate({ sessionId }, { $pull: { votes: { urlIndex, participantId } } })
      .exec();
    await this.sessionModel
      .findOneAndUpdate(
        { sessionId },
        { $push: { votes: { urlIndex, participantId, value } } },
        { returnDocument: 'after' },
      )
      .exec();
  }

  /** Clear all votes for a specific URL index (host reset). */
  async clearTicketVotes(sessionId: string, urlIndex: number): Promise<void> {
    await this.sessionModel
      .findOneAndUpdate({ sessionId }, { $pull: { votes: { urlIndex } } })
      .exec();
  }

  /** Persist a story point value keyed by the URL's SHA-256 hash. */
  async setStoryPoint(sessionId: string, urlKey: string, value: string): Promise<void> {
    await this.sessionModel
      .findOneAndUpdate(
        { sessionId },
        { $set: { [`storyPoints.${urlKey}`]: value } },
        { returnDocument: 'after' },
      )
      .exec();
  }

  /** Clear the story point keyed by the URL's SHA-256 hash. */
  async clearStoryPoint(sessionId: string, urlKey: string): Promise<void> {
    await this.sessionModel
      .findOneAndUpdate({ sessionId }, { $unset: { [`storyPoints.${urlKey}`]: '' } })
      .exec();
  }

  /** Mark or unmark a URL index as revealed. */
  async setTicketRevealed(sessionId: string, urlIndex: number, revealed: boolean): Promise<void> {
    const op = revealed
      ? { $addToSet: { revealedIndices: urlIndex } }
      : { $pull: { revealedIndices: urlIndex } };
    await this.sessionModel.findOneAndUpdate({ sessionId }, op).exec();
  }
}
