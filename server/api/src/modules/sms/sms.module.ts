import { Module } from '@nestjs/common';

import { AliyunSmsNestService } from './aliyun-sms.nest.service';

@Module({
  providers: [AliyunSmsNestService],
  exports: [AliyunSmsNestService],
})
export class SmsModule {}
