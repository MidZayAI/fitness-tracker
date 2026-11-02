// Pure workout calculations: the schedule, weight progression, and building a session.
// Nothing in this file touches the database or the screen.

function weekdayIndex(date) {
  return (parseLocalDate(date).getDay() + 6) % 7;
}

function mondayOf(date) {
  return addDays(date, -weekdayIndex(date));
}

function daysBetween(from, to) {
  return Math.round((parseLocalDate(to) - parseLocalDate(from)) / (24 * 60 * 60 * 1000));
}

function weekDates(date) {
  const monday = mondayOf(date);
  return WEEKDAY_LABELS.map((label, i) => ({ label, date: addDays(monday, i) }));
}

function nextScheduledDate(from, days) {
  for (let i = 0; i < 7; i++) {
    const date = addDays(from, i);
    if (days.includes(weekdayIndex(date))) return date;
  }
  return null;
}

// `startIndex` is the place in the rotation that belongs to the `anchor` date.
function makeSchedule(days, from, startIndex = 0) {
  const sorted = [...days].sort((a, b) => a - b);
  return { days: sorted, anchor: nextScheduledDate(from, sorted), startIndex };
}

// Counts training days from the anchor, so 3 days a week gives A/B/A then B/A/B.
// Returns the place in the rotation, or null on a rest day.
function rotationIndex(date, schedule, workoutCount) {
  const { days, anchor, startIndex } = schedule;
  const dayPosition = days.indexOf(weekdayIndex(date));
  if (dayPosition < 0) return null;
  const weeks = Math.round(daysBetween(mondayOf(anchor), mondayOf(date)) / 7);
  const count = weeks * days.length + dayPosition - days.indexOf(weekdayIndex(anchor)) + startIndex;
  return ((count % workoutCount) + workoutCount) % workoutCount;
}

function convertWeight(weight, from, to) {
  if (from === to || weight === '' || weight === null || weight === undefined) return weight;
  const converted = from === 'kg' ? kgToLb(weight) : lbToKg(weight);
  return Math.round(converted * 2) / 2;
}

function isLoggedSet(set, kind) {
  const hasReps = Number.isFinite(set.reps) && set.reps > 0;
  const hasWeight = kind === 'bodyweight' || (Number.isFinite(set.weight) && set.weight >= 0);
  return !!set.done && hasReps && hasWeight;
}

// How much to add when you're ready to go up, in the unit you lift in.
function nextWeight(weight, kind, unit) {
  const steps = {
    dumbbell: { lb: 5, kg: 2 },
    barbell: { lb: 5, kg: 2.5 },
    barbellPress: { lb: 2.5, kg: 1.25 },
    machine: { lb: 5, kg: 2.5 },
  };
  return weight + steps[kind][unit];
}

function goUpText(next, kind, unit) {
  const amount = `${formatAmount(next)} ${unit}`;
  if (kind === 'dumbbell') return `try the next dumbbell size, about ${amount}`;
  if (kind === 'barbell') return `add ${unit === 'lb' ? '5–10 lb' : '2.5–5 kg'}, so try ${amount}`;
  if (kind === 'barbellPress') return `add ${unit === 'lb' ? '2.5–5 lb' : '1.25–2.5 kg'}, so try ${amount}`;
  return `try the next step up, about ${amount}`;
}

// Decides what to do next time from the sets you logged last time.
// up: every planned set reached the top of the rep range at one weight.
// stay: at least one set fell short of the bottom of the range.
// build: in range, so keep the weight and add reps.
function progressionAdvice(sets, plan, kind, unit) {
  if (!sets.length) return null;
  const { repMin, repMax } = plan;
  const reachedTop = sets.length >= plan.sets && sets.every((s) => s.reps >= repMax);
  const sameWeight = sets.every((s) => s.weight === sets[0].weight);

  if (kind === 'bodyweight') {
    if (reachedTop) return { status: 'up', message: 'You reached the top of the range. If your form felt solid, add reps or a little weight.' };
    return { status: 'build', message: `Keep going and add a rep where you can, up to ${repMax} on every set.` };
  }
  if (reachedTop && sameWeight) {
    const next = nextWeight(sets[0].weight, kind, unit);
    return {
      status: 'up',
      suggestedWeight: next,
      message: `Ready to go up! If your form felt solid, ${goUpText(next, kind, unit)}.`,
    };
  }
  if (sets.some((s) => s.reps < repMin)) {
    return {
      status: 'stay',
      message: `Stay at this weight until every set reaches at least ${repMin} reps. Repeating a weight is normal, especially while eating less.`,
    };
  }
  return { status: 'build', message: `Keep this weight and add a rep where you can. Go up once every set reaches ${repMax}.` };
}

// Finds the most recent finished session that logged this exercise.
function findPreviousSets(exerciseId, sessions, unit) {
  const finished = sessions
    .filter((s) => s.status === 'done')
    .sort((a, b) => b.date.localeCompare(a.date) || b.startedAt - a.startedAt);
  for (const session of finished) {
    const item = session.items.find((i) => i.exerciseId === exerciseId);
    const sets = item ? item.sets.filter((s) => isLoggedSet(s, item.kind)) : [];
    if (sets.length) {
      return {
        date: session.date,
        sets: sets.map((s) => ({ weight: convertWeight(s.weight, session.unit, unit), reps: s.reps })),
      };
    }
  }
  return null;
}

function buildSessionItem(exercise, plan, previous, unit) {
  const previousSets = previous ? previous.sets : [];
  const advice = progressionAdvice(previousSets, plan, exercise.kind, unit);
  const usesWeight = exercise.kind !== 'bodyweight';
  const sets = [];
  for (let i = 0; i < plan.sets; i++) {
    let weight = '';
    if (usesWeight && advice && advice.status === 'up') {
      weight = advice.suggestedWeight;
    } else if (usesWeight && previousSets.length) {
      weight = previousSets[Math.min(i, previousSets.length - 1)].weight;
    }
    sets.push({ weight, reps: '', rpe: '', done: false });
  }
  return {
    uid: `${exercise.id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    exerciseId: exercise.id,
    name: exercise.name,
    kind: exercise.kind,
    sideLabel: exercise.sideLabel || '',
    cues: exercise.cues || [],
    repMin: plan.repMin,
    repMax: plan.repMax,
    restSec: plan.restSec,
    previous,
    advice,
    sets,
  };
}

function formatRepRange(repMin, repMax) {
  return repMin === repMax ? String(repMin) : `${repMin}–${repMax}`;
}

function formatPreviousSets(sets, unit, kind) {
  const reps = sets.map((s) => s.reps).join(', ');
  if (kind === 'bodyweight') return `${reps} reps`;
  const sameWeight = sets.every((s) => s.weight === sets[0].weight);
  if (sameWeight) return `${formatAmount(sets[0].weight)} ${unit} × ${reps}`;
  return sets.map((s) => `${formatAmount(s.weight)} × ${s.reps}`).join(', ') + ` ${unit}`;
}

function formatRestTime(seconds) {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
