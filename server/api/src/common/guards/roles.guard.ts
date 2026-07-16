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
    const role = request.currentUser?.role;
    return requiredRoles.includes(role) || (role === 'super_admin' && requiredRoles.includes('admin'));
  }
}
