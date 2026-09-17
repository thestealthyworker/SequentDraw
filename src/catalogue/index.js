// Read-only access to SequentDraw's integration catalogue. The data and its
// licensing rules live in ./integrations.js; the category set in
// ./categories.js. The catalogue is never ranked: entries come back in
// category order, then in the order they are written.

const { INTEGRATIONS } = require('./integrations');
const { CATEGORIES } = require('./categories');

const ENTRY_KEYS = Object.freeze(['id', 'name', 'category', 'description', 'icon']);
const MAX_DESCRIPTION_LENGTH = 120;
const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function isCategory(name) {
  return CATEGORIES.includes(name);
}

// All entries, or only those in `category`. Returns a new array each call so
// callers cannot reorder the shared list.
function listIntegrations(category) {
  const order = new Map(CATEGORIES.map((c, i) => [c, i]));
  return INTEGRATIONS
    .filter(entry => category == null || entry.category === category)
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => order.get(a.entry.category) - order.get(b.entry.category) || a.index - b.index)
    .map(({ entry }) => entry);
}

function getIntegration(id) {
  return INTEGRATIONS.find(entry => entry.id === id) || null;
}

module.exports = {
  CATEGORIES,
  ENTRY_KEYS,
  ID_PATTERN,
  MAX_DESCRIPTION_LENGTH,
  isCategory,
  listIntegrations,
  getIntegration,
};
