import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';

import { getRequestIp } from '../../common/request-ip';
import { AuthNestService } from '../auth/auth.nest.service';
import { SerializedInventoryNestService } from './serialized-inventory.nest.service';

const DOCX_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

@Controller('serialized-inventory')
export class SerializedInventoryNestController {
  constructor(
    private readonly authService: AuthNestService,
    private readonly serializedInventoryService: SerializedInventoryNestService,
  ) {}

  @Get()
  async list(@Query() query: any, @Req() request: any) {
    const actor = await this.authService.authenticateRequest(request);
    return await this.serializedInventoryService.list(actor, query);
  }

  @Get('available')
  async listAvailable(@Query() query: any, @Req() request: any) {
    const actor = await this.authService.authenticateRequest(request);
    return await this.serializedInventoryService.listAvailable(actor, query);
  }

  @Post('batch')
  async createMany(@Body() body: any, @Req() request: any) {
    const actor = await this.authService.authenticateRequest(request);
    return await this.serializedInventoryService.createMany(actor, body, {
      ipAddress: getRequestIp(request),
    });
  }

  @Post('export-moutai-logistics-docx')
  async exportMoutaiLogisticsDocx(
    @Body() body: any,
    @Req() request: any,
    @Res() response: any,
  ) {
    const actor = await this.authService.authenticateRequest(request);
    const result =
      await this.serializedInventoryService.exportMoutaiLogisticsDocx(
        actor,
        body,
        {
          ipAddress: getRequestIp(request),
        },
      );
    const fallbackName = `moutai-logistics-${Date.now()}.docx`;
    response.status(200);
    response.type(DOCX_CONTENT_TYPE);
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="${fallbackName}"; filename*=UTF-8''${encodeURIComponent(
        result.fileName,
      )}`,
    );
    response.setHeader('Content-Length', result.buffer.length);
    response.send(result.buffer);
  }

  @Get(':id')
  async get(@Param('id') id: string, @Req() request: any) {
    const actor = await this.authService.authenticateRequest(request);
    return {
      unit: await this.serializedInventoryService.get(actor, id),
    };
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() body: any,
    @Req() request: any,
  ) {
    const actor = await this.authService.authenticateRequest(request);
    return {
      unit: await this.serializedInventoryService.update(actor, id, body, {
        ipAddress: getRequestIp(request),
      }),
    };
  }

  @Patch(':id/correction')
  async correct(
    @Param('id') id: string,
    @Body() body: any,
    @Req() request: any,
  ) {
    const actor = await this.authService.authenticateRequest(request);
    return {
      unit: await this.serializedInventoryService.correct(actor, id, body, {
        ipAddress: getRequestIp(request),
      }),
    };
  }
}
