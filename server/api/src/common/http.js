const { createHttpError } = require('./errors');
const { getRequestIp } = require('./request-ip');

const MAX_BODY_BYTES = 1024 * 1024;

function sendJson(response, statusCode, body, headers = {}) {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    ...headers,
  });
  response.end(JSON.stringify(body));
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    let bodyBytes = 0;

    request.on('data', (chunk) => {
      bodyBytes += chunk.length;
      if (bodyBytes > MAX_BODY_BYTES) {
        reject(createHttpError(413, 'BODY_TOO_LARGE', 'Request body is too large.'));
        request.destroy();
        return;
      }
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
        reject(createHttpError(400, 'INVALID_JSON', 'Request body must be valid JSON.'));
      }
    });

    request.on('error', reject);
  });
}

function getBearerToken(request) {
  const header = request.headers.authorization || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

module.exports = {
  getBearerToken,
  getRequestIp,
  readJsonBody,
  sendJson,
};
