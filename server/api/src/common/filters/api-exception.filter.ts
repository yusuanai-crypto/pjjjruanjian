import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse();
    const statusCode = getStatusCode(exception);
    const code = getErrorCode(exception, statusCode);
    const message = getErrorMessage(exception);

    response.status(statusCode).json({
      error: {
        code,
        message,
      },
    });
  }
}

function getStatusCode(exception: unknown) {
  if (exception instanceof HttpException) {
    return exception.getStatus();
  }

  if (exception && typeof exception === 'object' && Number.isInteger((exception as any).statusCode)) {
    return (exception as any).statusCode;
  }

  return HttpStatus.INTERNAL_SERVER_ERROR;
}

function getErrorCode(exception: unknown, statusCode: number) {
  if (exception && typeof exception === 'object' && typeof (exception as any).code === 'string') {
    return (exception as any).code;
  }

  if (exception instanceof HttpException) {
    const response = exception.getResponse();
    if (response && typeof response === 'object' && typeof (response as any).code === 'string') {
      return (response as any).code;
    }
  }

  if (statusCode === HttpStatus.NOT_FOUND) {
    return 'NOT_FOUND';
  }

  return 'INTERNAL_ERROR';
}

function getErrorMessage(exception: unknown) {
  if (exception instanceof HttpException) {
    const response = exception.getResponse();
    if (response && typeof response === 'object' && typeof (response as any).message === 'string') {
      return (response as any).message;
    }
    if (typeof response === 'string') {
      return response;
    }
  }

  if (exception && typeof exception === 'object' && typeof (exception as any).message === 'string') {
    return (exception as any).message;
  }

  return 'Unexpected server error.';
}
