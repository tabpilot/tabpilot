import { Body, Controller, Get, Param, Patch, Query, UnauthorizedException } from '@nestjs/common';
import {
  ApiBody,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { SessionsService } from '../sessions/sessions.service';
import { SetStoryPointsDto } from './dto/set-story-points.dto';
import { JiraService } from './jira.service';

@ApiTags('jira')
@Controller('jira')
export class JiraController {
  constructor(
    private readonly jiraService: JiraService,
    private readonly sessionsService: SessionsService,
  ) {}

  @Get('status')
  @ApiOperation({ summary: 'Check if Jira integration is configured' })
  @ApiResponse({ status: 200, schema: { example: { configured: true } } })
  status() {
    return {
      configured: this.jiraService.isConfigured,
      storyPointProjects: this.jiraService.configuredStoryPointProjects,
      hasExtraFields: this.jiraService.hasExtraFieldsConfigured,
    };
  }

  @Get('issue/:key')
  @ApiOperation({
    summary: 'Fetch a Jira issue by key',
    description:
      'Proxies to the configured Jira instance. Returns the issue summary, status, type, and team. ' +
      'Requires JIRA_USER_EMAIL, JIRA_API_TOKEN, and JIRA_BASE_URL. The server only sends credentials to this configured host.',
  })
  @ApiParam({ name: 'key', example: 'CONNCERT-2771', description: 'Jira issue key' })
  @ApiResponse({
    status: 200,
    description: 'Issue found.',
    schema: {
      example: {
        key: 'CONNCERT-2771',
        summary: 'Fix login bug',
        status: 'In Progress',
        issueType: 'Bug',
        team: 'Platform',
      },
    },
  })
  @ApiNotFoundResponse({ description: 'Issue not found in Jira.' })
  @ApiResponse({ status: 503, description: 'Jira not configured or unreachable.' })
  getIssue(@Param('key') key: string, @Query('baseUrl') baseUrl?: string) {
    return this.jiraService.getIssue(key.toUpperCase(), baseUrl);
  }

  @Patch('issue/:key/story-points')
  @ApiOperation({
    summary: 'Update the story-points field on a Jira issue',
    description:
      "Writes a story-points value to the configured field for the issue's project. " +
      'The per-project field name is set via the JIRA_STORY_POINTS_FIELDS env var ' +
      '(format: "PROJKEY=fieldName,PROJKEY2=fieldName2").',
  })
  @ApiParam({ name: 'key', example: 'CONNCERT-3114', description: 'Jira issue key' })
  @ApiBody({ schema: { example: { points: 5, skipExtraFields: false } } })
  @ApiNoContentResponse({ description: 'Story points updated successfully.' })
  @ApiNotFoundResponse({ description: 'Issue not found in Jira.' })
  @ApiResponse({ status: 400, description: 'Invalid key or project not configured.' })
  @ApiResponse({ status: 503, description: 'Jira not configured or unreachable.' })
  async setStoryPoints(@Param('key') key: string, @Body() body: SetStoryPointsDto) {
    const isValid = await this.sessionsService.validateHostKey(body.sessionId, body.hostKey);
    if (!isValid) {
      throw new UnauthorizedException('Invalid host credentials');
    }
    return this.jiraService.setStoryPoints(
      key.toUpperCase(),
      body.points,
      body.baseUrl,
      body.skipExtraFields,
    );
  }
}
