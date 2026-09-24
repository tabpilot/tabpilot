import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Query,
} from '@nestjs/common';
import {
  ApiNoContentResponse,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { JiraService } from '../jira/jira.service';
import { TicketScoreService } from './ticket-score.service';

@ApiTags('ticket-score')
@Throttle({ default: { limit: 10, ttl: 60000 } })
@Controller('ticket-score')
export class TicketScoreController {
  constructor(
    private readonly ticketScoreService: TicketScoreService,
    private readonly jiraService: JiraService,
  ) {}

  @Get('status')
  @ApiOperation({ summary: 'Check if ticket scoring is configured' })
  @ApiResponse({ status: 200, schema: { example: { configured: true } } })
  status() {
    return {
      configured: this.ticketScoreService.isConfigured,
    };
  }

  @Get('url')
  @ApiOperation({ summary: 'Score any public URL for content quality' })
  @ApiResponse({ status: 200, description: 'URL score returned.' })
  @ApiResponse({ status: 422, description: 'URL is not crawlable.' })
  @ApiResponse({ status: 503, description: 'Scoring not configured.' })
  async scoreByUrl(@Query('url') url: string) {
    if (!url) throw new BadRequestException('url query param is required');
    return this.ticketScoreService.scoreByUrl(url);
  }

  @Delete('url')
  @HttpCode(204)
  @ApiOperation({ summary: 'Clear cached score for a URL (triggers re-score on next GET)' })
  @ApiNoContentResponse({ description: 'Cache cleared.' })
  async clearScoreByUrl(@Query('url') url: string) {
    if (!url) throw new BadRequestException('url query param is required');
    await this.ticketScoreService.clearCacheByUrl(url);
  }

  @Get(':key')
  @ApiOperation({ summary: 'Score a Jira ticket for clarity and quality' })
  @ApiParam({ name: 'key', example: 'PROJ-123', description: 'Jira issue key' })
  @ApiResponse({ status: 200, description: 'Ticket score returned.' })
  @ApiResponse({ status: 503, description: 'Scoring or Jira not configured.' })
  async scoreTicket(@Param('key') key: string, @Query('baseUrl') baseUrl?: string) {
    const upperKey = key.toUpperCase();
    const cached = await this.ticketScoreService.getCached(upperKey);
    if (cached) return cached;
    const issue = await this.jiraService.getIssueWithDescription(upperKey, baseUrl);
    return this.ticketScoreService.scoreTicket(upperKey, issue.summary, issue.description);
  }

  @Delete(':key')
  @HttpCode(204)
  @ApiOperation({ summary: 'Clear cached score for a ticket (triggers re-score on next GET)' })
  @ApiParam({ name: 'key', example: 'PROJ-123', description: 'Jira issue key' })
  @ApiNoContentResponse({ description: 'Cache cleared.' })
  async clearScore(@Param('key') key: string) {
    await this.ticketScoreService.clearCache(key);
  }
}
