import { Injectable } from '@nestjs/common';
import * as crypto from 'node:crypto';

import { createHttpError } from '../../common/errors';

@Injectable()
export class AliyunSmsNestService {
  async sendVerificationCode(phone: string, code: string) {
    if (process.env.ALIYUN_SMS_MOCK === 'true') {
      return {
        provider: 'mock',
        providerRef: `mock-${Date.now()}`,
      };
    }

    const accessKeyId = requiredEnv('ALIYUN_SMS_ACCESS_KEY_ID');
    const accessKeySecret = requiredEnv('ALIYUN_SMS_ACCESS_KEY_SECRET');
    const signName = requiredEnv('ALIYUN_SMS_SIGN_NAME');
    const templateCode = requiredEnv('ALIYUN_SMS_TEMPLATE_CODE');
    const host = process.env.ALIYUN_SMS_ENDPOINT || 'dysmsapi.aliyuncs.com';
    const templateParamName = process.env.ALIYUN_SMS_TEMPLATE_PARAM_NAME || 'code';
    const query = {
      PhoneNumbers: phone,
      SignName: signName,
      TemplateCode: templateCode,
      TemplateParam: JSON.stringify({ [templateParamName]: code }),
    };

    const response = await callAliyunRpc({
      accessKeyId,
      accessKeySecret,
      host,
      action: 'SendSms',
      version: '2017-05-25',
      query,
    });

    if (response.Code !== 'OK') {
      throw createHttpError(
        502,
        'SMS_SEND_FAILED',
        String(response.Message || response.Code || 'Failed to send SMS verification code.'),
      );
    }

    return {
      provider: 'aliyun',
      providerRef: response.BizId || response.RequestId || null,
    };
  }
}

async function callAliyunRpc(options: {
  accessKeyId: string;
  accessKeySecret: string;
  host: string;
  action: string;
  version: string;
  query: Record<string, string>;
}) {
  const method = 'POST';
  const body = '';
  const hashedPayload = sha256Hex(body);
  const date = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  const nonce = crypto.randomUUID().replace(/-/g, '');
  const headers: Record<string, string> = {
    host: options.host,
    'x-acs-action': options.action,
    'x-acs-content-sha256': hashedPayload,
    'x-acs-date': date,
    'x-acs-signature-nonce': nonce,
    'x-acs-version': options.version,
  };
  const canonicalQuery = canonicalizeQuery(options.query);
  const signedHeaders = Object.keys(headers).sort().join(';');
  const canonicalHeaders = Object.keys(headers)
    .sort()
    .map((key) => `${key}:${headers[key].trim()}\n`)
    .join('');
  const canonicalRequest = [
    method,
    '/',
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    hashedPayload,
  ].join('\n');
  const stringToSign = `ACS3-HMAC-SHA256\n${sha256Hex(canonicalRequest)}`;
  const signature = crypto
    .createHmac('sha256', options.accessKeySecret)
    .update(stringToSign, 'utf8')
    .digest('hex');
  const authorization =
    `ACS3-HMAC-SHA256 Credential=${options.accessKeyId},` +
    `SignedHeaders=${signedHeaders},Signature=${signature}`;

  const response = await fetch(`https://${options.host}/?${canonicalQuery}`, {
    method,
    headers: {
      ...headers,
      Authorization: authorization,
      Accept: 'application/json',
    },
  });
  const text = await response.text();
  let payload: any = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch (_) {
    payload = { Message: text };
  }

  if (!response.ok) {
    throw createHttpError(
      502,
      'SMS_SEND_FAILED',
      String(payload.Message || payload.Code || `Aliyun SMS HTTP ${response.status}`),
    );
  }
  return payload;
}

function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value) {
    throw createHttpError(500, 'SMS_NOT_CONFIGURED', `${name} is required.`);
  }
  return value;
}

function canonicalizeQuery(query: Record<string, string>) {
  return Object.keys(query)
    .sort()
    .map((key) => `${percentEncode(key)}=${percentEncode(query[key])}`)
    .join('&');
}

function percentEncode(value: string) {
  return encodeURIComponent(value)
    .replace(/[!*'()]/g, (character) =>
      `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
    )
    .replace(/%7E/g, '~');
}

function sha256Hex(value: string) {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}
