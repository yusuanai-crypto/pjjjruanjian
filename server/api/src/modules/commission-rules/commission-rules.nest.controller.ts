import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';

import { getRequestIp } from '../../common/request-ip';
import { AuthNestService } from '../auth/auth.nest.service';
import { CommissionRulesNestService } from './commission-rules.nest.service';

@Controller('commission-rules')
export class CommissionRulesNestController {
  constructor(
    private readonly authService: AuthNestService,
    private readonly rulesService: CommissionRulesNestService,
  ) {}

  @Get()
  async list(@Query() query: any, @Req() request: any) {
    const actor = await this.authService.authenticateRequest(request);
    return {
      commissionRules: await this.rulesService.listCommissionRules(
        actor,
        query,
      ),
    };
  }

  @Post()
  async create(@Body() body: unknown, @Req() request: any) {
    const actor = await this.authService.authenticateRequest(request);
    const result = await this.rulesService.createCommissionRule(actor, body, {
      ipAddress: getRequestIp(request),
    });
    return buildRuleMutationResponse('commissionRule', result);
  }

  @Patch()
  async updateFromBody(@Body() body: any, @Req() request: any) {
    const actor = await this.authService.authenticateRequest(request);
    const result = await this.rulesService.updateCommissionRule(
      actor,
      body?.id,
      stripId(body),
      { ipAddress: getRequestIp(request) },
    );
    return buildRuleMutationResponse('commissionRule', result);
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() request: any,
  ) {
    const actor = await this.authService.authenticateRequest(request);
    const result = await this.rulesService.updateCommissionRule(
      actor,
      id,
      body,
      { ipAddress: getRequestIp(request) },
    );
    return buildRuleMutationResponse('commissionRule', result);
  }
}

@Controller('sales-deduction-rules')
export class SalesDeductionRulesNestController {
  constructor(
    private readonly authService: AuthNestService,
    private readonly rulesService: CommissionRulesNestService,
  ) {}

  @Get()
  async list(@Query() query: any, @Req() request: any) {
    const actor = await this.authService.authenticateRequest(request);
    return {
      salesDeductionRules:
        await this.rulesService.listSalesDeductionRules(actor, query),
    };
  }

  @Post()
  async create(@Body() body: unknown, @Req() request: any) {
    const actor = await this.authService.authenticateRequest(request);
    return {
      salesDeductionRule:
        await this.rulesService.createSalesDeductionRule(actor, body, {
          ipAddress: getRequestIp(request),
        }),
    };
  }

  @Post('batch-import')
  async batchImport(@Body() body: unknown, @Req() request: any) {
    const actor = await this.authService.authenticateRequest(request);
    return {
      importResult: await this.rulesService.batchImportSalesDeductionRules(
        actor,
        body,
        {
          ipAddress: getRequestIp(request),
        },
      ),
    };
  }

  @Patch()
  async updateFromBody(@Body() body: any, @Req() request: any) {
    const actor = await this.authService.authenticateRequest(request);
    return {
      salesDeductionRule:
        await this.rulesService.updateSalesDeductionRule(
          actor,
          body?.id,
          stripId(body),
          {
            ipAddress: getRequestIp(request),
          },
        ),
    };
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() request: any,
  ) {
    const actor = await this.authService.authenticateRequest(request);
    return {
      salesDeductionRule:
        await this.rulesService.updateSalesDeductionRule(actor, id, body, {
          ipAddress: getRequestIp(request),
        }),
    };
  }
}

@Controller('agency-deduction-rules')
export class AgencyDeductionRulesNestController {
  constructor(
    private readonly authService: AuthNestService,
    private readonly rulesService: CommissionRulesNestService,
  ) {}

  @Get()
  async list(@Query() query: any, @Req() request: any) {
    const actor = await this.authService.authenticateRequest(request);
    return {
      agencyDeductionRules:
        await this.rulesService.listAgencyDeductionRules(actor, query),
    };
  }

  @Post()
  async create(@Body() body: unknown, @Req() request: any) {
    const actor = await this.authService.authenticateRequest(request);
    const result = await this.rulesService.createAgencyDeductionRule(
      actor,
      body,
      {
        ipAddress: getRequestIp(request),
      },
    );
    return buildRuleMutationResponse('agencyDeductionRule', result);
  }

  @Post('batch-import')
  async batchImport(@Body() body: unknown, @Req() request: any) {
    const actor = await this.authService.authenticateRequest(request);
    const result =
      await this.rulesService.batchImportAgencyDeductionRules(
        actor,
        body,
        {
          ipAddress: getRequestIp(request),
        },
      );
    return buildRuleImportResponse(result);
  }

  @Patch()
  async updateFromBody(@Body() body: any, @Req() request: any) {
    const actor = await this.authService.authenticateRequest(request);
    const result = await this.rulesService.updateAgencyDeductionRule(
      actor,
      body?.id,
      stripId(body),
      {
        ipAddress: getRequestIp(request),
      },
    );
    return buildRuleMutationResponse('agencyDeductionRule', result);
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() request: any,
  ) {
    const actor = await this.authService.authenticateRequest(request);
    const result = await this.rulesService.updateAgencyDeductionRule(
      actor,
      id,
      body,
      {
        ipAddress: getRequestIp(request),
      },
    );
    return buildRuleMutationResponse('agencyDeductionRule', result);
  }
}

@Controller('agency-rebate-rules')
export class AgencyRebateRulesNestController {
  constructor(
    private readonly authService: AuthNestService,
    private readonly rulesService: CommissionRulesNestService,
  ) {}

  @Get()
  async list(@Query() query: any, @Req() request: any) {
    const actor = await this.authService.authenticateRequest(request);
    return {
      agencyRebateRules: await this.rulesService.listAgencyRebateRules(
        actor,
        query,
      ),
    };
  }

  @Post()
  async create(@Body() body: unknown, @Req() request: any) {
    const actor = await this.authService.authenticateRequest(request);
    const result = await this.rulesService.createAgencyRebateRule(
      actor,
      body,
      {
        ipAddress: getRequestIp(request),
      },
    );
    return buildRuleMutationResponse('agencyRebateRule', result);
  }

  @Post('batch-import')
  async batchImport(@Body() body: unknown, @Req() request: any) {
    const actor = await this.authService.authenticateRequest(request);
    const result = await this.rulesService.batchImportAgencyRebateRules(
      actor,
      body,
      {
        ipAddress: getRequestIp(request),
      },
    );
    return buildRuleImportResponse(result);
  }

  @Patch()
  async updateFromBody(@Body() body: any, @Req() request: any) {
    const actor = await this.authService.authenticateRequest(request);
    const result = await this.rulesService.updateAgencyRebateRule(
      actor,
      body?.id,
      stripId(body),
      {
        ipAddress: getRequestIp(request),
      },
    );
    return buildRuleMutationResponse('agencyRebateRule', result);
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() request: any,
  ) {
    const actor = await this.authService.authenticateRequest(request);
    const result = await this.rulesService.updateAgencyRebateRule(
      actor,
      id,
      body,
      {
        ipAddress: getRequestIp(request),
      },
    );
    return buildRuleMutationResponse('agencyRebateRule', result);
  }
}

function stripId(body: any) {
  const payload = { ...(body || {}) };
  delete payload.id;
  return payload;
}

function buildRuleMutationResponse(key: string, result: any) {
  const rule = { ...(result || {}) };
  const recalculation = rule.recalculation || null;
  delete rule.recalculation;
  return {
    [key]: rule,
    recalculation,
  };
}

function buildRuleImportResponse(result: any) {
  const importResult = { ...(result || {}) };
  const recalculation = importResult.recalculation || null;
  delete importResult.recalculation;
  return {
    importResult,
    recalculation,
  };
}
