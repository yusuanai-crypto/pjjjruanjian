import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { SSE_METADATA } from '@nestjs/common/constants';
import { map } from 'rxjs/operators';

@Injectable()
export class ApiResponseInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler) {
    if (Reflect.getMetadata(SSE_METADATA, context.getHandler())) {
      return next.handle();
    }

    return next.handle().pipe(
      map((value) => {
        if (value && typeof value === 'object' && ('data' in value || 'error' in value)) {
          return value;
        }

        return {
          data: value ?? null,
        };
      }),
    );
  }
}
