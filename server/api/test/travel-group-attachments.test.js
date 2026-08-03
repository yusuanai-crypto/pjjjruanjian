const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const JSZip = require('jszip');

const {
  assertErrorContract,
  createUser,
  login,
  requestJson,
  withPhase1Server,
} = require('./helpers/phase1-api');
const {
  AttachmentUploadConfigService,
  ATTACHMENT_UPLOAD_MAX_REQUEST_SIZE,
  TRAVEL_GROUP_ATTACHMENT_MAX_FILE_SIZE,
  assertAttachmentAggregateSize,
  isSafeAttachmentStorageKey,
  sanitizeAttachmentOriginalName,
  validateTravelGroupAttachmentFile,
} = require('../src/modules/business-data/travel-group-attachment-storage.helper');
const {
  formatShanghaiBusinessDate,
} = require('../src/modules/business-data/reconciliation-calculation.helper');

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHANGHAI_TODAY = formatShanghaiBusinessDate(new Date());
const SHANGHAI_TOMORROW = new Date(
  Date.parse(`${SHANGHAI_TODAY}T00:00:00.000Z`) + 24 * 60 * 60 * 1000,
)
  .toISOString()
  .slice(0, 10);

test('travel group attachment type and path validation accepts supported documents and rejects unsafe input', async () => {
  const supported = [
    ['photo.jpg', 'image/jpeg', attachmentFixtureForType('image/jpeg')],
    ['document.pdf', 'application/pdf', validPdfFixture()],
    ['document.doc', 'application/msword', validOleFixture()],
    [
      'document.docx',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      await validOpenXmlFixture('docx'),
    ],
    ['sheet.xls', 'application/vnd.ms-excel', validOleFixture()],
    [
      'sheet.xlsx',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      await validOpenXmlFixture('xlsx'),
    ],
    ['sheet.csv', 'text/csv', Buffer.from('name,value\nsafe,1\n')],
    ['notes.txt', 'text/plain', Buffer.from('safe notes')],
  ];

  for (const [originalname, mimetype, buffer] of supported) {
    const validated = await validateTravelGroupAttachmentFile({
      buffer,
      mimetype,
      originalname,
      size: buffer.length,
    });
    assert.equal(validated.originalName, originalname);
    assert.equal(validated.contentType, mimetype);
  }

  assert.equal(
    sanitizeAttachmentOriginalName('../../private\\escape.txt'),
    'escape.txt',
  );
  assert.equal(isSafeAttachmentStorageKey('../escape.txt'), false);
  assert.equal(isSafeAttachmentStorageKey('C:\\private\\escape.txt'), false);
  await assert.rejects(
    () =>
      validateTravelGroupAttachmentFile({
        buffer: Buffer.from('malware'),
        mimetype: 'application/octet-stream',
        originalname: 'malware.exe',
        size: 7,
      }),
    (error) => error?.code === 'UNSUPPORTED_ATTACHMENT_TYPE',
  );
  await assert.rejects(
    () =>
      validateTravelGroupAttachmentFile({
        buffer: Buffer.from('not-a-real-png'),
        mimetype: 'image/png',
        originalname: 'spoofed.png',
        size: 14,
      }),
    (error) => error?.code === 'ATTACHMENT_CONTENT_MISMATCH',
  );
});

test('attachment aggregate limit uses declared lengths without allocating large buffers', async () => {
  await assert.rejects(
    () =>
      validateTravelGroupAttachmentFile({
        buffer: attachmentFixtureForType('image/png'),
        mimetype: 'image/png',
        originalname: 'declared-too-large.png',
        size: TRAVEL_GROUP_ATTACHMENT_MAX_FILE_SIZE + 1,
      }),
    (error) => error?.code === 'FILE_TOO_LARGE',
  );
  assert.equal(
    assertAttachmentAggregateSize(
      [{ size: 17 }, { size: 23 }],
      40,
    ),
    40,
  );
  assert.throws(
    () =>
      assertAttachmentAggregateSize(
        [
          { size: ATTACHMENT_UPLOAD_MAX_REQUEST_SIZE },
          { size: 1 },
        ],
      ),
    (error) => error?.code === 'MULTIPART_REQUEST_TOO_LARGE',
  );
});

test('attachment upload configuration rejects limits above the startup safety cap', () => {
  const previousFiles = process.env.ATTACHMENT_UPLOAD_MAX_FILES;
  const previousRequestBytes =
    process.env.ATTACHMENT_UPLOAD_MAX_REQUEST_BYTES;
  process.env.ATTACHMENT_UPLOAD_MAX_FILES = '6';
  try {
    assert.throws(
      () => new AttachmentUploadConfigService(),
      (error) => error?.code === 'ATTACHMENT_UPLOAD_CONFIG_INVALID',
    );
    delete process.env.ATTACHMENT_UPLOAD_MAX_FILES;
    process.env.ATTACHMENT_UPLOAD_MAX_REQUEST_BYTES = String(
      ATTACHMENT_UPLOAD_MAX_REQUEST_SIZE + 1,
    );
    assert.throws(
      () => new AttachmentUploadConfigService(),
      (error) => error?.code === 'ATTACHMENT_UPLOAD_CONFIG_INVALID',
    );
  } finally {
    if (previousFiles === undefined) {
      delete process.env.ATTACHMENT_UPLOAD_MAX_FILES;
    } else {
      process.env.ATTACHMENT_UPLOAD_MAX_FILES = previousFiles;
    }
    if (previousRequestBytes === undefined) {
      delete process.env.ATTACHMENT_UPLOAD_MAX_REQUEST_BYTES;
    } else {
      process.env.ATTACHMENT_UPLOAD_MAX_REQUEST_BYTES =
        previousRequestBytes;
    }
  }
});

test('upload guards reject unauthenticated and unauthorized requests before multipart parsing', async () => {
  await withPhase1Server(
    async (baseUrl, { stores }) => {
      const admin = await login(baseUrl);
      const bossUser = await createUser(baseUrl, admin.token, {
        name: 'Upload Guard Boss',
        username: 'upload-guard-boss',
        password: 'Password123',
        role: 'boss',
      });
      const boss = await login(
        baseUrl,
        bossUser.username,
        'Password123',
      );
      const pathName =
        '/api/travel-groups/not-read/attachments/guest_info';

      const unauthenticated = await requestMalformedMultipart(
        baseUrl,
        pathName,
      );
      assertErrorContract(
        unauthenticated,
        401,
        'AUTH_TOKEN_REQUIRED',
      );

      const unauthorized = await requestMalformedMultipart(
        baseUrl,
        pathName,
        boss.token,
      );
      assertErrorContract(unauthorized, 403, 'PERMISSION_DENIED');
      assert.deepEqual(
        await fs.readdir(stores.attachmentTempDir),
        [],
      );
    },
  );
});

test('travel group attachments upload, authorize download, delete, sanitize DTOs, and log mutations', async () => {
  await withTemporaryAttachmentStorage(async (storageRoot) => {
    await withPhase1Server(
      async (baseUrl, { prisma, stores }) => {
        const admin = await login(baseUrl);
        const frontDeskUser = await createUser(baseUrl, admin.token, {
          name: 'Attachment Front Desk',
          username: 'attachment-front-desk',
          password: 'Password123',
          role: 'front_desk',
        });
        const assignedTasterUser = await createUser(baseUrl, admin.token, {
          name: 'Attachment Assigned Taster',
          username: 'attachment-assigned-taster',
          password: 'Password123',
          role: 'taster',
        });
        const unrelatedTasterUser = await createUser(baseUrl, admin.token, {
          name: 'Attachment Unrelated Taster',
          username: 'attachment-unrelated-taster',
          password: 'Password123',
          role: 'taster',
        });
        const bossUser = await createUser(baseUrl, admin.token, {
          name: 'Attachment Boss',
          username: 'attachment-boss',
          password: 'Password123',
          role: 'boss',
        });
        const salesUser = await createUser(baseUrl, admin.token, {
          name: 'Attachment Sales',
          username: 'attachment-sales',
          password: 'Password123',
          role: 'sales',
        });
        const frontDesk = await login(
          baseUrl,
          frontDeskUser.username,
          'Password123',
        );
        const assignedTaster = await login(
          baseUrl,
          assignedTasterUser.username,
          'Password123',
        );
        const unrelatedTaster = await login(
          baseUrl,
          unrelatedTasterUser.username,
          'Password123',
        );
        const boss = await login(baseUrl, bossUser.username, 'Password123');
        const sales = await login(baseUrl, salesUser.username, 'Password123');

        const group = await createTravelGroup(baseUrl, frontDesk.token, {
          tasterId: assignedTasterUser.id,
          visitDate: SHANGHAI_TODAY,
        });
        const otherGroup = await createTravelGroup(baseUrl, admin.token, {
          tasterId: unrelatedTasterUser.id,
          visitDate: SHANGHAI_TODAY,
        });

        const keyPhotoUpload = await uploadFiles(
          baseUrl,
          frontDesk.token,
          group.id,
          'key_customer_photo',
          [
            {
              content: Buffer.from('photo-content'),
              name: '../../private\\vip-photo.txt',
              type: 'text/plain',
            },
            {
              content: validPdfFixture(),
              name: 'vip-profile.pdf',
              type: 'application/pdf',
            },
          ],
        );
        assert.equal(keyPhotoUpload.response.status, 201);
        assert.equal(keyPhotoUpload.body.data.attachments.length, 2);
        assert.equal(
          keyPhotoUpload.body.data.attachments[0].originalName,
          'vip-photo.txt',
        );
        assertSafeAttachmentDto(
          keyPhotoUpload.body.data.attachments[0],
          'key_customer_photo',
        );
        assertNoStorageLocation(keyPhotoUpload.body.data);

        const guestInfoUpload = await uploadFiles(
          baseUrl,
          assignedTaster.token,
          group.id,
          'guest_info',
          [
            {
              content: Buffer.from('name,phone\nAlice,123'),
              name: 'guests.csv',
              type: 'text/csv',
            },
            {
              content: Buffer.from('guest notes'),
              name: 'guest-notes.txt',
              type: 'text/plain',
            },
          ],
        );
        assert.equal(guestInfoUpload.response.status, 201);
        assert.equal(guestInfoUpload.body.data.attachments.length, 2);
        assertSafeAttachmentDto(
          guestInfoUpload.body.data.attachments[0],
          'guest_info',
        );
        assertNoStorageLocation(guestInfoUpload.body.data);

        const adminUpload = await uploadFiles(
          baseUrl,
          admin.token,
          group.id,
          'key_customer_photo',
          [
            {
              content: attachmentFixtureForType('image/png'),
              name: 'admin-photo.png',
              type: 'image/png',
            },
          ],
        );
        assert.equal(adminUpload.response.status, 201);
        assert.deepEqual(
          await fs.readdir(stores.attachmentTempDir),
          [],
        );

        const rawGroup = await prisma.travelGroup.findUnique({
          where: { id: group.id },
        });
        assert.equal(rawGroup.keyCustomerPhotos.length, 3);
        assert.equal(rawGroup.guestInfoAttachments.length, 2);
        assert.equal(rawGroup.tasterEditCount, 0);
        for (const attachment of [
          ...rawGroup.keyCustomerPhotos,
          ...rawGroup.guestInfoAttachments,
        ]) {
          assert.deepEqual(Object.keys(attachment).sort(), [
            'category',
            'contentType',
            'id',
            'originalName',
            'size',
            'storageKey',
            'uploadedAt',
            'uploadedById',
          ]);
          assert.match(attachment.storageKey, UUID_PATTERN);
        }

        const storedNames = await fs.readdir(storageRoot);
        assert.equal(storedNames.length, 5);
        for (const storedName of storedNames) {
          assert.match(storedName, UUID_PATTERN);
        }

        const detail = await requestJson(
          baseUrl,
          `/api/travel-groups/${group.id}`,
          { token: unrelatedTaster.token },
        );
        assert.equal(detail.response.status, 200);
        assert.equal(detail.body.data.travelGroup.keyCustomerPhotos.length, 3);
        assert.equal(detail.body.data.travelGroup.guestInfoAttachments.length, 2);
        assertNoStorageLocation(detail.body.data.travelGroup);

        const downloadable = keyPhotoUpload.body.data.attachments[1];
        const unrelatedTasterDownload = await downloadFile(
          baseUrl,
          unrelatedTaster.token,
          group.id,
          downloadable.id,
        );
        assert.equal(unrelatedTasterDownload.response.status, 200);
        assert.deepEqual(unrelatedTasterDownload.buffer, validPdfFixture());
        assert.equal(
          unrelatedTasterDownload.response.headers.get('content-type'),
          'application/pdf',
        );
        assert.equal(
          unrelatedTasterDownload.response.headers.get('x-content-type-options'),
          'nosniff',
        );
        assert.match(
          unrelatedTasterDownload.response.headers.get('content-disposition'),
          /attachment; filename="attachment"; filename\*=UTF-8''/,
        );

        const bossDownload = await downloadFile(
          baseUrl,
          boss.token,
          group.id,
          downloadable.id,
        );
        assert.equal(bossDownload.response.status, 200);

        const scopedSalesDownload = await downloadFile(
          baseUrl,
          sales.token,
          group.id,
          downloadable.id,
        );
        assert.equal(scopedSalesDownload.response.status, 200);
        assert.deepEqual(scopedSalesDownload.buffer, validPdfFixture());

        const unrelatedUpload = await uploadFiles(
          baseUrl,
          unrelatedTaster.token,
          group.id,
          'guest_info',
          [
            {
              content: Buffer.from('forbidden'),
              name: 'forbidden.txt',
              type: 'text/plain',
            },
          ],
        );
        assertErrorContract(unrelatedUpload, 403, 'PERMISSION_DENIED');
        assert.deepEqual(
          await fs.readdir(stores.attachmentTempDir),
          [],
        );

        const unrelatedDelete = await requestJson(
          baseUrl,
          `/api/travel-groups/${group.id}/attachments/${downloadable.id}`,
          { method: 'DELETE', token: unrelatedTaster.token },
        );
        assertErrorContract(unrelatedDelete, 403, 'PERMISSION_DENIED');

        const forgedId = crypto.randomUUID();
        const forgedDownload = await downloadFile(
          baseUrl,
          admin.token,
          group.id,
          forgedId,
        );
        assert.equal(forgedDownload.response.status, 404);
        const crossGroupDownload = await downloadFile(
          baseUrl,
          admin.token,
          otherGroup.id,
          downloadable.id,
        );
        assert.equal(crossGroupDownload.response.status, 404);

        const beforeRejectedUploads = (await fs.readdir(storageRoot)).length;
        const unsupportedUpload = await uploadFiles(
          baseUrl,
          frontDesk.token,
          group.id,
          'guest_info',
          [
            {
              content: Buffer.from('executable'),
              name: 'payload.exe',
              type: 'application/octet-stream',
            },
          ],
        );
        assertErrorContract(
          unsupportedUpload,
          400,
          'UNSUPPORTED_ATTACHMENT_TYPE',
        );
        assert.equal((await fs.readdir(storageRoot)).length, beforeRejectedUploads);
        assert.deepEqual(
          await fs.readdir(stores.attachmentTempDir),
          [],
        );

        const tooManyFiles = await uploadFiles(
          baseUrl,
          frontDesk.token,
          group.id,
          'guest_info',
          Array.from({ length: 6 }, (_, index) => ({
            content: Buffer.from(`tiny-${index}`),
            name: `tiny-${index}.txt`,
            type: 'text/plain',
          })),
        );
        assertErrorContract(
          tooManyFiles,
          413,
          'TOO_MANY_ATTACHMENT_FILES',
        );
        assert.deepEqual(
          await fs.readdir(stores.attachmentTempDir),
          [],
        );

        const spoofedImage = await uploadFiles(
          baseUrl,
          frontDesk.token,
          group.id,
          'guest_info',
          [
            {
              content: Buffer.from('not-a-real-png'),
              name: 'spoofed.png',
              type: 'image/png',
            },
          ],
        );
        assertErrorContract(
          spoofedImage,
          400,
          'ATTACHMENT_CONTENT_MISMATCH',
        );
        assert.deepEqual(
          await fs.readdir(stores.attachmentTempDir),
          [],
        );

        const invalidCategory = await uploadFiles(
          baseUrl,
          admin.token,
          group.id,
          'private_files',
          [
            {
              content: Buffer.from('invalid category'),
              name: 'invalid.txt',
              type: 'text/plain',
            },
          ],
        );
        assertErrorContract(
          invalidCategory,
          400,
          'INVALID_ATTACHMENT_CATEGORY',
        );
        assert.deepEqual(
          await fs.readdir(stores.attachmentTempDir),
          [],
        );

        const maliciousAttachmentId = crypto.randomUUID();
        const sentinelPath = path.join(path.dirname(storageRoot), 'sentinel.txt');
        await fs.writeFile(sentinelPath, 'do-not-delete');
        await prisma.travelGroup.update({
          where: { id: group.id },
          data: {
            guestInfoAttachments: [
              ...rawGroup.guestInfoAttachments,
              {
                id: maliciousAttachmentId,
                category: 'guest_info',
                originalName: '../sentinel.txt',
                contentType: 'text/plain',
                size: 13,
                storageKey: '../sentinel.txt',
                uploadedById: admin.user.id,
                uploadedAt: new Date().toISOString(),
              },
            ],
          },
        });
        const traversalDownload = await downloadFile(
          baseUrl,
          admin.token,
          group.id,
          maliciousAttachmentId,
        );
        assert.equal(traversalDownload.response.status, 404);
        const traversalDelete = await requestJson(
          baseUrl,
          `/api/travel-groups/${group.id}/attachments/${maliciousAttachmentId}`,
          { method: 'DELETE', token: admin.token },
        );
        assertErrorContract(traversalDelete, 404, 'ATTACHMENT_NOT_FOUND');
        assert.equal(await fs.readFile(sentinelPath, 'utf8'), 'do-not-delete');

        const frontDeleted = keyPhotoUpload.body.data.attachments[0];
        const frontDelete = await requestJson(
          baseUrl,
          `/api/travel-groups/${group.id}/attachments/${frontDeleted.id}`,
          { method: 'DELETE', token: frontDesk.token },
        );
        assert.equal(frontDelete.response.status, 200);
        assert.equal(
          frontDelete.body.data.travelGroup.keyCustomerPhotos.some(
            (attachment) => attachment.id === frontDeleted.id,
          ),
          false,
        );

        const tasterDeleted = guestInfoUpload.body.data.attachments[0];
        const tasterDelete = await requestJson(
          baseUrl,
          `/api/travel-groups/${group.id}/attachments/${tasterDeleted.id}`,
          { method: 'DELETE', token: assignedTaster.token },
        );
        assert.equal(tasterDelete.response.status, 200);
        assert.equal(tasterDelete.body.data.travelGroup.tasterEditCount, 0);
        assert.equal(
          tasterDelete.body.data.travelGroup.tasterEditRemaining,
          null,
        );
        assert.equal(
          tasterDelete.body.data.travelGroup.tasterEditUnlimited,
          true,
        );

        await prisma.travelGroup.update({
          where: { id: group.id },
          data: { tasterEditCount: 2 },
        });
        const historicalCountUpload = await uploadFiles(
          baseUrl,
          assignedTaster.token,
          group.id,
          'guest_info',
          [
            {
              content: Buffer.from('historical-count-upload'),
              name: 'after-old-limit.txt',
              type: 'text/plain',
            },
          ],
        );
        assert.equal(historicalCountUpload.response.status, 201);
        assert.equal(
          historicalCountUpload.body.data.travelGroup.tasterEditCount,
          2,
        );
        assert.equal(
          historicalCountUpload.body.data.travelGroup.canEditByCurrentUser,
          true,
        );
        const historicalCountDelete = await requestJson(
          baseUrl,
          `/api/travel-groups/${group.id}/attachments/${historicalCountUpload.body.data.attachments[0].id}`,
          { method: 'DELETE', token: assignedTaster.token },
        );
        assert.equal(historicalCountDelete.response.status, 200);
        assert.equal(
          historicalCountDelete.body.data.travelGroup.tasterEditCount,
          2,
        );
        assert.equal(
          historicalCountDelete.body.data.travelGroup.tasterEditUnlimited,
          true,
        );

        const adminDeleted = adminUpload.body.data.attachments[0];
        const adminDelete = await requestJson(
          baseUrl,
          `/api/travel-groups/${group.id}/attachments/${adminDeleted.id}`,
          { method: 'DELETE', token: admin.token },
        );
        assert.equal(adminDelete.response.status, 200);

        const deletedDownload = await downloadFile(
          baseUrl,
          admin.token,
          group.id,
          frontDeleted.id,
        );
        assert.equal(deletedDownload.response.status, 404);
        assert.equal((await fs.readdir(storageRoot)).length, 2);

        const uploadLogs = await requestJson(
          baseUrl,
          '/api/operation-logs?action=travel_groups.attachments.upload&result=SUCCESS',
          { token: admin.token },
        );
        assert.equal(uploadLogs.response.status, 200);
        assert.equal(uploadLogs.body.data.logs.length, 4);
        assertNoStorageLocation(uploadLogs.body.data.logs);
        const deleteLogs = await requestJson(
          baseUrl,
          '/api/operation-logs?action=travel_groups.attachments.delete&result=SUCCESS',
          { token: admin.token },
        );
        assert.equal(deleteLogs.response.status, 200);
        assert.equal(deleteLogs.body.data.logs.length, 4);
        assertNoStorageLocation(deleteLogs.body.data.logs);
      },
      { env: { TRAVEL_GROUP_ATTACHMENT_DIR: storageRoot } },
    );
  });
});

test('future liaison can manage attachments while public reads and global mark filtering stay enforced', async () => {
  await withTemporaryAttachmentStorage(async (storageRoot) => {
    await withPhase1Server(
      async (baseUrl) => {
        const admin = await login(baseUrl);
        const receptionUser = await createUser(baseUrl, admin.token, {
          name: 'Future Reception Taster',
          username: 'future-reception-taster',
          password: 'Password123',
          role: 'taster',
        });
        const liaisonUser = await createUser(baseUrl, admin.token, {
          name: 'Future Liaison Taster',
          username: 'future-liaison-taster',
          password: 'Password123',
          role: 'taster',
        });
        const publicReaderUser = await createUser(baseUrl, admin.token, {
          name: 'Future Public Reader',
          username: 'future-public-reader',
          password: 'Password123',
          role: 'taster',
        });
        const liaison = await login(
          baseUrl,
          liaisonUser.username,
          'Password123',
        );
        const publicReader = await login(
          baseUrl,
          publicReaderUser.username,
          'Password123',
        );
        const group = await createTravelGroup(baseUrl, admin.token, {
          tasterId: receptionUser.id,
          liaisonTasterId: liaisonUser.id,
          visitDate: SHANGHAI_TOMORROW,
        });

        const uploaded = await uploadFiles(
          baseUrl,
          liaison.token,
          group.id,
          'guest_info',
          [
            {
              content: Buffer.from('future guest attachment'),
              name: 'future-guests.txt',
              type: 'text/plain',
            },
          ],
        );
        assert.equal(uploaded.response.status, 201);
        assert.equal(
          uploaded.body.data.travelGroup.canEditByCurrentUser,
          true,
        );
        const attachment = uploaded.body.data.attachments[0];

        const publicDownload = await downloadFile(
          baseUrl,
          publicReader.token,
          group.id,
          attachment.id,
        );
        assert.equal(publicDownload.response.status, 200);
        assert.deepEqual(
          publicDownload.buffer,
          Buffer.from('future guest attachment'),
        );

        await requestJson(
          baseUrl,
          '/api/settings/global-mark-query/enable',
          {
            method: 'POST',
            token: admin.token,
          },
        );

        const hiddenDetail = await requestJson(
          baseUrl,
          `/api/travel-groups/${group.id}`,
          { token: liaison.token },
        );
        assertErrorContract(
          hiddenDetail,
          404,
          'TRAVEL_GROUP_NOT_FOUND',
        );
        const hiddenDownload = await downloadFile(
          baseUrl,
          liaison.token,
          group.id,
          attachment.id,
        );
        assert.equal(hiddenDownload.response.status, 404);
        const hiddenUpload = await uploadFiles(
          baseUrl,
          liaison.token,
          group.id,
          'guest_info',
          [
            {
              content: Buffer.from('must stay hidden'),
              name: 'hidden.txt',
              type: 'text/plain',
            },
          ],
        );
        assertErrorContract(
          hiddenUpload,
          404,
          'TRAVEL_GROUP_NOT_FOUND',
        );
        const hiddenDelete = await requestJson(
          baseUrl,
          `/api/travel-groups/${group.id}/attachments/${attachment.id}`,
          { method: 'DELETE', token: liaison.token },
        );
        assertErrorContract(
          hiddenDelete,
          404,
          'TRAVEL_GROUP_NOT_FOUND',
        );

        await requestJson(
          baseUrl,
          '/api/settings/global-mark-query/restore',
          {
            method: 'POST',
            token: admin.token,
          },
        );
        const deleted = await requestJson(
          baseUrl,
          `/api/travel-groups/${group.id}/attachments/${attachment.id}`,
          { method: 'DELETE', token: liaison.token },
        );
        assert.equal(deleted.response.status, 200);
        assert.equal(
          deleted.body.data.travelGroup.canEditByCurrentUser,
          true,
        );
      },
      { env: { TRAVEL_GROUP_ATTACHMENT_DIR: storageRoot } },
    );
  });
});

test('completed sales supplement blocks assigned taster attachment upload and deletion', async () => {
  await withTemporaryAttachmentStorage(async (storageRoot) => {
    await withPhase1Server(
      async (baseUrl) => {
        const admin = await login(baseUrl);
        const tasterUser = await createUser(baseUrl, admin.token, {
          name: 'Closed Attachment Taster',
          username: 'closed-attachment-taster',
          password: 'Password123',
          role: 'taster',
        });
        const salesUser = await createUser(baseUrl, admin.token, {
          name: 'Closed Attachment Sales',
          username: 'closed-attachment-sales',
          password: 'Password123',
          role: 'sales',
        });
        const taster = await login(
          baseUrl,
          tasterUser.username,
          'Password123',
        );
        const sales = await login(
          baseUrl,
          salesUser.username,
          'Password123',
        );
        const group = await createTravelGroup(baseUrl, admin.token, {
          tasterId: tasterUser.id,
          visitDate: SHANGHAI_TODAY,
        });

        const initialUpload = await uploadFiles(
          baseUrl,
          taster.token,
          group.id,
          'guest_info',
          [
            {
              content: Buffer.from('kept after supplement closes'),
              name: 'kept.txt',
              type: 'text/plain',
            },
          ],
        );
        assert.equal(initialUpload.response.status, 201);
        const attachment = initialUpload.body.data.attachments[0];

        const salesCompletion = await requestJson(
          baseUrl,
          `/api/travel-groups/${group.id}`,
          {
            method: 'PATCH',
            token: sales.token,
            body: {
              departureTime: '16:30',
              lossStatus: 'NO_LOSS',
            },
          },
        );
        assert.equal(salesCompletion.response.status, 200);

        const detail = await requestJson(
          baseUrl,
          `/api/travel-groups/${group.id}`,
          { token: taster.token },
        );
        assert.equal(detail.response.status, 200);
        assert.equal(
          detail.body.data.travelGroup.canEditByCurrentUser,
          false,
        );

        const blockedUpload = await uploadFiles(
          baseUrl,
          taster.token,
          group.id,
          'guest_info',
          [
            {
              content: Buffer.from('must not be stored'),
              name: 'blocked.txt',
              type: 'text/plain',
            },
          ],
        );
        assertErrorContract(
          blockedUpload,
          403,
          'TRAVEL_GROUP_TASTER_EDIT_CLOSED',
        );

        const blockedDelete = await requestJson(
          baseUrl,
          `/api/travel-groups/${group.id}/attachments/${attachment.id}`,
          { method: 'DELETE', token: taster.token },
        );
        assertErrorContract(
          blockedDelete,
          403,
          'TRAVEL_GROUP_TASTER_EDIT_CLOSED',
        );

        const retainedDownload = await downloadFile(
          baseUrl,
          taster.token,
          group.id,
          attachment.id,
        );
        assert.equal(retainedDownload.response.status, 200);
        assert.deepEqual(
          retainedDownload.buffer,
          Buffer.from('kept after supplement closes'),
        );
      },
      { env: { TRAVEL_GROUP_ATTACHMENT_DIR: storageRoot } },
    );
  });
});

test('travel group attachment upload removes the physical file when metadata persistence fails', async () => {
  await withTemporaryAttachmentStorage(async (storageRoot) => {
    await withPhase1Server(
      async (baseUrl, { stores }) => {
        const admin = await login(baseUrl);
        const taster = await createUser(baseUrl, admin.token, {
          name: 'Attachment Failure Taster',
          username: 'attachment-failure-taster',
          password: 'Password123',
          role: 'taster',
        });
        const tasterSession = await login(
          baseUrl,
          taster.username,
          'Password123',
        );
        const group = await createTravelGroup(baseUrl, admin.token, {
          tasterId: taster.id,
          visitDate: SHANGHAI_TODAY,
        });

        const failedUpload = await uploadFiles(
          baseUrl,
          tasterSession.token,
          group.id,
          'guest_info',
          [
            {
              content: Buffer.from('cleanup-me'),
              name: 'cleanup.txt',
              type: 'text/plain',
            },
          ],
        );
        assertErrorContract(failedUpload, 500, 'INTERNAL_ERROR');
        assert.deepEqual(await fs.readdir(storageRoot), []);
        assert.deepEqual(
          await fs.readdir(stores.attachmentTempDir),
          [],
        );

        const detail = await requestJson(
          baseUrl,
          `/api/travel-groups/${group.id}`,
          { token: admin.token },
        );
        assert.equal(detail.response.status, 200);
        assert.equal(detail.body.data.travelGroup.guestInfoAttachments, null);
        assert.equal(detail.body.data.travelGroup.tasterEditCount, 0);
      },
      {
        env: { TRAVEL_GROUP_ATTACHMENT_DIR: storageRoot },
        prisma: { failTravelGroupUpdateOnce: true },
      },
    );
  });
});

async function createTravelGroup(baseUrl, token, overrides = {}) {
  const suffix = crypto.randomUUID().slice(0, 8);
  const guideResult = await requestJson(baseUrl, '/api/guides', {
    method: 'POST',
    token,
    body: {
      name: `Attachment Guide ${suffix}`,
      phone: `139${String(Date.now()).slice(-8)}${suffix.slice(0, 2)}`.slice(0, 11),
      travelAgency: `Attachment Agency ${suffix}`,
    },
  });
  assert.equal(guideResult.response.status, 201);
  const result = await requestJson(baseUrl, '/api/travel-groups', {
    method: 'POST',
    token,
    body: {
      visitDate: overrides.visitDate || '2026-07-15',
      travelAgency: `Attachment Agency ${suffix}`,
      guideId: guideResult.body.data.guide.id,
      cigaretteFeeCents: 100,
      tasterId: overrides.tasterId,
      liaisonTasterId: overrides.liaisonTasterId,
    },
  });
  assert.equal(result.response.status, 201);
  return result.body.data.travelGroup;
}

async function uploadFiles(baseUrl, token, groupId, category, files) {
  const form = new FormData();
  for (const file of files) {
    form.append(
      'files',
      new Blob([file.content], { type: file.type }),
      file.name,
    );
  }
  const response = await fetch(
    `${baseUrl}/api/travel-groups/${groupId}/attachments/${category}`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    },
  );
  return { response, body: await response.json() };
}

async function requestMalformedMultipart(baseUrl, pathName, token) {
  const headers = {
    'Content-Type': 'multipart/form-data; boundary=security-test',
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  const response = await fetch(`${baseUrl}${pathName}`, {
    method: 'POST',
    headers,
    body: Buffer.from('--security-test\r\nbroken'),
  });
  return {
    response,
    body: await response.json(),
  };
}

async function downloadFile(baseUrl, token, groupId, attachmentId) {
  const response = await fetch(
    `${baseUrl}/api/travel-groups/${groupId}/attachments/${attachmentId}/download`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  return { response, buffer: Buffer.from(await response.arrayBuffer()) };
}

function attachmentFixtureForType(contentType) {
  switch (contentType) {
    case 'image/jpeg':
      return Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
    case 'image/png':
      return Buffer.from([
        0x89,
        0x50,
        0x4e,
        0x47,
        0x0d,
        0x0a,
        0x1a,
        0x0a,
        0x00,
      ]);
    case 'application/pdf':
      return validPdfFixture();
    default:
      return Buffer.from('test');
  }
}

function validPdfFixture() {
  return Buffer.from(
    '%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n' +
      'trailer\n<< /Root 1 0 R >>\nstartxref\n9\n%%EOF\n',
  );
}

function validOleFixture() {
  const buffer = Buffer.alloc(512);
  Buffer.from([
    0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1,
  ]).copy(buffer);
  return buffer;
}

async function validOpenXmlFixture(kind) {
  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    kind === 'docx'
      ? '<Types><Override PartName="/word/document.xml" /></Types>'
      : '<Types><Override PartName="/xl/workbook.xml" /></Types>',
  );
  if (kind === 'docx') {
    zip.file('word/document.xml', '<document />');
  } else {
    zip.file('xl/workbook.xml', '<workbook />');
  }
  return zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
  });
}

function assertSafeAttachmentDto(attachment, expectedCategory) {
  assert.deepEqual(Object.keys(attachment).sort(), [
    'category',
    'contentType',
    'id',
    'originalName',
    'size',
    'uploadedAt',
    'uploadedById',
  ]);
  assert.match(attachment.id, UUID_PATTERN);
  assert.equal(attachment.category, expectedCategory);
  assert.equal(typeof attachment.originalName, 'string');
  assert.equal(typeof attachment.contentType, 'string');
  assert.equal(typeof attachment.size, 'number');
  assert.equal(typeof attachment.uploadedById, 'string');
  assert.doesNotThrow(() => new Date(attachment.uploadedAt).toISOString());
}

function assertNoStorageLocation(value) {
  const serialized = JSON.stringify(value);
  assert.equal(serialized.includes('storageKey'), false);
  assert.equal(serialized.includes('storagePath'), false);
  assert.equal(serialized.includes(storagePathMarker()), false);
}

function storagePathMarker() {
  return 'travel-group-attachments';
}

async function withTemporaryAttachmentStorage(run) {
  const tempParent = await fs.mkdtemp(
    path.join(os.tmpdir(), 'jiangjiu-travel-group-attachments-'),
  );
  const storageRoot = path.join(tempParent, 'private-storage');
  try {
    await run(storageRoot);
  } finally {
    await fs.rm(tempParent, { force: true, recursive: true });
  }
}
