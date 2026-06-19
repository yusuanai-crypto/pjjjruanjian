const {
  createPreparationConfirmationController,
} = require('./modules/preparation-confirmation/preparation-confirmation.controller');
const {
  createPreparationConfirmationService,
} = require('./modules/preparation-confirmation/preparation-confirmation.service');

function createApp(options = {}) {
  const service =
    options.preparationConfirmationService ||
    createPreparationConfirmationService(options.preparationConfirmationRepository);
  const preparationConfirmationController = createPreparationConfirmationController(service);

  return async function app(request, response) {
    try {
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
      const statusCode = error.statusCode || 500;
      sendJson(response, statusCode, {
        error: {
          code: error.code || 'INTERNAL_ERROR',
          message: error.message || 'Unexpected server error.',
        },
      });
    }
  };
}

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
  });
  response.end(JSON.stringify(body));
}

module.exports = {
  createApp,
};
