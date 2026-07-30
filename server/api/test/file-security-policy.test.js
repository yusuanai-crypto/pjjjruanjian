const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const JSZip = require('jszip');

const {
  FILE_SECURITY_MAX_FILES,
  FILE_SECURITY_MAX_NAME_LENGTH,
  FILE_SECURITY_ZIP_MAX_ENTRY_BYTES,
  FileSecurityPolicy,
  validateOfficeZipMetadata,
} = require('../src/modules/business-data/file-security-policy');
const {
  AttachmentUploadConfigService,
  sanitizeAttachmentOriginalName,
  validateTravelGroupAttachmentFile,
} = require('../src/modules/business-data/travel-group-attachment-storage.helper');

const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const XLSX_MIME =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

test('FileSecurityPolicy validates harmless PDF, DOCX and XLSX fixtures', async () => {
  const fixtures = [
    {
      originalname: 'safe.pdf',
      mimetype: 'application/pdf',
      buffer: validPdf(),
    },
    {
      originalname: 'safe.docx',
      mimetype: DOCX_MIME,
      buffer: await openXml('docx'),
    },
    {
      originalname: 'safe.xlsx',
      mimetype: XLSX_MIME,
      buffer: await openXml('xlsx'),
    },
  ];
  for (const fixture of fixtures) {
    const validated = await validateTravelGroupAttachmentFile({
      ...fixture,
      size: fixture.buffer.length,
    });
    assert.equal(validated.originalName, fixture.originalname);
    assert.equal(validated.contentType, fixture.mimetype);
  }
});

test('FileSecurityPolicy rejects empty, mismatched, truncated and malformed documents', async () => {
  await rejectsCode(
    validateTravelGroupAttachmentFile({
      originalname: 'empty.pdf',
      mimetype: 'application/pdf',
      buffer: Buffer.alloc(0),
      size: 0,
    }),
    'EMPTY_OR_INVALID_ATTACHMENT',
  );
  await rejectsCode(
    validateTravelGroupAttachmentFile({
      originalname: 'renamed.pdf',
      mimetype: 'application/pdf',
      buffer: Buffer.from('not pdf'),
      size: 7,
    }),
    'ATTACHMENT_CONTENT_MISMATCH',
  );
  const validDocx = await openXml('docx');
  await rejectsCode(
    validateTravelGroupAttachmentFile({
      originalname: 'wrong.docx',
      mimetype: 'application/pdf',
      buffer: validDocx,
      size: validDocx.length,
    }),
    'UNSUPPORTED_ATTACHMENT_TYPE',
  );
  const truncatedPdf = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n');
  await rejectsCode(
    validateTravelGroupAttachmentFile({
      originalname: 'truncated.pdf',
      mimetype: 'application/pdf',
      buffer: truncatedPdf,
      size: truncatedPdf.length,
    }),
    'TRUNCATED_PDF',
  );
  const damagedZip = Buffer.from([
    0x50, 0x4b, 0x03, 0x04, ...Buffer.alloc(40),
  ]);
  await rejectsCode(
    validateTravelGroupAttachmentFile({
      originalname: 'damaged.docx',
      mimetype: DOCX_MIME,
      buffer: damagedZip,
      size: damagedZip.length,
    }),
    'INVALID_OFFICE_ZIP',
  );
  const missingStructure = await new JSZip()
    .file('[Content_Types].xml', '<Types />')
    .generateAsync({ type: 'nodebuffer' });
  await rejectsCode(
    validateTravelGroupAttachmentFile({
      originalname: 'missing.xlsx',
      mimetype: XLSX_MIME,
      buffer: missingStructure,
      size: missingStructure.length,
    }),
    'INVALID_OFFICE_STRUCTURE',
  );
});

test('FileSecurityPolicy rejects unsafe names, macro formats and active content', async () => {
  assert.equal(
    sanitizeAttachmentOriginalName('../../folder\\safe.pdf'),
    'safe.pdf',
  );
  assert.throws(
    () => FileSecurityPolicy.assertSafeOriginalName('../unsafe.pdf'),
    (error) => error?.code === 'INVALID_ATTACHMENT_FILE_NAME',
  );
  assert.throws(
    () =>
      FileSecurityPolicy.assertSafeOriginalName(
        `${'a'.repeat(FILE_SECURITY_MAX_NAME_LENGTH)}.pdf`,
      ),
    (error) => error?.code === 'INVALID_ATTACHMENT_FILE_NAME',
  );
  await rejectsCode(
    validateTravelGroupAttachmentFile({
      originalname: 'macro.docm',
      mimetype: DOCX_MIME,
      buffer: await openXml('docx'),
      size: 100,
    }),
    'MACRO_ENABLED_DOCUMENT_REJECTED',
  );
  const activePdf = Buffer.from(
    '%PDF-1.4\n1 0 obj\n<< /JavaScript 2 0 R >>\nendobj\n' +
      'trailer\n<<>>\nstartxref\n9\n%%EOF\n',
  );
  await rejectsCode(
    validateTravelGroupAttachmentFile({
      originalname: 'active.pdf',
      mimetype: 'application/pdf',
      buffer: activePdf,
      size: activePdf.length,
    }),
    'ACTIVE_PDF_CONTENT_REJECTED',
  );
});

test('ZIP metadata limits use simulated sizes and reject traversal, nesting and duplicates', () => {
  assert.equal(FILE_SECURITY_MAX_FILES, 5);
  assert.throws(
    () =>
      validateOfficeZipMetadata([
        metadataEntry('word/document.xml', {
          compressedSize: 1,
          uncompressedSize: 101,
        }),
      ]),
    (error) => error?.code === 'ZIP_COMPRESSION_RATIO_EXCEEDED',
  );
  assert.throws(
    () =>
      validateOfficeZipMetadata([
        metadataEntry('xl/workbook.xml', {
          uncompressedSize: FILE_SECURITY_ZIP_MAX_ENTRY_BYTES + 1,
        }),
      ]),
    (error) => error?.code === 'ZIP_SIZE_LIMIT_EXCEEDED',
  );
  assert.throws(
    () => validateOfficeZipMetadata([metadataEntry('../escape.xml')]),
    (error) => error?.code === 'ZIP_PATH_REJECTED',
  );
  assert.throws(
    () =>
      validateOfficeZipMetadata([
        metadataEntry('word/document.xml'),
        metadataEntry('word/document.xml'),
      ]),
    (error) => error?.code === 'DUPLICATE_ZIP_ENTRY_REJECTED',
  );
  assert.throws(
    () =>
      validateOfficeZipMetadata([
        metadataEntry('word/embeddings/nested.zip'),
      ]),
    (error) => error?.code === 'EMBEDDED_OFFICE_CONTENT_REJECTED',
  );
  assert.throws(
    () =>
      validateOfficeZipMetadata([
        {
          ...metadataEntry('word/document.xml'),
          isEncrypted: () => true,
        },
      ]),
    (error) => error?.code === 'ENCRYPTED_ZIP_REJECTED',
  );
});

test('OOXML validation rejects external relationships and embedded objects', async () => {
  const linked = await openXml('docx', {
    extraEntries: {
      'word/_rels/document.xml.rels':
        '<Relationships><Relationship TargetMode="External" ' +
        'Target="https://invalid.example/" /></Relationships>',
    },
  });
  await rejectsCode(
    validateTravelGroupAttachmentFile({
      originalname: 'linked.docx',
      mimetype: DOCX_MIME,
      buffer: linked,
      size: linked.length,
    }),
    'EXTERNAL_OFFICE_RELATIONSHIP_REJECTED',
  );
  const embedded = await openXml('xlsx', {
    extraEntries: {
      'xl/embeddings/oleObject1.bin': Buffer.from('harmless-placeholder'),
    },
  });
  await rejectsCode(
    validateTravelGroupAttachmentFile({
      originalname: 'embedded.xlsx',
      mimetype: XLSX_MIME,
      buffer: embedded,
      size: embedded.length,
    }),
    'EMBEDDED_OFFICE_CONTENT_REJECTED',
  );
});

test('startup cleanup removes only expired randomized upload files', async () => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), 'jiangjiu-file-policy-'),
  );
  const temporaryRoot = path.join(root, 'temporary');
  const permanentRoot = path.join(root, 'permanent');
  const previousTemp = process.env.ATTACHMENT_UPLOAD_TEMP_DIR;
  const previousPermanent = process.env.TRAVEL_GROUP_ATTACHMENT_DIR;
  process.env.ATTACHMENT_UPLOAD_TEMP_DIR = temporaryRoot;
  process.env.TRAVEL_GROUP_ATTACHMENT_DIR = permanentRoot;
  try {
    await fs.mkdir(temporaryRoot, { recursive: true });
    const expired = path.join(
      temporaryRoot,
      `.upload-${crypto.randomUUID()}`,
    );
    const current = path.join(
      temporaryRoot,
      `.upload-${crypto.randomUUID()}`,
    );
    const unrelated = path.join(temporaryRoot, 'keep.txt');
    await fs.writeFile(expired, 'expired');
    await fs.writeFile(current, 'current');
    await fs.writeFile(unrelated, 'unrelated');
    const old = new Date(Date.now() - 48 * 60 * 60 * 1000);
    await fs.utimes(expired, old, old);

    const config = new AttachmentUploadConfigService();
    await config.onModuleInit();

    assert.equal(await exists(expired), false);
    assert.equal(await exists(current), true);
    assert.equal(await exists(unrelated), true);
  } finally {
    restoreEnv('ATTACHMENT_UPLOAD_TEMP_DIR', previousTemp);
    restoreEnv('TRAVEL_GROUP_ATTACHMENT_DIR', previousPermanent);
    await fs.rm(root, { recursive: true, force: true });
  }
});

function validPdf() {
  return Buffer.from(
    '%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n' +
      'trailer\n<< /Root 1 0 R >>\nstartxref\n9\n%%EOF\n',
  );
}

async function openXml(kind, { extraEntries = {} } = {}) {
  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    kind === 'docx'
      ? '<Types><Override PartName="/word/document.xml" /></Types>'
      : '<Types><Override PartName="/xl/workbook.xml" /></Types>',
  );
  zip.file(
    kind === 'docx' ? 'word/document.xml' : 'xl/workbook.xml',
    kind === 'docx' ? '<document />' : '<workbook />',
  );
  for (const [name, content] of Object.entries(extraEntries)) {
    zip.file(name, content);
  }
  return zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
  });
}

function metadataEntry(
  fileNameStr,
  { compressedSize = 10, uncompressedSize = 10 } = {},
) {
  return {
    fileNameStr,
    compressedSize,
    uncompressedSize,
    dir: false,
    unixPermissions: 0,
    isEncrypted: () => false,
  };
}

async function rejectsCode(promise, code) {
  await assert.rejects(promise, (error) => error?.code === code);
}

async function exists(value) {
  try {
    await fs.stat(value);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

function restoreEnv(name, value) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
