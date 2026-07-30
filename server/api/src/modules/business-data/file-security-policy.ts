import JSZip = require('jszip');
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { createHttpError } from '../../common/errors';

const ZipEntries = require('jszip/lib/zipEntries');
const zipUtf8 = require('jszip/lib/utf8');

export const FILE_SECURITY_MAX_FILE_BYTES = 10 * 1024 * 1024;
export const FILE_SECURITY_MAX_FILES = 5;
export const FILE_SECURITY_MAX_REQUEST_BYTES = 25 * 1024 * 1024;
export const FILE_SECURITY_MAX_TOTAL_FILE_BYTES = 24 * 1024 * 1024;
export const FILE_SECURITY_MAX_NAME_LENGTH = 180;

export const FILE_SECURITY_ZIP_MAX_ENTRIES = 1024;
export const FILE_SECURITY_ZIP_MAX_ENTRY_BYTES = 32 * 1024 * 1024;
export const FILE_SECURITY_ZIP_MAX_TOTAL_BYTES = 64 * 1024 * 1024;
export const FILE_SECURITY_ZIP_MAX_RATIO = 100;
export const FILE_SECURITY_ZIP_MAX_PATH_DEPTH = 12;

const OLE_COMPOUND_FILE_SIGNATURE = Buffer.from([
  0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1,
]);
const MACRO_EXTENSIONS = new Set([
  '.docm',
  '.dotm',
  '.xlsm',
  '.xltm',
  '.xlam',
]);
const NESTED_ARCHIVE_EXTENSIONS = new Set([
  '.zip',
  '.7z',
  '.rar',
  '.tar',
  '.gz',
  '.bz2',
  '.xz',
  '.jar',
  '.apk',
  '.docx',
  '.xlsx',
  ...MACRO_EXTENSIONS,
]);
const OOXML_BLOCKED_ENTRY_PATTERNS = [
  /(^|\/)vbaproject\.bin$/i,
  /(^|\/)activex\//i,
  /(^|\/)embeddings\//i,
  /(^|\/)externalLinks\//i,
  /(^|\/)oleObject/i,
];
const PDF_ACTIVE_CONTENT_MARKERS = [
  /\/JavaScript\b/i,
  /\/JS\b/i,
  /\/Launch\b/i,
  /\/EmbeddedFile\b/i,
];

export type FileSecurityDocumentKind =
  | 'pdf'
  | 'doc'
  | 'xls'
  | 'docx'
  | 'xlsx';

export interface FileSecurityInput {
  originalName: string;
  contentType: string;
  size: number;
  buffer?: Buffer | null;
  temporaryPath?: string | null;
}

export class FileSecurityPolicy {
  static assertSafeOriginalName(value: unknown) {
    const raw = String(value || '');
    if (
      raw.length === 0 ||
      raw.length > FILE_SECURITY_MAX_NAME_LENGTH ||
      /[\u0000-\u001f\u007f]/.test(raw) ||
      raw.includes('/') ||
      raw.includes('\\') ||
      /^[a-z]:/i.test(raw) ||
      raw.startsWith('//') ||
      raw.startsWith('\\\\') ||
      raw.split(/[\\/]/).includes('..')
    ) {
      throw createHttpError(
        400,
        'INVALID_ATTACHMENT_FILE_NAME',
        'Attachment file name is invalid.',
      );
    }
  }

  static assertAllowedExtension(originalName: string) {
    const extension = path.extname(originalName).toLowerCase();
    if (MACRO_EXTENSIONS.has(extension)) {
      throw createHttpError(
        400,
        'MACRO_ENABLED_DOCUMENT_REJECTED',
        'Macro-enabled Office documents are not supported.',
      );
    }
  }

  static async validateDocument(input: FileSecurityInput) {
    const extension = path.extname(input.originalName).toLowerCase();
    const kind = documentKindForExtension(extension);
    if (!kind) {
      return;
    }
    if (!Number.isSafeInteger(input.size) || input.size <= 0) {
      throw createHttpError(
        400,
        'EMPTY_OR_INVALID_ATTACHMENT',
        'Attachment file must not be empty.',
      );
    }
    if (input.size > FILE_SECURITY_MAX_FILE_BYTES) {
      throw createHttpError(
        413,
        'FILE_TOO_LARGE',
        'Each attachment file must not exceed 10MB.',
      );
    }

    const bytes = await readBoundedInput(input);
    switch (kind) {
      case 'pdf':
        validatePdf(bytes);
        return;
      case 'doc':
      case 'xls':
        validateOleCompoundFile(bytes);
        return;
      case 'docx':
      case 'xlsx':
        await validateOpenXmlContainer(bytes, kind);
        return;
    }
  }
}

function documentKindForExtension(
  extension: string,
): FileSecurityDocumentKind | null {
  switch (extension) {
    case '.pdf':
      return 'pdf';
    case '.doc':
      return 'doc';
    case '.xls':
      return 'xls';
    case '.docx':
      return 'docx';
    case '.xlsx':
      return 'xlsx';
    default:
      return null;
  }
}

async function readBoundedInput(input: FileSecurityInput) {
  if (Buffer.isBuffer(input.buffer)) {
    if (
      input.buffer.length !== input.size ||
      input.buffer.length > FILE_SECURITY_MAX_FILE_BYTES
    ) {
      throw createHttpError(
        400,
        'INVALID_ATTACHMENT_FILE',
        'Attachment file size changed during validation.',
      );
    }
    return input.buffer;
  }
  if (!input.temporaryPath) {
    throw createHttpError(
      400,
      'INVALID_ATTACHMENT_FILE',
      'Attachment file is unavailable for validation.',
    );
  }
  const stat = await fs.stat(input.temporaryPath);
  if (
    !stat.isFile() ||
    stat.size !== input.size ||
    stat.size <= 0 ||
    stat.size > FILE_SECURITY_MAX_FILE_BYTES
  ) {
    throw createHttpError(
      400,
      'INVALID_ATTACHMENT_FILE',
      'Attachment file size changed during validation.',
    );
  }
  return fs.readFile(input.temporaryPath);
}

function validatePdf(bytes: Buffer) {
  if (bytes.subarray(0, 5).toString('ascii') !== '%PDF-') {
    throw contentMismatch();
  }
  if (bytes.length < 32) {
    throw createHttpError(
      400,
      'TRUNCATED_PDF',
      'PDF file is truncated or malformed.',
    );
  }
  const tail = bytes.subarray(Math.max(0, bytes.length - 4096));
  const eofOffset = tail.lastIndexOf(Buffer.from('%%EOF'));
  if (eofOffset < 0) {
    throw createHttpError(
      400,
      'TRUNCATED_PDF',
      'PDF file is truncated or malformed.',
    );
  }
  const afterEof = tail
    .subarray(eofOffset + 5)
    .toString('latin1')
    .replace(/[\u0000\t\n\f\r ]/g, '');
  if (afterEof.length !== 0) {
    throw createHttpError(
      400,
      'TRUNCATED_PDF',
      'PDF file has invalid trailing content.',
    );
  }
  const pdfText = bytes.toString('latin1');
  if (PDF_ACTIVE_CONTENT_MARKERS.some((pattern) => pattern.test(pdfText))) {
    throw createHttpError(
      400,
      'ACTIVE_PDF_CONTENT_REJECTED',
      'PDF files containing scripts, launch actions, or embedded files are not supported.',
    );
  }
}

function validateOleCompoundFile(bytes: Buffer) {
  if (
    bytes.length < 512 ||
    !bytes.subarray(0, OLE_COMPOUND_FILE_SIGNATURE.length).equals(
      OLE_COMPOUND_FILE_SIGNATURE,
    )
  ) {
    throw contentMismatch();
  }
}

async function validateOpenXmlContainer(
  bytes: Buffer,
  kind: 'docx' | 'xlsx',
) {
  if (
    bytes.length < 22 ||
    !bytes.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))
  ) {
    throw contentMismatch();
  }

  let rawEntries: any[];
  try {
    const parser = new ZipEntries({
      base64: false,
      checkCRC32: false,
      optimizedBinaryString: false,
      createFolders: false,
      decodeFileName: zipUtf8.utf8decode,
    });
    parser.load(bytes);
    rawEntries = parser.files;
  } catch (error) {
    const message = String((error as any)?.message || '');
    if (/encrypted zip/i.test(message)) {
      throw createHttpError(
        400,
        'ENCRYPTED_ZIP_REJECTED',
        'Encrypted Office documents are not supported.',
      );
    }
    throw invalidZip();
  }

  validateZipMetadata(rawEntries);

  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes, {
      checkCRC32: true,
      createFolders: false,
    });
  } catch {
    throw invalidZip();
  }

  const entryNames = new Set(
    rawEntries.map((entry) => String(entry.fileNameStr || '')),
  );
  const requiredRoot = '[Content_Types].xml';
  const requiredPart =
    kind === 'docx' ? 'word/document.xml' : 'xl/workbook.xml';
  const requiredPrefix = kind === 'docx' ? 'word/' : 'xl/';
  if (
    !entryNames.has(requiredRoot) ||
    !entryNames.has(requiredPart) ||
    ![...entryNames].some((name) => name.startsWith(requiredPrefix))
  ) {
    throw createHttpError(
      400,
      'INVALID_OFFICE_STRUCTURE',
      'Office document is missing required package parts.',
    );
  }

  const contentTypes = await readZipText(zip, requiredRoot);
  if (
    /macroEnabled|vbaProject|application\/vnd\.ms-office\.vbaProject/i.test(
      contentTypes,
    )
  ) {
    throw createHttpError(
      400,
      'MACRO_ENABLED_DOCUMENT_REJECTED',
      'Macro-enabled Office documents are not supported.',
    );
  }
  for (const name of entryNames) {
    if (!name.toLowerCase().endsWith('.rels')) {
      continue;
    }
    const relationships = await readZipText(zip, name);
    if (/TargetMode\s*=\s*["']External["']/i.test(relationships)) {
      throw createHttpError(
        400,
        'EXTERNAL_OFFICE_RELATIONSHIP_REJECTED',
        'Office documents containing external links are not supported.',
      );
    }
  }
}

function validateZipMetadata(entries: any[]) {
  if (
    !Array.isArray(entries) ||
    entries.length === 0 ||
    entries.length > FILE_SECURITY_ZIP_MAX_ENTRIES
  ) {
    throw createHttpError(
      400,
      'ZIP_ENTRY_LIMIT_EXCEEDED',
      'Office document contains too many ZIP entries.',
    );
  }
  const names = new Set<string>();
  let totalCompressed = 0;
  let totalUncompressed = 0;
  for (const entry of entries) {
    const rawName = String(entry.fileNameStr || '');
    const normalizedName = rawName.toLowerCase();
    if (
      !rawName ||
      rawName.length > 512 ||
      /[\u0000-\u001f\u007f]/.test(rawName) ||
      rawName.includes('\\') ||
      rawName.startsWith('/') ||
      /^[a-z]:/i.test(rawName) ||
      rawName.split('/').includes('..') ||
      rawName.split('/').filter(Boolean).length >
        FILE_SECURITY_ZIP_MAX_PATH_DEPTH
    ) {
      throw createHttpError(
        400,
        'ZIP_PATH_REJECTED',
        'Office document contains an unsafe ZIP entry path.',
      );
    }
    if (names.has(normalizedName)) {
      throw createHttpError(
        400,
        'DUPLICATE_ZIP_ENTRY_REJECTED',
        'Office document contains duplicate ZIP entries.',
      );
    }
    names.add(normalizedName);

    if (
      OOXML_BLOCKED_ENTRY_PATTERNS.some((pattern) =>
        pattern.test(rawName),
      ) ||
      (!entry.dir &&
        NESTED_ARCHIVE_EXTENSIONS.has(
          path.posix.extname(rawName).toLowerCase(),
        ))
    ) {
      throw createHttpError(
        400,
        'EMBEDDED_OFFICE_CONTENT_REJECTED',
        'Office document contains macros, nested archives, or embedded objects.',
      );
    }
    const unixMode = Number(entry.unixPermissions || 0);
    if ((unixMode & 0xf000) === 0xa000) {
      throw createHttpError(
        400,
        'ZIP_PATH_REJECTED',
        'Office document contains a symbolic link.',
      );
    }
    if (typeof entry.isEncrypted === 'function' && entry.isEncrypted()) {
      throw createHttpError(
        400,
        'ENCRYPTED_ZIP_REJECTED',
        'Encrypted Office documents are not supported.',
      );
    }

    const compressed = Number(entry.compressedSize);
    const uncompressed = Number(entry.uncompressedSize);
    if (
      !Number.isSafeInteger(compressed) ||
      compressed < 0 ||
      !Number.isSafeInteger(uncompressed) ||
      uncompressed < 0 ||
      uncompressed > FILE_SECURITY_ZIP_MAX_ENTRY_BYTES
    ) {
      throw createHttpError(
        400,
        'ZIP_SIZE_LIMIT_EXCEEDED',
        'Office document contains an oversized ZIP entry.',
      );
    }
    if (
      uncompressed > 0 &&
      (compressed === 0 ||
        uncompressed / compressed > FILE_SECURITY_ZIP_MAX_RATIO)
    ) {
      throw createHttpError(
        400,
        'ZIP_COMPRESSION_RATIO_EXCEEDED',
        'Office document has an unsafe compression ratio.',
      );
    }
    totalCompressed += compressed;
    totalUncompressed += uncompressed;
    if (
      !Number.isSafeInteger(totalUncompressed) ||
      totalUncompressed > FILE_SECURITY_ZIP_MAX_TOTAL_BYTES
    ) {
      throw createHttpError(
        400,
        'ZIP_SIZE_LIMIT_EXCEEDED',
        'Office document expands beyond the allowed ZIP size.',
      );
    }
  }
  if (
    totalUncompressed > 0 &&
    (totalCompressed === 0 ||
      totalUncompressed / totalCompressed >
        FILE_SECURITY_ZIP_MAX_RATIO)
  ) {
    throw createHttpError(
      400,
      'ZIP_COMPRESSION_RATIO_EXCEEDED',
      'Office document has an unsafe aggregate compression ratio.',
    );
  }
}

export function validateOfficeZipMetadata(entries: any[]) {
  validateZipMetadata(entries);
}

async function readZipText(zip: JSZip, name: string) {
  const file = zip.file(name);
  if (!file) {
    throw createHttpError(
      400,
      'INVALID_OFFICE_STRUCTURE',
      'Office document is missing required package parts.',
    );
  }
  return file.async('string');
}

function contentMismatch() {
  return createHttpError(
    400,
    'ATTACHMENT_CONTENT_MISMATCH',
    'Attachment content does not match its declared file type.',
  );
}

function invalidZip() {
  return createHttpError(
    400,
    'INVALID_OFFICE_ZIP',
    'Office document ZIP container is damaged or malformed.',
  );
}
