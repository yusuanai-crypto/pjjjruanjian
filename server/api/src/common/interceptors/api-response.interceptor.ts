import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { map } from 'rxjs/operators';

@Injectable()
export class ApiResponseInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler) {
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
