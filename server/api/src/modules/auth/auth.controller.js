const { getRequestIp, readJsonBody, sendJson } = require('../../common/http');

function createAuthController(authService) {
  return async function authController(request, response) {
    const url = new URL(request.url, 'http://localhost');

    if (request.method === 'POST' && url.pathname === '/api/auth/login') {
      const body = await readJsonBody(request);
      sendJson(response, 200, {
        data: authService.login(body, { ipAddress: getRequestIp(request) }),
      });
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/auth/me') {
      const user = authService.authenticateRequest(request);
      sendJson(response, 200, {
        data: authService.getSession(user),
      });
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/auth/change-password') {
      const user = authService.authenticateRequest(request);
      const body = await readJsonBody(request);
      sendJson(response, 200, {
        data: authService.changePassword(user, body, { ipAddress: getRequestIp(request) }),
      });
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/auth/roles') {
      authService.authenticateRequest(request);
      sendJson(response, 200, {
        data: {
          roles: authService.getRoleCatalog(),
        },
      });
      return;
    }

    sendJson(response, 404, {
      error: {
        code: 'NOT_FOUND',
        message: 'Auth interface not found.',
      },
    });
  };
}

module.exports = {
  createAuthController,
};
