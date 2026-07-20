const {
  createPreparationConfirmationController,
} = require('./modules/preparation-confirmation/preparation-confirmation.controller');
const {
  createPreparationConfirmationService,
} = require('./modules/preparation-confirmation/preparation-confirmation.service');
const { sendJson } = require('./common/http');
const { mapErrorToPublicResponse } = require('./common/errors');
const {
  logSanitizedError,
  resolveCorrelationId,
  safeRequestPath,
} = require('./common/logging/safe-logging');
const {
  createLegacyRateLimitService,
} = require('./common/rate-limit/rate-limit');
const { createAuthController } = require('./modules/auth/auth.controller');
const { createAuthService } = require('./modules/auth/auth.service');
const { createOperationLogController } = require('./modules/operation-logs/operation-log.controller');
const { createOperationLogRepository } = require('./modules/operation-logs/operation-log.repository');
const { createSettingsController } = require('./modules/settings/settings.controller');
const { createSettingsService } = require('./modules/settings/settings.service');
const { createSystemSettingsRepository } = require('./modules/settings/settings.repository');
const { createUserRepository } = require('./modules/users/users.repository');
const { createUsersController } = require('./modules/users/users.controller');
const { createUsersService } = require('./modules/users/users.service');

function createApp(options = {}) {
  const rateLimitService =
    options.rateLimitService || createLegacyRateLimitService();
  const userRepository = options.userRepository || createUserRepository(options.userStorePath);
  const operationLogRepository =
    options.operationLogRepository || createOperationLogRepository(options.operationLogStorePath);
  const settingsRepository = options.settingsRepository || createSystemSettingsRepository(options.settingsStorePath);
  const authService =
    options.authService ||
    createAuthService({
      userRepository,
      operationLogRepository,
      rateLimitService,
      tokenSecret: options.tokenSecret,
      tokenExpiresInSeconds: options.tokenExpiresInSeconds,
    });
  const usersService =
    options.usersService ||
    createUsersService({
      userRepository,
      operationLogRepository,
    });
  const settingsService =
    options.settingsService ||
    createSettingsService({
      settingsRepository,
      operationLogRepository,
    });
  const authController = createAuthController(authService);
  const usersController = createUsersController(
    authService,
    usersService,
    rateLimitService,
  );
  const settingsController = createSettingsController(authService, settingsService);
  const operationLogController = createOperationLogController(authService, operationLogRepository);
  const service =
    options.preparationConfirmationService ||
    createPreparationConfirmationService(options.preparationConfirmationRepository);
  const preparationConfirmationController = createPreparationConfirmationController(
    authService,
    service,
  );

  return async function app(request, response) {
    try {
      if (request.url.startsWith('/api/auth')) {
        await authController(request, response);
        return;
      }

      if (request.url.startsWith('/api/users')) {
        await usersController(request, response);
        return;
      }

      if (request.url.startsWith('/api/settings')) {
        await settingsController(request, response);
        return;
      }

      if (request.url.startsWith('/api/operation-logs')) {
        await operationLogController(request, response);
        return;
      }

      if (request.url.startsWith('/api/preparation-confirmation')) {
        await preparationConfirmationController(request, response);
        return;
      }

      sendJson(response, 404, {
        error: {
          code: 'NOT_FOUND',
          message: 'Interface not found.',
        },
      });
    } catch (error) {
      const publicError = mapErrorToPublicResponse(error);
      const correlationId = resolveCorrelationId(request.headers);
      if (publicError.shouldLog) {
        try {
          logSanitizedError(options.logger, {
            event: 'legacy_api_request_failed',
            correlationId,
            statusCode: publicError.statusCode,
            errorCode: publicError.code,
            method: String(request.method || ''),
            path: safeRequestPath(request),
            exception: error,
          });
        } catch (_loggingError) {
          // Error reporting must never replace the stable API error response.
        }
      }
      sendJson(
        response,
        publicError.statusCode,
        {
          error: {
            code: publicError.code,
            message: publicError.message,
          },
          ...(publicError.includeRequestId
            ? { requestId: correlationId }
            : {}),
        },
        {
          'X-Correlation-ID': correlationId,
          ...(publicError.statusCode === 429 &&
          publicError.retryAfterSeconds !== null
            ? {
                'Retry-After': String(publicError.retryAfterSeconds),
              }
            : {}),
        },
      );
    }
  };
}

module.exports = {
  createApp,
};
