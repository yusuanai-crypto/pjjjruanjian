import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';

import { getRequestIp } from '../../common/request-ip';
import { AuthNestService } from '../auth/auth.nest.service';
import { UsersNestService } from './users.nest.service';

@Controller('users')
export class UsersNestController {
  constructor(
    private readonly authService: AuthNestService,
    private readonly usersService: UsersNestService,
  ) {}

  @Get()
  async list(@Query() query: Record<string, string>, @Req() request: any) {
    const actor = await this.authService.authenticateRequest(request);
    return {
      users: await this.usersService.listUsers(actor, query),
    };
  }

  @Post()
  async create(@Body() body: unknown, @Req() request: any) {
    const actor = await this.authService.authenticateRequest(request);
    return this.usersService.createUser(actor, body, {
      ipAddress: getRequestIp(request),
    });
  }

  @Get('tasters')
  async listTasters(@Req() request: any) {
    const actor = await this.authService.authenticateRequest(request);
    return {
      tasters: await this.usersService.listTasters(actor),
    };
  }

  @Get('assignable')
  async listAssignable(@Query() query: Record<string, string>, @Req() request: any) {
    const actor = await this.authService.authenticateRequest(request);
    return {
      users: await this.usersService.listAssignableUsers(actor, query.role),
    };
  }

  @Get(':id')
  async get(@Param('id') id: string, @Req() request: any) {
    const actor = await this.authService.authenticateRequest(request);
    return {
      user: await this.usersService.getUser(actor, id),
    };
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() body: unknown, @Req() request: any) {
    const actor = await this.authService.authenticateRequest(request);
    return {
      user: await this.usersService.updateUser(actor, id, body, {
        ipAddress: getRequestIp(request),
      }),
    };
  }

  @Post(':id/disable')
  @HttpCode(200)
  async disable(@Param('id') id: string, @Body() body: any, @Req() request: any) {
    const actor = await this.authService.authenticateRequest(request);
    return {
      user: await this.usersService.setUserActive(actor, id, false, {
        reason: body?.reason,
        ipAddress: getRequestIp(request),
      }),
    };
  }

  @Post(':id/enable')
  @HttpCode(200)
  async enable(@Param('id') id: string, @Body() body: any, @Req() request: any) {
    const actor = await this.authService.authenticateRequest(request);
    return {
      user: await this.usersService.setUserActive(actor, id, true, {
        reason: body?.reason,
        ipAddress: getRequestIp(request),
      }),
    };
  }

  @Post(':id/reset-password-code')
  @HttpCode(200)
  async sendResetPasswordCode(@Param('id') id: string, @Req() request: any) {
    const actor = await this.authService.authenticateRequest(request);
    return {
      verification: await this.usersService.sendResetPasswordCode(actor, id, {
        ipAddress: getRequestIp(request),
      }),
    };
  }

  @Post(':id/reset-password')
  @HttpCode(200)
  async resetPassword(@Param('id') id: string, @Body() body: unknown, @Req() request: any) {
    const actor = await this.authService.authenticateRequest(request);
    return {
      user: await this.usersService.resetPassword(actor, id, body, {
        ipAddress: getRequestIp(request),
      }),
    };
  }

  @Post(':id/reset-password-to-default')
  @HttpCode(200)
  async resetPasswordToDefault(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() request: any,
  ) {
    const actor = await this.authService.authenticateRequest(request);
    return {
      user: await this.usersService.resetPasswordToDefault(actor, id, body, {
        ipAddress: getRequestIp(request),
      }),
    };
  }
}
