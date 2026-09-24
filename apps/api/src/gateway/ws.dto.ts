import { IsInt, IsNotEmpty, IsOptional, IsString, IsUrl, MaxLength, Min } from 'class-validator';

export class JoinSessionDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  sessionId: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  participantId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(256)
  hostKey?: string;

  @IsOptional()
  @IsString()
  @MaxLength(256)
  participantSecret?: string;
}

export class HostActionDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  sessionId: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  hostKey: string;
}

export class HostTeamQueueCompleteDto extends HostActionDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  queueName: string;
}

export class SubmitVoteDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  sessionId: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  participantId: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  value: string;
}

export class HostAddUrlDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  sessionId: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  hostKey: string;

  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  @MaxLength(2048)
  url: string;
}

export class HostNavigateDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  sessionId: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  hostKey: string;

  @IsInt()
  @Min(0)
  urlIndex: number;
}

export class KickParticipantDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  sessionId: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  hostKey: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  participantId: string;
}

export class UpdateParticipantProfileDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  sessionId: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  participantId: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  email?: string;
}
