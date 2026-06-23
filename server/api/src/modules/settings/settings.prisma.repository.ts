const SETTING_KEYS = {
  onlyShowMarkedRecords: 'only_show_marked_records',
  restoreRequired: 'marked_records_restore_required',
  openedBy: 'global_mark_query_opened_by',
  openedAt: 'global_mark_query_opened_at',
  restoredBy: 'global_mark_query_restored_by',
  restoredAt: 'global_mark_query_restored_at',
  updatedAt: 'global_mark_query_updated_at',
};

export function createPrismaSystemSettingsRepository(prisma: any) {
  return {
    async getGlobalMarkQuery() {
      const settings = await prisma.systemSetting.findMany({
        where: {
          settingKey: {
            in: Object.values(SETTING_KEYS),
          },
        },
      });
      const values = Object.fromEntries(settings.map((item: any) => [item.settingKey, item.settingValue]));

      return {
        onlyShowMarkedRecords: values[SETTING_KEYS.onlyShowMarkedRecords] === 'true',
        restoreRequired: values[SETTING_KEYS.restoreRequired] === 'true',
        openedBy: nonEmptyOrNull(values[SETTING_KEYS.openedBy]),
        openedAt: nonEmptyOrNull(values[SETTING_KEYS.openedAt]),
        restoredBy: nonEmptyOrNull(values[SETTING_KEYS.restoredBy]),
        restoredAt: nonEmptyOrNull(values[SETTING_KEYS.restoredAt]),
        updatedAt: nonEmptyOrNull(values[SETTING_KEYS.updatedAt]),
      };
    },

    async saveGlobalMarkQuery(settings: any) {
      const updatedBy = settings.restoredBy || settings.openedBy || null;
      const updates = [
        [SETTING_KEYS.onlyShowMarkedRecords, String(Boolean(settings.onlyShowMarkedRecords))],
        [SETTING_KEYS.restoreRequired, String(Boolean(settings.restoreRequired))],
        [SETTING_KEYS.openedBy, settings.openedBy || ''],
        [SETTING_KEYS.openedAt, settings.openedAt || ''],
        [SETTING_KEYS.restoredBy, settings.restoredBy || ''],
        [SETTING_KEYS.restoredAt, settings.restoredAt || ''],
        [SETTING_KEYS.updatedAt, settings.updatedAt || new Date().toISOString()],
      ];

      await prisma.$transaction(
        updates.map(([settingKey, settingValue]) =>
          prisma.systemSetting.upsert({
            where: {
              settingKey,
            },
            update: {
              settingValue,
              updatedBy,
              updatedAt: new Date(),
            },
            create: {
              settingKey,
              settingValue,
              updatedBy,
              updatedAt: new Date(),
            },
          }),
        ),
      );

      return this.getGlobalMarkQuery();
    },
  };
}

function nonEmptyOrNull(value: unknown) {
  const text = value === undefined || value === null ? '' : String(value).trim();
  return text || null;
}
