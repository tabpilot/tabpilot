import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { JiraModule } from '../jira/jira.module';
import { TicketScoreController } from './ticket-score.controller';
import { TicketScoreDoc, TicketScoreSchema } from './ticket-score.schema';
import { TicketScoreService } from './ticket-score.service';

@Module({
  imports: [
    JiraModule,
    MongooseModule.forFeature([{ name: TicketScoreDoc.name, schema: TicketScoreSchema }]),
  ],
  controllers: [TicketScoreController],
  providers: [TicketScoreService],
  exports: [TicketScoreService],
})
export class TicketScoreModule {}
