import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
} from '@nestjs/common';

import {
  GENERIC_SERVER_ERROR_MESSAGE,
  mapErrorToPublicResponse,
} from '../errors';
import {
  logSanitizedError,
  resolveCorrelationId,
  safeRequestPath,
} from '../logging/safe-logging';

interface ApiErrorLogger {
  error(message: string): unknown;
}

interface PublicErrorResponse {
  statusCode: number;
  code: string;
  message: string;
  retryAfterSeconds: number | null;
  includeRequestId: boolean;
  shouldLog: boolean;
  missingFields?: string[] | null;
}

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  constructor(private readonly logger: ApiErrorLogger = console) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const http = host.switchToHttp();
    const request = http.getRequest();
    const response = http.getResponse();
    const correlationId = resolveCorrelationId(request?.headers);
    const publicError = mapException(exception);

    if (request && typeof request === 'object') {
      request.correlationId = correlationId;
    }
    response.setHeader('X-Correlation-ID', correlationId);
    if (
      publicError.statusCode === 429 &&
      publicError.retryAfterSeconds !== null
    ) {
      response.setHeader(
        'Retry-After',
        String(publicError.retryAfterSeconds),
      );
    }

    if (publicError.shouldLog) {
      this.logError(exception, request, publicError, correlationId);
    }

    response.status(publicError.statusCode).json({
      error: {
        code: publicError.code,
        message: publicError.message,
        ...(publicError.missingFields
          ? { missingFields: publicError.missingFields }
          : {}),
      },
      ...(publicError.includeRequestId
        ? { requestId: correlationId }
        : {}),
    });
  }

  private logError(
    exception: unknown,
    request: any,
    publicError: PublicErrorResponse,
    correlationId: string,
  ) {
    try {
      logSanitizedError(this.logger, {
        event: 'api_request_failed',
        correlationId,
        statusCode: publicError.statusCode,
        errorCode: publicError.code,
        method: String(request?.method || ''),
        path: safeRequestPath(request),
        exception,
      });
    } catch (_loggingError) {
      // Error reporting must never replace the stable API error response.
    }
  }
}

function mapException(exception: unknown): PublicErrorResponse {
  if (!(exception instanceof HttpException)) {
    return mapErrorToPublicResponse(exception);
  }

  const statusCode = exception.getStatus();
  if (!Number.isInteger(statusCode) || statusCode < 400 || statusCode > 599) {
    return mapErrorToPublicResponse(exception);
  }
  if (statusCode >= 500) {
    return {
      statusCode,
      code: 'INTERNAL_ERROR',
      message: GENERIC_SERVER_ERROR_MESSAGE,
      retryAfterSeconds: null,
      includeRequestId: true,
      shouldLog: true,
    };
  }

  const safeMapping = FRAMEWORK_HTTP_ERROR_MAPPINGS[statusCode] || {
    code: 'REQUEST_FAILED',
    message: 'The request could not be processed.',
  };
  return {
    statusCode,
    code: safeMapping.code,
    message: safeMapping.message,
    retryAfterSeconds: null,
    includeRequestId: false,
    shouldLog: false,
  };
}

const FRAMEWORK_HTTP_ERROR_MAPPINGS: Record<
  number,
  { code: string; message: string }
> = {
  400: {
    code: 'BAD_REQUEST',
    message: 'The request is invalid.',
  },
  401: {
    code: 'UNAUTHORIZED',
    message: 'Authentication is required.',
  },
  403: {
    code: 'FORBIDDEN',
    message: 'Permission is denied.',
  },
  404: {
    code: 'NOT_FOUND',
    message: 'The requested resource does not exist.',
  },
  405: {
    code: 'METHOD_NOT_ALLOWED',
    message: 'The request method is not allowed.',
  },
  413: {
    code: 'FILE_TOO_LARGE',
    message: 'The request is too large.',
  },
  415: {
    code: 'UNSUPPORTED_MEDIA_TYPE',
    message: 'The request media type is not supported.',
  },
  422: {
    code: 'UNPROCESSABLE_ENTITY',
    message: 'The request could not be processed.',
  },
  429: {
    code: 'TOO_MANY_REQUESTS',
    message: 'Too many requests.',
  },
};
