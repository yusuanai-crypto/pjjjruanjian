const net = require('node:net');

function getRequestIp(request, env = process.env) {
  const remoteAddress = normalizeIpAddress(request.socket?.remoteAddress);
  if (!remoteAddress) {
    return null;
  }

  const trustedProxyIps = parseTrustedProxyIps(env.TRUSTED_PROXY_IPS);
  if (!trustedProxyIps.has(remoteAddress)) {
    return remoteAddress;
  }

  const forwardedChain = parseForwardedFor(
    request.headers?.['x-forwarded-for'],
  );
  let clientAddress = remoteAddress;
  for (let index = forwardedChain.length - 1; index >= 0; index -= 1) {
    if (!trustedProxyIps.has(clientAddress)) {
      break;
    }
    clientAddress = forwardedChain[index];
  }
  return clientAddress;
}

function parseTrustedProxyIps(value) {
  const addresses = new Set();
  for (const item of String(value || '').split(',')) {
    const address = normalizeIpAddress(item);
    if (address) {
      addresses.add(address);
    }
  }
  return addresses;
}

function parseForwardedFor(value) {
  const header = Array.isArray(value) ? value.join(',') : value;
  if (typeof header !== 'string') {
    return [];
  }
  return header
    .split(',')
    .map(normalizeIpAddress)
    .filter(Boolean);
}

function normalizeIpAddress(value) {
  if (typeof value !== 'string') {
    return null;
  }
  let address = value.trim();
  if (!address) {
    return null;
  }
  const zoneIndex = address.indexOf('%');
  if (zoneIndex >= 0) {
    address = address.slice(0, zoneIndex);
  }
  const mappedIpv4 = address.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i);
  if (mappedIpv4 && net.isIP(mappedIpv4[1]) === 4) {
    return mappedIpv4[1];
  }
  return net.isIP(address) ? address.toLowerCase() : null;
}

module.exports = {
  getRequestIp,
  normalizeIpAddress,
  parseTrustedProxyIps,
};
