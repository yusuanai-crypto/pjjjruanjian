import { Body, Controller, Get, Post, Query, Req } from '@nestjs/common';

import { AuthNestService } from '../auth/auth.nest.service';
import {
  AiChatService,
  type AiChatHistoryQuery,
  type AiChatRequestBody,
} from './ai-chat.service';
import { AiTemplatesService } from './ai-templates.service';

@Controller('ai/chat')
export class AiController {
  constructor(
    private readonly authService: AuthNestService,
    private readonly chatService: AiChatService,
    private readonly templatesService: AiTemplatesService,
  ) {}

  @Post()
  async sendChat(@Req() request: any, @Body() body: AiChatRequestBody) {
    const actor = await this.authService.authenticateRequest(request);
    return this.chatService.sendChat(actor, body);
  }

  @Get('templates')
  async listTemplates(@Req() request: any) {
    const actor = await this.authService.authenticateRequest(request);
    return this.templatesService.listTemplates(actor);
  }

  @Get('history')
  async listHistory(@Req() request: any, @Query() query: AiChatHistoryQuery) {
    const actor = await this.authService.authenticateRequest(request);
    return this.chatService.listHistory(actor, query);
  }
}

@Controller('ai')
export class AiCapabilitiesController {
  constructor(
    private readonly authService: AuthNestService,
    private readonly chatService: AiChatService,
  ) {}

  @Get('capabilities')
  async getCapabilities(@Req() request: any) {
    const actor = await this.authService.authenticateRequest(request);
    return this.chatService.getCapabilities(actor);
  }
}
