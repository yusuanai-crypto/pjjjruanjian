const { createHttpError } = require('./errors');

const MAX_BODY_BYTES = 1024 * 1024;

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
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

function getRequestIp(request) {
  const forwardedFor = request.headers['x-forwarded-for'];
  if (typeof forwardedFor === 'string' && forwardedFor.trim()) {
    return forwardedFor.split(',')[0].trim();
  }
  return request.socket?.remoteAddress || null;
}

module.exports = {
  getBearerToken,
  getRequestIp,
  readJsonBody,
  sendJson,
};
