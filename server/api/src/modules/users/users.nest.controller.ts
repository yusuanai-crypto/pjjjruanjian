import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
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
  async list(@Req() request: any) {
    const actor = await this.authService.authenticateRequest(request);
    return {
      users: await this.usersService.listUsers(actor),
    };
  }

  @Post()
  async create(@Body() body: unknown, @Req() request: any) {
    const actor = await this.authService.authenticateRequest(request);
    return this.usersService.createUser(actor, body, {
      ipAddress: getRequestIp(request),
    });
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
  async disable(@Param('id') id: string, @Req() request: any) {
    const actor = await this.authService.authenticateRequest(request);
    return {
      user: await this.usersService.setUserActive(actor, id, false, {
        ipAddress: getRequestIp(request),
      }),
    };
  }

  @Post(':id/enable')
  @HttpCode(200)
  async enable(@Param('id') id: string, @Req() request: any) {
    const actor = await this.authService.authenticateRequest(request);
    return {
      user: await this.usersService.setUserActive(actor, id, true, {
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
}
