import { Module } from '@nestjs/common';
import { JiraModule } from '../jira/jira.module';
import { ParticipantsModule } from '../participants/participants.module';
import { SessionsModule } from '../sessions/sessions.module';
import { TicketScoreModule } from '../ticket-score/ticket-score.module';
import { SessionGateway } from './session.gateway';

@Module({
  imports: [SessionsModule, ParticipantsModule, TicketScoreModule, JiraModule],
  providers: [SessionGateway],
})
export class GatewayModule {}
