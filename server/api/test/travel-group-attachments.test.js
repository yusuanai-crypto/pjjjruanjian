const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  assertErrorContract,
  createUser,
  login,
  requestJson,
  withPhase1Server,
} = require('./helpers/phase1-api');
const {
  isSafeAttachmentStorageKey,
  sanitizeAttachmentOriginalName,
  validateTravelGroupAttachmentFile,
} = require('../src/modules/business-data/travel-group-attachment-storage.helper');

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

test('travel group attachment type and path validation accepts supported documents and rejects unsafe input', () => {
  const supported = [
    ['photo.jpg', 'image/jpeg'],
    ['document.pdf', 'application/pdf'],
    ['document.doc', 'application/msword'],
    [
      'document.docx',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ],
    ['sheet.xls', 'application/vnd.ms-excel'],
    [
      'sheet.xlsx',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ],
    ['sheet.csv', 'text/csv'],
    ['notes.txt', 'text/plain'],
  ];

  for (const [originalname, mimetype] of supported) {
    const buffer = Buffer.from('test');
    const validated = validateTravelGroupAttachmentFile({
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
  assert.throws(
    () =>
      validateTravelGroupAttachmentFile({
        buffer: Buffer.from('malware'),
        mimetype: 'application/octet-stream',
        originalname: 'malware.exe',
        size: 7,
      }),
    (error) => error?.code === 'UNSUPPORTED_ATTACHMENT_TYPE',
  );
});

test('travel group attachments upload, authorize download, delete, sanitize DTOs, and log mutations', async () => {
  await withTemporaryAttachmentStorage(async (storageRoot) => {
    await withPhase1Server(
      async (baseUrl, { prisma }) => {
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
          visitDate: '2026-07-15',
        });
        const otherGroup = await createTravelGroup(baseUrl, admin.token, {
          tasterId: unrelatedTasterUser.id,
          visitDate: '2026-07-16',
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
              content: Buffer.from('%PDF-test'),
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
              content: Buffer.from('admin-photo'),
              name: 'admin-photo.png',
              type: 'image/png',
            },
          ],
        );
        assert.equal(adminUpload.response.status, 201);

        const rawGroup = await prisma.travelGroup.findUnique({
          where: { id: group.id },
        });
        assert.equal(rawGroup.keyCustomerPhotos.length, 3);
        assert.equal(rawGroup.guestInfoAttachments.length, 2);
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
        assert.deepEqual(unrelatedTasterDownload.buffer, Buffer.from('%PDF-test'));
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
        assert.equal(scopedSalesDownload.response.status, 404);

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

        const oversizedUpload = await uploadFiles(
          baseUrl,
          frontDesk.token,
          group.id,
          'guest_info',
          [
            {
              content: Buffer.alloc(20 * 1024 * 1024 + 1, 1),
              name: 'too-large.txt',
              type: 'text/plain',
            },
          ],
        );
        assertErrorContract(oversizedUpload, 413, 'FILE_TOO_LARGE');
        assert.equal((await fs.readdir(storageRoot)).length, beforeRejectedUploads);

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
          '/api/operation-logs?action=travel_groups.attachments.upload',
          { token: admin.token },
        );
        assert.equal(uploadLogs.response.status, 200);
        assert.equal(uploadLogs.body.data.logs.length, 3);
        assertNoStorageLocation(uploadLogs.body.data.logs);
        const deleteLogs = await requestJson(
          baseUrl,
          '/api/operation-logs?action=travel_groups.attachments.delete',
          { token: admin.token },
        );
        assert.equal(deleteLogs.response.status, 200);
        assert.equal(deleteLogs.body.data.logs.length, 3);
        assertNoStorageLocation(deleteLogs.body.data.logs);
      },
      { env: { TRAVEL_GROUP_ATTACHMENT_DIR: storageRoot } },
    );
  });
});

test('travel group attachment upload removes the physical file when metadata persistence fails', async () => {
  await withTemporaryAttachmentStorage(async (storageRoot) => {
    await withPhase1Server(
      async (baseUrl) => {
        const admin = await login(baseUrl);
        const taster = await createUser(baseUrl, admin.token, {
          name: 'Attachment Failure Taster',
          username: 'attachment-failure-taster',
          password: 'Password123',
          role: 'taster',
        });
        const group = await createTravelGroup(baseUrl, admin.token, {
          tasterId: taster.id,
          visitDate: '2026-07-20',
        });

        const failedUpload = await uploadFiles(
          baseUrl,
          admin.token,
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

        const detail = await requestJson(
          baseUrl,
          `/api/travel-groups/${group.id}`,
          { token: admin.token },
        );
        assert.equal(detail.response.status, 200);
        assert.equal(detail.body.data.travelGroup.guestInfoAttachments, null);
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

async function downloadFile(baseUrl, token, groupId, attachmentId) {
  const response = await fetch(
    `${baseUrl}/api/travel-groups/${groupId}/attachments/${attachmentId}/download`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  return { response, buffer: Buffer.from(await response.arrayBuffer()) };
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
