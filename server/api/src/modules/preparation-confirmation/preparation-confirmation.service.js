const {
  CHECKLIST_ITEMS,
  ITEM_CATEGORIES,
  ITEM_STATUSES,
} = require('./preparation-confirmation.items');
const {
  createPreparationConfirmationRepository,
} = require('./preparation-confirmation.repository');

function createPreparationConfirmationService(repository = createPreparationConfirmationRepository()) {
  return {
    listItems(filters = {}) {
      validateListFilters(filters);
      return getMergedItems(repository.readState()).filter((item) => {
        if (filters.status && item.status !== filters.status) {
          return false;
        }
        if (filters.category && item.category !== filters.category) {
          return false;
        }
        return true;
      });
    },

    getSummary() {
      const items = getMergedItems(repository.readState());
      const counts = ITEM_STATUSES.reduce((summary, status) => {
        summary[status] = items.filter((item) => item.status === status).length;
        return summary;
      }, {});

      const confirmed = counts.confirmed || 0;
      const total = items.length;

      return {
        total,
        confirmed,
        pending: counts.pending || 0,
        inReview: counts.in_review || 0,
        blocked: counts.blocked || 0,
        progressPercent: total === 0 ? 0 : Math.round((confirmed / total) * 100),
        readyForNextStage: total > 0 && confirmed === total,
        blockers: items
          .filter((item) => item.status === 'blocked')
          .map((item) => toSummaryItem(item)),
        nextRequiredItems: items
          .filter((item) => item.status !== 'confirmed')
          .map((item) => toSummaryItem(item)),
      };
    },

    updateItem(id, patch) {
      const definition = CHECKLIST_ITEMS.find((item) => item.id === id);
      if (!definition) {
        throw createHttpError(404, 'ITEM_NOT_FOUND', `Preparation confirmation item "${id}" does not exist.`);
      }

      validateUpdatePatch(patch);

      const state = repository.readState();
      const current = state.items[id];
      const nextStatus = patch.status || current.status;
      const updatedAt = new Date().toISOString();

      state.items[id] = {
        status: nextStatus,
        owner: pickStringOrNull(patch.owner, current.owner),
        notes: pickString(patch.notes, current.notes),
        evidenceLinks: Array.isArray(patch.evidenceLinks)
          ? patch.evidenceLinks.map((link) => String(link).trim()).filter(Boolean)
          : current.evidenceLinks,
        confirmedBy: nextStatus === 'confirmed'
          ? pickStringOrNull(patch.confirmedBy, current.confirmedBy)
          : null,
        confirmedAt: nextStatus === 'confirmed'
          ? patch.confirmedAt || current.confirmedAt || updatedAt
          : null,
        updatedAt,
      };

      if (nextStatus === 'confirmed' && !state.items[id].confirmedBy) {
        throw createHttpError(400, 'CONFIRMED_BY_REQUIRED', 'confirmedBy is required when status is confirmed.');
      }

      repository.writeState(state);
      return getMergedItems(state).find((item) => item.id === id);
    },
  };
}

function getMergedItems(state) {
  return CHECKLIST_ITEMS.map((definition) => ({
    ...definition,
    ...state.items[definition.id],
  }));
}

function validateListFilters(filters) {
  if (filters.status && !ITEM_STATUSES.includes(filters.status)) {
    throw createHttpError(400, 'INVALID_STATUS', `status must be one of: ${ITEM_STATUSES.join(', ')}.`);
  }
  if (filters.category && !ITEM_CATEGORIES.includes(filters.category)) {
    throw createHttpError(400, 'INVALID_CATEGORY', `category must be one of: ${ITEM_CATEGORIES.join(', ')}.`);
  }
}

function validateUpdatePatch(patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    throw createHttpError(400, 'INVALID_BODY', 'Request body must be a JSON object.');
  }
  if (patch.status && !ITEM_STATUSES.includes(patch.status)) {
    throw createHttpError(400, 'INVALID_STATUS', `status must be one of: ${ITEM_STATUSES.join(', ')}.`);
  }
  if (patch.evidenceLinks && !Array.isArray(patch.evidenceLinks)) {
    throw createHttpError(400, 'INVALID_EVIDENCE_LINKS', 'evidenceLinks must be an array of strings.');
  }
}

function toSummaryItem(item) {
  return {
    id: item.id,
    title: item.title,
    category: item.category,
    status: item.status,
    owner: item.owner,
  };
}

function pickString(value, fallback) {
  if (value === undefined) {
    return fallback;
  }
  return String(value).trim();
}

function pickStringOrNull(value, fallback) {
  if (value === undefined) {
    return fallback;
  }
  const text = String(value).trim();
  return text || null;
}

function createHttpError(statusCode, code, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

module.exports = {
  createPreparationConfirmationService,
  createHttpError,
};
