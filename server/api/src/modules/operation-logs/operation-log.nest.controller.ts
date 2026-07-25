import {
  Controller,
  Get,
  Param,
  Query,
  Req,
  Res,
} from '@nestjs/common';

import { AuthNestService } from '../auth/auth.nest.service';
import { AuditOperation } from './audit-operation.decorator';
import { OperationLogsNestService } from './operation-log.nest.service';

@Controller('operation-logs')
export class OperationLogNestController {
  constructor(
    private readonly authService: AuthNestService,
    private readonly operationLogsService: OperationLogsNestService,
  ) {}

  @Get()
  @AuditOperation({
    module: 'operation_logs',
    action: 'operation_logs.list',
    operationType: 'READ',
    entityType: 'operation_log',
  })
  async list(@Query() query: Record<string, string>, @Req() request: any) {
    await this.requireAuditReader(request);
    return this.operationLogsService.listLogs(query);
  }

  @Get('filter-options')
  @AuditOperation({
    module: 'operation_logs',
    action: 'operation_logs.filter_options',
    operationType: 'READ',
    entityType: 'operation_log',
  })
  async filterOptions(@Req() request: any) {
    await this.requireAuditReader(request);
    return this.operationLogsService.filterOptions();
  }

  @Get('export.xlsx')
  @AuditOperation({
    module: 'operation_logs',
    action: 'operation_logs.export',
    operationType: 'EXPORT',
    entityType: 'operation_log',
  })
  async export(
    @Query() query: Record<string, string>,
    @Req() request: any,
    @Res() response: any,
  ) {
    const actor = await this.requireAuditReader(request);
    const exported = await this.operationLogsService.exportExcel(query);
    await this.operationLogsService.appendLog({
      userId: actor.id,
      action: 'operation_logs.export',
      module: 'operation_logs',
      operationType: 'EXPORT',
      entityType: 'operation_log',
      result: 'SUCCESS',
      afterData: {
        exportedCount: exported.count,
        archived: String(query.archived || '').toLowerCase() === 'true',
      },
    });
    response.status(200);
    response.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    response.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(exported.fileName)}`,
    );
    response.setHeader('X-Export-Row-Count', String(exported.count));
    response.setHeader('Content-Length', String(exported.buffer.length));
    response.send(exported.buffer);
  }

  @Get(':id')
  @AuditOperation({
    module: 'operation_logs',
    action: 'operation_logs.read',
    operationType: 'READ',
    entityType: 'operation_log',
  })
  async detail(
    @Param('id') id: string,
    @Query('archived') archived: string | undefined,
    @Req() request: any,
  ) {
    await this.requireAuditReader(request);
    return this.operationLogsService.getLog(id, archived);
  }

  private async requireAuditReader(request: any) {
    const actor = await this.authService.authenticateRequest(request);
    this.authService.requireAdmin(actor);
    return actor;
  }
}
