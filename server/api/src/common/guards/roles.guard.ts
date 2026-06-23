import {
  CanActivate,
  ExecutionContext,
  Injectable,
} from '@nestjs/common';

@Injectable()
export class RolesGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const requiredRoles = request.requiredRoles;
    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }
    return requiredRoles.includes(request.currentUser?.role);
  }
}
