import { SetMetadata } from '@nestjs/common';

export const AUDIT_OPERATION_METADATA = 'jiangjiu:audit-operation';

export interface AuditOperationMetadata {
  action?: string;
  module?: string;
  operationType?: string;
  entityType?: string;
  exclude?: boolean;
}

export const AuditOperation = (metadata: AuditOperationMetadata) =>
  SetMetadata(AUDIT_OPERATION_METADATA, metadata);
