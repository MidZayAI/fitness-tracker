// The on-phone database, plus backup and restore.

const db = new Dexie('fitness-tracker');
db.version(1).stores({
  foods: 'key, lastUsed',
  entries: '++id, date',
  targets: 'startDate',
  settings: 'key',
});

const BACKUP_APP_ID = 'fitness-tracker';
const BACKUP_SCHEMA_VERSION = 1;
const PRIVATE_SETTINGS = ['usdaKey']; // Stays on this phone and is never written to backup files.

async function getSetting(key, fallback = null) {
  const row = await db.settings.get(key);
  return row ? row.value : fallback;
}

function setSetting(key, value) {
  return db.settings.put({ key, value });
}

// The targets for a day are the most recent ones set on or before it.
// Days before your first targets use those first targets.
async function targetsForDate(date) {
  const row = await db.targets.where('startDate').belowOrEqual(date).last();
  return row || db.targets.orderBy('startDate').first();
}

async function createBackup() {
  const [foods, entries, targets, settings] = await Promise.all([
    db.foods.toArray(),
    db.entries.toArray(),
    db.targets.toArray(),
    db.settings.toArray(),
  ]);
  return {
    app: BACKUP_APP_ID,
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    data: {
      foods,
      entries,
      targets,
      settings: settings.filter((s) => !PRIVATE_SETTINGS.includes(s.key)),
    },
  };
}

function isValidNutrients(n) {
  return !!n && ['kcal', 'protein', 'carbs', 'fat'].every((k) => Number.isFinite(n[k]) && n[k] >= 0);
}

function isValidFood(food) {
  return !!food
    && typeof food.name === 'string'
    && isValidNutrients(food.nutrients)
    && Array.isArray(food.portions)
    && food.portions.length > 0
    && food.portions.every((p) => typeof p.label === 'string' && Number.isFinite(p.factor) && p.factor > 0);
}

function isValidEntry(e) {
  return /^\d{4}-\d{2}-\d{2}$/.test(e.date)
    && MEALS.some((m) => m.id === e.meal)
    && Number.isFinite(e.qty) && e.qty > 0
    && Number.isInteger(e.portionIndex)
    && isValidFood(e.food)
    && e.portionIndex >= 0 && e.portionIndex < e.food.portions.length;
}

function isValidTarget(t) {
  return /^\d{4}-\d{2}-\d{2}$/.test(t.startDate) && isValidNutrients(t);
}

// Throws a readable message if the file isn't a backup this app can safely load.
function validateBackup(backup) {
  if (!backup || backup.app !== BACKUP_APP_ID || !backup.data) {
    throw new Error('This file is not a Fitness Tracker backup.');
  }
  if (backup.schemaVersion > BACKUP_SCHEMA_VERSION) {
    throw new Error('This backup came from a newer version of the app. Update the app and try again.');
  }
  const { foods, entries, targets, settings } = backup.data;
  const valid = Array.isArray(foods) && foods.every((f) => typeof f.key === 'string' && isValidFood(f))
    && Array.isArray(entries) && entries.every(isValidEntry)
    && Array.isArray(targets) && targets.every(isValidTarget)
    && Array.isArray(settings) && settings.every((s) => typeof s.key === 'string');
  if (!valid) throw new Error('This backup file is damaged, so nothing was changed.');
  return { foods: foods.length, entries: entries.length, targets: targets.length };
}

// Runs as one transaction: if anything fails, your existing data stays exactly as it was.
async function restoreBackup(backup) {
  validateBackup(backup);
  const { foods, entries, targets, settings } = backup.data;
  await db.transaction('rw', db.foods, db.entries, db.targets, db.settings, async () => {
    const kept = await db.settings.where('key').anyOf(PRIVATE_SETTINGS).toArray();
    await Promise.all([db.foods.clear(), db.entries.clear(), db.targets.clear(), db.settings.clear()]);
    await db.foods.bulkAdd(foods);
    await db.entries.bulkAdd(entries);
    await db.targets.bulkAdd(targets);
    await db.settings.bulkAdd(settings.filter((s) => !PRIVATE_SETTINGS.includes(s.key)));
    await db.settings.bulkPut(kept);
    await db.settings.put({ key: 'lastBackupAt', value: Date.parse(backup.exportedAt) || Date.now() });
  });
}
