const { sendJson } = require('../../common/http');

function createOperationLogController(authService, operationLogRepository) {
  return async function operationLogController(request, response) {
    const url = new URL(request.url, 'http://localhost');
    const actor = authService.authenticateRequest(request);
    authService.requireAdmin(actor);

    if (request.method === 'GET' && url.pathname === '/api/operation-logs') {
      sendJson(response, 200, {
        data: {
          logs: operationLogRepository.listLogs({
            action: url.searchParams.get('action') || undefined,
            entityType: url.searchParams.get('entityType') || undefined,
            userId: url.searchParams.get('userId') || undefined,
          }),
        },
      });
      return;
    }

    sendJson(response, 404, {
      error: {
        code: 'NOT_FOUND',
        message: 'Operation log interface not found.',
      },
    });
  };
}

module.exports = {
  createOperationLogController,
};
