const { getRequestIp, sendJson } = require('../../common/http');

function createSettingsController(authService, settingsService) {
  return async function settingsController(request, response) {
    const url = new URL(request.url, 'http://localhost');
    const actor = authService.authenticateRequest(request);

    if (request.method === 'GET' && url.pathname === '/api/settings/global-mark-query') {
      sendJson(response, 200, {
        data: {
          settings: settingsService.getGlobalMarkQuery(actor),
        },
      });
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/settings/global-mark-query/enable') {
      sendJson(response, 200, {
        data: {
          settings: settingsService.enableGlobalMarkQuery(actor, { ipAddress: getRequestIp(request) }),
        },
      });
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/settings/global-mark-query/restore') {
      sendJson(response, 200, {
        data: {
          settings: settingsService.restoreGlobalMarkQuery(actor, { ipAddress: getRequestIp(request) }),
        },
      });
      return;
    }

    sendJson(response, 404, {
      error: {
        code: 'NOT_FOUND',
        message: 'Settings interface not found.',
      },
    });
  };
}

module.exports = {
  createSettingsController,
};
