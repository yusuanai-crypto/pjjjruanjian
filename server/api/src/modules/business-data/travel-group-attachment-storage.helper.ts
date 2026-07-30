import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  OnModuleInit,
} from '@nestjs/common';
import { AnyFilesInterceptor } from '@nestjs/platform-express';
import * as crypto from 'node:crypto';
import * as fsSync from 'node:fs';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { catchError, throwError } from 'rxjs';

import { createHttpError } from '../../common/errors';
import {
  FILE_SECURITY_MAX_FILE_BYTES,
  FILE_SECURITY_MAX_FILES,
  FILE_SECURITY_MAX_REQUEST_BYTES,
  FILE_SECURITY_MAX_TOTAL_FILE_BYTES,
  FileSecurityPolicy,
} from './file-security-policy';

export const TRAVEL_GROUP_ATTACHMENT_CATEGORIES = [
  'key_customer_photo',
  'guest_info',
] as const;

export type TravelGroupAttachmentCategory =
  (typeof TRAVEL_GROUP_ATTACHMENT_CATEGORIES)[number];

export const TRAVEL_GROUP_ATTACHMENT_MAX_FILE_SIZE =
  FILE_SECURITY_MAX_FILE_BYTES;
export const TRAVEL_GROUP_ATTACHMENT_MAX_FILES_PER_REQUEST =
  FILE_SECURITY_MAX_FILES;
export const REFUND_PROOF_ATTACHMENT_MAX_FILE_SIZE =
  FILE_SECURITY_MAX_FILE_BYTES;
export const REFUND_PROOF_ATTACHMENT_MAX_FILES_PER_REQUEST =
  FILE_SECURITY_MAX_FILES;
export const ATTACHMENT_UPLOAD_MAX_REQUEST_SIZE =
  FILE_SECURITY_MAX_REQUEST_BYTES;

const ATTACHMENT_UPLOAD_MAX_FIELDS = 10;
const ATTACHMENT_MAGIC_BYTES_LENGTH = 32;
const TEMPORARY_UPLOAD_NAME_PATTERN =
  /^\.upload-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REQUEST_UPLOAD_STATE = Symbol('attachment-upload-state');
const ORPHANED_UPLOAD_RETENTION_MS = 24 * 60 * 60 * 1000;

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

const ALLOWED_REFUND_PROOF_FILE_TYPES = new Map<string, Set<string>>([
  ['image/jpeg', new Set(['.jpg', '.jpeg'])],
  ['image/png', new Set(['.png'])],
  ['image/gif', new Set(['.gif'])],
  ['image/webp', new Set(['.webp'])],
  ['image/bmp', new Set(['.bmp'])],
  ['image/tiff', new Set(['.tif', '.tiff'])],
  ['image/avif', new Set(['.avif'])],
  ['application/pdf', new Set(['.pdf'])],
]);

@Injectable()
export class AttachmentUploadConfigService implements OnModuleInit {
  readonly maxFileBytes = readUploadLimit(
    'ATTACHMENT_UPLOAD_MAX_FILE_BYTES',
    TRAVEL_GROUP_ATTACHMENT_MAX_FILE_SIZE,
    TRAVEL_GROUP_ATTACHMENT_MAX_FILE_SIZE,
  );
  readonly maxFiles = readUploadLimit(
    'ATTACHMENT_UPLOAD_MAX_FILES',
    TRAVEL_GROUP_ATTACHMENT_MAX_FILES_PER_REQUEST,
    TRAVEL_GROUP_ATTACHMENT_MAX_FILES_PER_REQUEST,
  );
  readonly maxRequestBytes = readUploadLimit(
    'ATTACHMENT_UPLOAD_MAX_REQUEST_BYTES',
    ATTACHMENT_UPLOAD_MAX_REQUEST_SIZE,
    FILE_SECURITY_MAX_REQUEST_BYTES,
  );
  readonly maxTotalFileBytes = Math.min(
    FILE_SECURITY_MAX_TOTAL_FILE_BYTES,
    this.maxRequestBytes,
  );
  readonly temporaryRoot = getAttachmentUploadTemporaryRoot();

  constructor() {
    if (this.maxRequestBytes < this.maxFileBytes) {
      throw uploadConfigError(
        'ATTACHMENT_UPLOAD_MAX_REQUEST_BYTES must be at least ATTACHMENT_UPLOAD_MAX_FILE_BYTES.',
      );
    }
    assertPrivateStorageRoot(this.temporaryRoot, 'ATTACHMENT_UPLOAD_TEMP_DIR');
    const permanentRoot = getTravelGroupAttachmentStorageRoot();
    assertPrivateStorageRoot(
      permanentRoot,
      'TRAVEL_GROUP_ATTACHMENT_DIR',
    );
    if (
      isSameOrNestedPath(this.temporaryRoot, permanentRoot) ||
      isSameOrNestedPath(permanentRoot, this.temporaryRoot)
    ) {
      throw uploadConfigError(
        'Temporary uploads and permanent attachments must use separate private directories.',
      );
    }
  }

  async onModuleInit() {
    await fs.mkdir(this.temporaryRoot, {
      recursive: true,
      mode: 0o700,
    });
    await this.cleanupOrphanedTemporaryFiles();
  }

  createMulterOptions() {
    return {
      storage: createPrivateTemporaryStorage(this),
      limits: {
        fileSize: this.maxFileBytes,
        files: this.maxFiles,
        fields: ATTACHMENT_UPLOAD_MAX_FIELDS,
        fieldSize: 64 * 1024,
        parts: this.maxFiles + ATTACHMENT_UPLOAD_MAX_FIELDS,
      },
    };
  }

  assertRequestContentLength(request: any) {
    const rawLength = request?.headers?.['content-length'];
    if (rawLength === undefined) {
      return;
    }
    const contentLength = Number(rawLength);
    if (
      !Number.isSafeInteger(contentLength) ||
      contentLength < 0 ||
      contentLength > this.maxRequestBytes
    ) {
      throw createHttpError(
        413,
        'MULTIPART_REQUEST_TOO_LARGE',
        'The multipart request exceeds the configured total upload limit.',
      );
    }
  }

  async cleanupTemporaryFiles(files: any[]) {
    await Promise.all(
      (Array.isArray(files) ? files : []).map(async (file) => {
        const temporaryPath = String(file?.path || '');
        if (!isTemporaryUploadPath(temporaryPath, this.temporaryRoot)) {
          return;
        }
        try {
          await fs.unlink(temporaryPath);
        } catch (error) {
          if ((error as any)?.code !== 'ENOENT') {
            throw error;
          }
        }
      }),
    );
  }

  async cleanupOrphanedTemporaryFiles(
    nowMilliseconds = Date.now(),
    retentionMilliseconds = ORPHANED_UPLOAD_RETENTION_MS,
  ) {
    const names = await fs.readdir(this.temporaryRoot);
    await Promise.all(
      names.map(async (name) => {
        if (!TEMPORARY_UPLOAD_NAME_PATTERN.test(name)) {
          return;
        }
        const candidate = path.join(this.temporaryRoot, name);
        try {
          const stat = await fs.stat(candidate);
          if (
            stat.isFile() &&
            nowMilliseconds - stat.mtimeMs > retentionMilliseconds
          ) {
            await fs.unlink(candidate);
          }
        } catch (error) {
          if ((error as any)?.code !== 'ENOENT') {
            throw error;
          }
        }
      }),
    );
  }
}

@Injectable()
export class SecureAttachmentUploadInterceptor implements NestInterceptor {
  private readonly delegate: NestInterceptor;

  constructor(
    private readonly uploadConfig: AttachmentUploadConfigService,
  ) {
    const Interceptor = AnyFilesInterceptor(
      uploadConfig.createMulterOptions(),
    );
    this.delegate = new Interceptor();
  }

  async intercept(context: ExecutionContext, next: CallHandler) {
    const request = context.switchToHttp().getRequest();
    this.uploadConfig.assertRequestContentLength(request);
    let result: any;
    try {
      result = await this.delegate.intercept(context, next);
    } catch (error) {
      await this.uploadConfig.cleanupTemporaryFiles(request?.files);
      throw normalizeMultipartUploadError(error);
    }
    return result.pipe(
      catchError((error: any) =>
        throwError(() => normalizeMultipartUploadError(error)),
      ),
    );
  }
}

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

export async function validateTravelGroupAttachmentFile(file: any) {
  return validateAttachmentFile(file, {
    allowedTypes: ALLOWED_FILE_TYPES,
    maxFileSize: TRAVEL_GROUP_ATTACHMENT_MAX_FILE_SIZE,
    fileRequiredCode: 'ATTACHMENT_FILE_REQUIRED',
    tooLargeMessage: 'Each attachment file must not exceed 10MB.',
    unsupportedMessage: 'Attachment file type is not supported.',
  });
}

export async function validateRefundProofAttachmentFile(file: any) {
  return validateAttachmentFile(file, {
    allowedTypes: ALLOWED_REFUND_PROOF_FILE_TYPES,
    maxFileSize: REFUND_PROOF_ATTACHMENT_MAX_FILE_SIZE,
    fileRequiredCode: 'REFUND_PROOF_FILE_REQUIRED',
    tooLargeMessage: 'Each refund proof file must not exceed 10MB.',
    unsupportedMessage: 'Refund proof must be an image or PDF file.',
  });
}

async function validateAttachmentFile(
  file: any,
  options: {
    allowedTypes: Map<string, Set<string>>;
    maxFileSize: number;
    fileRequiredCode: string;
    tooLargeMessage: string;
    unsupportedMessage: string;
  },
) {
  const inMemoryBuffer = Buffer.isBuffer(file?.buffer)
    ? (file.buffer as Buffer)
    : null;
  const temporaryPath =
    !inMemoryBuffer && isTemporaryUploadFileRecord(file)
      ? String(file.path)
      : null;
  if (!file || (!inMemoryBuffer && !temporaryPath)) {
    throw createHttpError(
      400,
      options.fileRequiredCode,
      'At least one attachment file is required.',
    );
  }
  const size = Number(file.size ?? inMemoryBuffer?.length);
  if (!Number.isSafeInteger(size) || size <= 0) {
    throw createHttpError(
      400,
      'EMPTY_OR_INVALID_ATTACHMENT',
      'Attachment file must not be empty.',
    );
  }
  if (size > options.maxFileSize) {
    throw createHttpError(
      413,
      'FILE_TOO_LARGE',
      options.tooLargeMessage,
    );
  }

  FileSecurityPolicy.assertSafeOriginalName(file.originalname);
  FileSecurityPolicy.assertAllowedExtension(String(file.originalname || ''));
  const originalName = sanitizeAttachmentOriginalName(file.originalname);
  const contentType = normalizeContentType(file.mimetype);
  const allowedExtensions = options.allowedTypes.get(contentType);
  const extension = path.extname(originalName).toLowerCase();
  if (!allowedExtensions || !allowedExtensions.has(extension)) {
    throw createHttpError(
      400,
      'UNSUPPORTED_ATTACHMENT_TYPE',
      options.unsupportedMessage,
    );
  }
  const magicBytes = inMemoryBuffer
    ? inMemoryBuffer.subarray(0, ATTACHMENT_MAGIC_BYTES_LENGTH)
    : Buffer.isBuffer(file.magicBytes)
      ? file.magicBytes
      : Buffer.alloc(0);
  assertAttachmentMagicBytes(contentType, magicBytes);
  await FileSecurityPolicy.validateDocument({
    originalName,
    contentType,
    size,
    buffer: inMemoryBuffer,
    temporaryPath,
  });

  return {
    buffer: inMemoryBuffer,
    temporaryPath,
    originalName,
    contentType,
    size,
  };
}

export function assertAttachmentAggregateSize(
  files: Array<{ size?: unknown }>,
  maxRequestBytes = FILE_SECURITY_MAX_TOTAL_FILE_BYTES,
) {
  let total = 0;
  for (const file of Array.isArray(files) ? files : []) {
    const size = Number(file?.size);
    if (!Number.isSafeInteger(size) || size < 0) {
      throw createHttpError(
        400,
        'INVALID_ATTACHMENT_FILE',
        'Attachment file size is invalid.',
      );
    }
    total += size;
    if (!Number.isSafeInteger(total) || total > maxRequestBytes) {
      throw createHttpError(
        413,
        'MULTIPART_REQUEST_TOO_LARGE',
        'The multipart request exceeds the configured total upload limit.',
      );
    }
  }
  return total;
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
  source:
    | Buffer
    | {
        buffer?: Buffer | null;
        temporaryPath?: string | null;
      },
  ) {
  const filePath = resolveAttachmentFilePath(storageKey);
  await fs.mkdir(path.dirname(filePath), {
    recursive: true,
    mode: 0o700,
  });
  if (Buffer.isBuffer(source)) {
    await fs.writeFile(filePath, source, {
      flag: 'wx',
      mode: 0o600,
    });
    return;
  }
  if (Buffer.isBuffer(source?.buffer)) {
    await fs.writeFile(filePath, source.buffer, {
      flag: 'wx',
      mode: 0o600,
    });
    return;
  }
  if (source?.temporaryPath) {
    try {
      await fs.copyFile(
        source.temporaryPath,
        filePath,
        fsSync.constants.COPYFILE_EXCL,
      );
      await fs.chmod(filePath, 0o600);
    } catch (error) {
      try {
        await fs.unlink(filePath);
      } catch (cleanupError) {
        if ((cleanupError as any)?.code !== 'ENOENT') {
          throw cleanupError;
        }
      }
      throw error;
    }
    return;
  }
  throw createHttpError(
    400,
    'ATTACHMENT_FILE_REQUIRED',
    'At least one attachment file is required.',
  );
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

function createPrivateTemporaryStorage(
  config: AttachmentUploadConfigService,
) {
  return {
    _handleFile(
      request: any,
      file: any,
      callback: (error: any, info?: any) => void,
    ) {
      const fileName = `.upload-${crypto.randomUUID()}`;
      const temporaryPath = path.join(config.temporaryRoot, fileName);
      const requestState =
        request[REQUEST_UPLOAD_STATE] ||
        (request[REQUEST_UPLOAD_STATE] = { totalBytes: 0 });
      let magicBytes = Buffer.alloc(0);
      const meter = new Transform({
        transform(chunk, _encoding, done) {
          const buffer = Buffer.isBuffer(chunk)
            ? chunk
            : Buffer.from(chunk);
          requestState.totalBytes += buffer.length;
          if (requestState.totalBytes > config.maxTotalFileBytes) {
            done(
              createHttpError(
                413,
                'MULTIPART_REQUEST_TOO_LARGE',
                'The multipart request exceeds the configured total upload limit.',
              ),
            );
            return;
          }
          if (magicBytes.length < ATTACHMENT_MAGIC_BYTES_LENGTH) {
            const remaining =
              ATTACHMENT_MAGIC_BYTES_LENGTH - magicBytes.length;
            magicBytes = Buffer.concat([
              magicBytes,
              buffer.subarray(0, remaining),
            ]);
          }
          done(null, buffer);
        },
      });
      const output = fsSync.createWriteStream(temporaryPath, {
        flags: 'wx',
        mode: 0o600,
      });
      void pipeline(file.stream, meter, output)
        .then(() => {
          callback(null, {
            destination: config.temporaryRoot,
            filename: fileName,
            path: temporaryPath,
            size: output.bytesWritten,
            magicBytes,
          });
        })
        .catch(async (error) => {
          try {
            await fs.unlink(temporaryPath);
          } catch (cleanupError) {
            if ((cleanupError as any)?.code !== 'ENOENT') {
              callback(cleanupError);
              return;
            }
          }
          callback(error);
        });
    },
    _removeFile(
      _request: any,
      file: any,
      callback: (error?: any) => void,
    ) {
      const temporaryPath = String(file?.path || '');
      if (!isTemporaryUploadPath(temporaryPath, config.temporaryRoot)) {
        callback();
        return;
      }
      fsSync.unlink(temporaryPath, (error) => {
        if (error && (error as any).code !== 'ENOENT') {
          callback(error);
          return;
        }
        callback();
      });
    },
  };
}

function isTemporaryUploadFileRecord(file: any) {
  const temporaryPath = String(file?.path || '');
  const destination = String(file?.destination || '');
  return (
    Boolean(temporaryPath) &&
    Boolean(destination) &&
    path.dirname(path.resolve(temporaryPath)) ===
      path.resolve(destination) &&
    TEMPORARY_UPLOAD_NAME_PATTERN.test(path.basename(temporaryPath)) &&
    Buffer.isBuffer(file?.magicBytes)
  );
}

function isTemporaryUploadPath(
  value: string,
  temporaryRoot: string,
) {
  if (!value) {
    return false;
  }
  const resolved = path.resolve(value);
  return (
    path.dirname(resolved) === temporaryRoot &&
    TEMPORARY_UPLOAD_NAME_PATTERN.test(path.basename(resolved))
  );
}

function assertAttachmentMagicBytes(
  contentType: string,
  bytes: Buffer,
) {
  let matches = true;
  switch (contentType) {
    case 'image/jpeg':
      matches =
        bytes.length >= 3 &&
        bytes[0] === 0xff &&
        bytes[1] === 0xd8 &&
        bytes[2] === 0xff;
      break;
    case 'image/png':
      matches =
        bytes.length >= 8 &&
        bytes.subarray(0, 8).equals(
          Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        );
      break;
    case 'image/gif':
      matches =
        bytes.subarray(0, 6).toString('ascii') === 'GIF87a' ||
        bytes.subarray(0, 6).toString('ascii') === 'GIF89a';
      break;
    case 'image/webp':
      matches =
        bytes.length >= 12 &&
        bytes.subarray(0, 4).toString('ascii') === 'RIFF' &&
        bytes.subarray(8, 12).toString('ascii') === 'WEBP';
      break;
    case 'image/bmp':
      matches =
        bytes.length >= 2 &&
        bytes.subarray(0, 2).toString('ascii') === 'BM';
      break;
    case 'image/tiff':
      matches =
        bytes.subarray(0, 4).equals(
          Buffer.from([0x49, 0x49, 0x2a, 0x00]),
        ) ||
        bytes.subarray(0, 4).equals(
          Buffer.from([0x4d, 0x4d, 0x00, 0x2a]),
        );
      break;
    case 'image/avif': {
      const sample = bytes.toString('ascii');
      matches =
        bytes.length >= 12 &&
        bytes.subarray(4, 8).toString('ascii') === 'ftyp' &&
        (sample.includes('avif') || sample.includes('avis'));
      break;
    }
    case 'application/pdf':
      matches = bytes.subarray(0, 5).toString('ascii') === '%PDF-';
      break;
    default:
      return;
  }
  if (!matches) {
    throw createHttpError(
      400,
      'ATTACHMENT_CONTENT_MISMATCH',
      'Attachment content does not match its declared file type.',
    );
  }
}

function readUploadLimit(
  envName: string,
  fallback: number,
  maximum: number,
) {
  const raw = String(process.env[envName] || '').trim();
  if (!raw) {
    return fallback;
  }
  const value = Number(raw);
  if (
    !Number.isSafeInteger(value) ||
    value <= 0 ||
    value > maximum
  ) {
    throw uploadConfigError(
      `${envName} must be a positive integer no greater than ${maximum}.`,
    );
  }
  return value;
}

function getAttachmentUploadTemporaryRoot() {
  const configured = String(
    process.env.ATTACHMENT_UPLOAD_TEMP_DIR || '',
  ).trim();
  return configured
    ? path.resolve(configured)
    : path.resolve(os.tmpdir(), 'jiangjiu-api-private-uploads');
}

function assertPrivateStorageRoot(root: string, envName: string) {
  const parsed = path.parse(root);
  const segments = root
    .slice(parsed.root.length)
    .split(path.sep)
    .filter(Boolean)
    .map((segment) => segment.toLowerCase());
  if (
    root === parsed.root ||
    segments.some((segment) =>
      ['public', 'static', 'www', 'wwwroot', 'htdocs'].includes(
        segment,
      ),
    )
  ) {
    throw uploadConfigError(
      `${envName} must point to a private non-Web directory.`,
    );
  }
}

function isSameOrNestedPath(child: string, parent: string) {
  const relative = path.relative(parent, child);
  return (
    relative === '' ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== '..' &&
      !path.isAbsolute(relative))
  );
}

function uploadConfigError(message: string) {
  const error: any = new Error(message);
  error.code = 'ATTACHMENT_UPLOAD_CONFIG_INVALID';
  return error;
}

function normalizeMultipartUploadError(error: any) {
  const message = String(
    error?.message || error?.response?.message || '',
  );
  if (
    error?.code === 'LIMIT_FILE_SIZE' ||
    message === 'File too large'
  ) {
    return createHttpError(
      413,
      'FILE_TOO_LARGE',
      'An attachment exceeds the configured per-file limit.',
    );
  }
  if (
    error?.code === 'LIMIT_FILE_COUNT' ||
    error?.code === 'LIMIT_PART_COUNT' ||
    error?.code === 'LIMIT_UNEXPECTED_FILE' ||
    message === 'Too many files' ||
    message === 'Too many parts' ||
    message === 'Unexpected field'
  ) {
    return createHttpError(
      413,
      'TOO_MANY_ATTACHMENT_FILES',
      'The multipart request contains too many files or parts.',
    );
  }
  if (
    error?.code === 'LIMIT_FIELD_COUNT' ||
    error?.code === 'LIMIT_FIELD_VALUE' ||
    message === 'Too many fields' ||
    message === 'Field value too long'
  ) {
    return createHttpError(
      413,
      'MULTIPART_REQUEST_TOO_LARGE',
      'The multipart request exceeds the configured field limits.',
    );
  }
  if (error?.statusCode) {
    return error;
  }
  return error;
}
