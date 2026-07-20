const { getRequestIp, readJsonBody, sendJson } = require('../../common/http');

function createUsersController(authService, usersService, rateLimitService) {
  return async function usersController(request, response) {
    const url = new URL(request.url, 'http://localhost');
    const actor = authService.authenticateRequest(request);

    if (request.method === 'GET' && url.pathname === '/api/users') {
      sendJson(response, 200, {
        data: {
          users: usersService.listUsers(actor),
        },
      });
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/users') {
      const body = await readJsonBody(request);
      sendJson(response, 201, {
        data: usersService.createUser(actor, body, { ipAddress: getRequestIp(request) }),
      });
      return;
    }

    const userMatch = url.pathname.match(/^\/api\/users\/([a-zA-Z0-9_-]+)$/);
    if (request.method === 'GET' && userMatch) {
      sendJson(response, 200, {
        data: {
          user: usersService.getUser(actor, userMatch[1]),
        },
      });
      return;
    }

    if (request.method === 'PATCH' && userMatch) {
      const body = await readJsonBody(request);
      sendJson(response, 200, {
        data: {
          user: usersService.updateUser(actor, userMatch[1], body, { ipAddress: getRequestIp(request) }),
        },
      });
      return;
    }

    const disableMatch = url.pathname.match(/^\/api\/users\/([a-zA-Z0-9_-]+)\/disable$/);
    if (request.method === 'POST' && disableMatch) {
      sendJson(response, 200, {
        data: {
          user: usersService.setUserActive(actor, disableMatch[1], false, { ipAddress: getRequestIp(request) }),
        },
      });
      return;
    }

    const enableMatch = url.pathname.match(/^\/api\/users\/([a-zA-Z0-9_-]+)\/enable$/);
    if (request.method === 'POST' && enableMatch) {
      sendJson(response, 200, {
        data: {
          user: usersService.setUserActive(actor, enableMatch[1], true, { ipAddress: getRequestIp(request) }),
        },
      });
      return;
    }

    const resetPasswordMatch = url.pathname.match(/^\/api\/users\/([a-zA-Z0-9_-]+)\/reset-password$/);
    if (request.method === 'POST' && resetPasswordMatch) {
      const body = await readJsonBody(request);
      await rateLimitService.enforcePasswordReset({
        actorId: actor.id,
        targetUserId: resetPasswordMatch[1],
      });
      sendJson(response, 200, {
        data: {
          user: usersService.resetPassword(actor, resetPasswordMatch[1], body, { ipAddress: getRequestIp(request) }),
        },
      });
      return;
    }

    sendJson(response, 404, {
      error: {
        code: 'NOT_FOUND',
        message: 'Users interface not found.',
      },
    });
  };
}

module.exports = {
  createUsersController,
};
