import {
  ArgumentMetadata,
  Injectable,
  PipeTransform,
} from '@nestjs/common';

@Injectable()
export class RequestValidationPipe implements PipeTransform {
  transform(value: unknown, _metadata: ArgumentMetadata) {
    return value;
  }
}
