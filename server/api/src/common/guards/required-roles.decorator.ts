import { SetMetadata } from '@nestjs/common';

export const REQUIRED_ROLES_METADATA = 'required_roles';

export const RequireRoles = (...roles: string[]) =>
  SetMetadata(REQUIRED_ROLES_METADATA, roles);
