function createPreparationConfirmationController(service) {
  return async function preparationConfirmationController(request, response) {
    const url = new URL(request.url, 'http://localhost');

    if (request.method === 'GET' && url.pathname === '/api/preparation-confirmation/items') {
      const items = service.listItems({
        status: url.searchParams.get('status') || undefined,
        category: url.searchParams.get('category') || undefined,
      });
      sendJson(response, 200, {
        data: {
          items,
        },
      });
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/preparation-confirmation/summary') {
      sendJson(response, 200, {
        data: service.getSummary(),
      });
      return;
    }

    const itemMatch = url.pathname.match(/^\/api\/preparation-confirmation\/items\/([a-z0-9-]+)$/);
    if (request.method === 'PUT' && itemMatch) {
      const body = await readJsonBody(request);
      const item = service.updateItem(itemMatch[1], body);
      sendJson(response, 200, {
        data: {
          item,
        },
      });
      return;
    }

    sendJson(response, 404, {
      error: {
        code: 'NOT_FOUND',
        message: 'Preparation confirmation interface not found.',
      },
    });
  };
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    request.on('data', (chunk) => {
      body += chunk;
    });
    request.on('end', () => {
      if (!body.trim()) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(body));
      } catch (error) {
        const parseError = new Error('Request body must be valid JSON.');
        parseError.statusCode = 400;
        parseError.code = 'INVALID_JSON';
        reject(parseError);
      }
    });
    request.on('error', reject);
  });
}

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
  });
  response.end(JSON.stringify(body));
}

module.exports = {
  createPreparationConfirmationController,
};
