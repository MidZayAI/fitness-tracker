// The on-phone database, plus backup and restore.

const db = new Dexie('fitness-tracker');
db.version(1).stores({
  foods: 'key, lastUsed',
  entries: '++id, date',
  targets: 'startDate',
  settings: 'key',
});
// Stage 2 only adds tables, so everything already logged is kept.
db.version(2).stores({
  exercises: 'id',
  workouts: 'id',
  sessions: '++id, date, status',
  cardio: '++id, date',
});

const BACKUP_APP_ID = 'fitness-tracker';
const BACKUP_SCHEMA_VERSION = 2;
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

// Adds your starter program the first time, and after restoring a backup from before workouts existed.
async function ensureProgram() {
  if ((await db.workouts.count()) === 0) await db.workouts.bulkAdd(plainCopy(STARTER_WORKOUTS));
  if (!(await getSetting('schedule'))) await setSetting('schedule', makeSchedule(STARTER_DAYS, localDate()));
}

function plainCopy(value) {
  return JSON.parse(JSON.stringify(value));
}

async function createBackup() {
  const [foods, entries, targets, settings, exercises, workouts, sessions, cardio] = await Promise.all([
    db.foods.toArray(),
    db.entries.toArray(),
    db.targets.toArray(),
    db.settings.toArray(),
    db.exercises.toArray(),
    db.workouts.toArray(),
    db.sessions.toArray(),
    db.cardio.toArray(),
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
      exercises,
      workouts,
      sessions,
      cardio,
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

function isValidDateText(date) {
  return /^\d{4}-\d{2}-\d{2}$/.test(date);
}

function isValidExercise(e) {
  return typeof e.id === 'string' && typeof e.name === 'string' && EXERCISE_KINDS.some((k) => k.id === e.kind);
}

function isValidWorkout(w) {
  return typeof w.id === 'string'
    && typeof w.name === 'string'
    && Array.isArray(w.exercises)
    && w.exercises.every((x) => typeof x.exerciseId === 'string'
      && [x.sets, x.repMin, x.repMax, x.restSec].every(Number.isFinite));
}

function isValidSession(s) {
  return isValidDateText(s.date)
    && (s.status === 'active' || s.status === 'done')
    && (s.unit === 'lb' || s.unit === 'kg')
    && Array.isArray(s.items)
    && s.items.every((i) => typeof i.exerciseId === 'string' && typeof i.name === 'string' && Array.isArray(i.sets));
}

function isValidCardio(c) {
  return isValidDateText(c.date) && typeof c.type === 'string' && Number.isFinite(c.minutes) && c.minutes > 0;
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
  // Backups made before Stage 2 have no workout tables, which is fine.
  const { exercises = [], workouts = [], sessions = [], cardio = [] } = backup.data;
  const valid = Array.isArray(foods) && foods.every((f) => typeof f.key === 'string' && isValidFood(f))
    && Array.isArray(entries) && entries.every(isValidEntry)
    && Array.isArray(targets) && targets.every(isValidTarget)
    && Array.isArray(settings) && settings.every((s) => typeof s.key === 'string')
    && Array.isArray(exercises) && exercises.every(isValidExercise)
    && Array.isArray(workouts) && workouts.every(isValidWorkout)
    && Array.isArray(sessions) && sessions.every(isValidSession)
    && Array.isArray(cardio) && cardio.every(isValidCardio);
  if (!valid) throw new Error('This backup file is damaged, so nothing was changed.');
  return {
    foods: foods.length,
    entries: entries.length,
    targets: targets.length,
    sessions: sessions.length,
    cardio: cardio.length,
  };
}

// Runs as one transaction: if anything fails, your existing data stays exactly as it was.
async function restoreBackup(backup) {
  validateBackup(backup);
  const { foods, entries, targets, settings } = backup.data;
  const { exercises = [], workouts = [], sessions = [], cardio = [] } = backup.data;
  await db.transaction('rw', db.tables, async () => {
    const kept = await db.settings.where('key').anyOf(PRIVATE_SETTINGS).toArray();
    await Promise.all(db.tables.map((table) => table.clear()));
    await db.exercises.bulkAdd(exercises);
    await db.workouts.bulkAdd(workouts);
    await db.sessions.bulkAdd(sessions);
    await db.cardio.bulkAdd(cardio);
    await db.foods.bulkAdd(foods);
    await db.entries.bulkAdd(entries);
    await db.targets.bulkAdd(targets);
    await db.settings.bulkAdd(settings.filter((s) => !PRIVATE_SETTINGS.includes(s.key)));
    await db.settings.bulkPut(kept);
    await db.settings.put({ key: 'lastBackupAt', value: Date.parse(backup.exportedAt) || Date.now() });
  });
}
