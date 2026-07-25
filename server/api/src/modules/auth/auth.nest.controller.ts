import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
} from '@nestjs/common';

import { getRequestIp } from '../../common/request-ip';
import { AuthNestService } from './auth.nest.service';

@Controller('auth')
export class AuthNestController {
  constructor(private readonly authService: AuthNestService) {}

  @Post('login')
  @HttpCode(200)
  async login(@Body() body: unknown, @Req() request: any) {
    return this.authService.login(body, {
      ipAddress: getRequestIp(request),
    });
  }

  @Post('refresh')
  @HttpCode(200)
  async refresh(@Body() body: any, @Req() request: any) {
    return this.authService.refresh(body?.refreshToken, {
      ipAddress: getRequestIp(request),
    });
  }

  @Post('logout')
  @HttpCode(200)
  async logout(@Body() body: any, @Req() request: any) {
    await this.authService.logout(body?.refreshToken, {
      ipAddress: getRequestIp(request),
    });
    return { loggedOut: true };
  }

  @Get('me')
  async me(@Req() request: any) {
    const user = await this.authService.authenticateRequest(request);
    return this.authService.getSession(user);
  }

  @Post('change-password')
  @HttpCode(200)
  async changePassword(@Body() body: unknown, @Req() request: any) {
    const user = await this.authService.authenticateRequest(request);
    return this.authService.changePassword(user, body, {
      ipAddress: getRequestIp(request),
    });
  }

  @Get('roles')
  async roles(@Req() request: any) {
    await this.authService.authenticateRequest(request);
    return {
      roles: this.authService.getRoleCatalog(),
    };
  }
}
