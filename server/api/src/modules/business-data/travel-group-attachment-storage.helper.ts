import * as crypto from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { createHttpError } from '../../common/errors';

export const TRAVEL_GROUP_ATTACHMENT_CATEGORIES = [
  'key_customer_photo',
  'guest_info',
] as const;

export type TravelGroupAttachmentCategory =
  (typeof TRAVEL_GROUP_ATTACHMENT_CATEGORIES)[number];

export const TRAVEL_GROUP_ATTACHMENT_MAX_FILE_SIZE = 20 * 1024 * 1024;
export const TRAVEL_GROUP_ATTACHMENT_MAX_FILES_PER_REQUEST = 20;

const STORAGE_KEY_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const ALLOWED_FILE_TYPES = new Map<string, Set<string>>([
  ['image/jpeg', new Set(['.jpg', '.jpeg'])],
  ['image/png', new Set(['.png'])],
  ['image/gif', new Set(['.gif'])],
  ['image/webp', new Set(['.webp'])],
  ['image/bmp', new Set(['.bmp'])],
  ['image/tiff', new Set(['.tif', '.tiff'])],
  ['image/avif', new Set(['.avif'])],
  ['application/pdf', new Set(['.pdf'])],
  ['application/msword', new Set(['.doc'])],
  [
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    new Set(['.docx']),
  ],
  ['application/vnd.ms-excel', new Set(['.xls', '.csv'])],
  [
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    new Set(['.xlsx']),
  ],
  ['text/csv', new Set(['.csv'])],
  ['application/csv', new Set(['.csv'])],
  ['text/plain', new Set(['.txt', '.log', '.md'])],
  ['text/markdown', new Set(['.md'])],
]);

export function normalizeTravelGroupAttachmentCategory(
  value: unknown,
): TravelGroupAttachmentCategory {
  const normalized = String(value || '').trim();
  if (
    !TRAVEL_GROUP_ATTACHMENT_CATEGORIES.includes(
      normalized as TravelGroupAttachmentCategory,
    )
  ) {
    throw createHttpError(
      400,
      'INVALID_ATTACHMENT_CATEGORY',
      'Attachment category must be key_customer_photo or guest_info.',
    );
  }
  return normalized as TravelGroupAttachmentCategory;
}

export function validateTravelGroupAttachmentFile(file: any) {
  if (!file || !Buffer.isBuffer(file.buffer)) {
    throw createHttpError(
      400,
      'ATTACHMENT_FILE_REQUIRED',
      'At least one attachment file is required.',
    );
  }
  const size = Number(file.size ?? file.buffer.length);
  if (!Number.isFinite(size) || size < 0) {
    throw createHttpError(
      400,
      'INVALID_ATTACHMENT_FILE',
      'Attachment file size is invalid.',
    );
  }
  if (size > TRAVEL_GROUP_ATTACHMENT_MAX_FILE_SIZE) {
    throw createHttpError(
      413,
      'FILE_TOO_LARGE',
      'Each attachment file must not exceed 20MB.',
    );
  }

  const originalName = sanitizeAttachmentOriginalName(file.originalname);
  const contentType = normalizeContentType(file.mimetype);
  const allowedExtensions = ALLOWED_FILE_TYPES.get(contentType);
  const extension = path.extname(originalName).toLowerCase();
  if (!allowedExtensions || !allowedExtensions.has(extension)) {
    throw createHttpError(
      400,
      'UNSUPPORTED_ATTACHMENT_TYPE',
      'Attachment file type is not supported.',
    );
  }

  return {
    buffer: file.buffer as Buffer,
    originalName,
    contentType,
    size,
  };
}

export function sanitizeAttachmentOriginalName(value: unknown) {
  const normalized = String(value || '')
    .replace(/\\/g, '/')
    .split('/')
    .pop()
    ?.replace(/[\u0000-\u001f\u007f]/g, '')
    .trim();
  const fileName = normalized || 'attachment';
  return fileName.slice(0, 255);
}

export function createAttachmentStorageKey() {
  return crypto.randomUUID();
}

export function isSafeAttachmentStorageKey(value: unknown) {
  return STORAGE_KEY_PATTERN.test(String(value || ''));
}

export function getTravelGroupAttachmentStorageRoot() {
  const configured = String(
    process.env.TRAVEL_GROUP_ATTACHMENT_DIR || '',
  ).trim();
  return configured
    ? path.resolve(configured)
    : path.resolve(__dirname, '../../../.private/travel-group-attachments');
}

export async function writeTravelGroupAttachmentFile(
  storageKey: string,
  buffer: Buffer,
) {
  const filePath = resolveAttachmentFilePath(storageKey);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, buffer, { flag: 'wx' });
}

export async function readTravelGroupAttachmentFile(storageKey: string) {
  return fs.readFile(resolveAttachmentFilePath(storageKey));
}

export async function removeTravelGroupAttachmentFile(storageKey: string) {
  try {
    await fs.unlink(resolveAttachmentFilePath(storageKey));
  } catch (error) {
    if ((error as any)?.code !== 'ENOENT') {
      throw error;
    }
  }
}

export async function stageTravelGroupAttachmentDeletion(
  storageKey: string,
) {
  const sourcePath = resolveAttachmentFilePath(storageKey);
  const stagedPath = path.join(
    getTravelGroupAttachmentStorageRoot(),
    `.deleting-${crypto.randomUUID()}`,
  );
  try {
    await fs.rename(sourcePath, stagedPath);
    return { sourcePath, stagedPath };
  } catch (error) {
    if ((error as any)?.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

export async function restoreStagedTravelGroupAttachmentDeletion(
  staged: { sourcePath: string; stagedPath: string } | null,
) {
  if (!staged) {
    return;
  }
  await fs.rename(staged.stagedPath, staged.sourcePath);
}

export async function finalizeStagedTravelGroupAttachmentDeletion(
  staged: { sourcePath: string; stagedPath: string } | null,
) {
  if (!staged) {
    return;
  }
  try {
    await fs.unlink(staged.stagedPath);
  } catch (error) {
    if ((error as any)?.code !== 'ENOENT') {
      throw error;
    }
  }
}

export function buildAttachmentContentDisposition(originalName: unknown) {
  const safeName = sanitizeAttachmentOriginalName(originalName);
  return `attachment; filename="attachment"; filename*=UTF-8''${encodeURIComponent(
    safeName,
  )}`;
}

function resolveAttachmentFilePath(storageKey: string) {
  if (!isSafeAttachmentStorageKey(storageKey)) {
    throw createHttpError(
      404,
      'ATTACHMENT_NOT_FOUND',
      'Attachment does not exist.',
    );
  }
  const root = getTravelGroupAttachmentStorageRoot();
  const filePath = path.resolve(root, storageKey);
  if (path.dirname(filePath) !== root) {
    throw createHttpError(
      404,
      'ATTACHMENT_NOT_FOUND',
      'Attachment does not exist.',
    );
  }
  return filePath;
}

function normalizeContentType(value: unknown) {
  return String(value || '')
    .split(';', 1)[0]
    .trim()
    .toLowerCase();
}
