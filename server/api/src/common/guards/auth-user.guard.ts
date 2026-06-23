import {
  CanActivate,
  ExecutionContext,
  Injectable,
} from '@nestjs/common';

import { AuthNestService } from '../../modules/auth/auth.nest.service';

@Injectable()
export class AuthUserGuard implements CanActivate {
  constructor(private readonly authService: AuthNestService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    request.currentUser = await this.authService.authenticateRequest(request);
    return true;
  }
}
