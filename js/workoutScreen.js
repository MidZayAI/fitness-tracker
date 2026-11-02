// Behavior for the Workout tab: today's plan, logging, rest timer, program editor, cardio and history.
// app.js merges this into the main app, so `this` also has the diary and settings state.

const REST_OVER_DISMISS_MS = 10000;

function workoutScreen() {
  return {
    EXERCISE_KINDS, WEEKDAY_LABELS, CARDIO_TYPES, formatRepRange,
    workouts: [],
    schedule: null,
    customExercises: [],
    sessions: [],
    cardioEntries: [],
    session: null,
    confirmDialog: null,

    restEndsAt: null,
    restAlerted: false,
    now: Date.now(),
    restInterval: null,
    audioContext: null,
    wakeLock: null,

    picker: { mode: 'session-add', itemIndex: null, workoutId: null, query: '' },
    newExercise: { name: '', kind: 'dumbbell', cue: '', error: '' },
    planForm: { workoutId: null, index: null, exerciseId: null, sets: 3, repMin: 8, repMax: 10, restSec: 90, error: '' },
    cardioForm: { id: null, date: '', type: 'Walk', minutes: null, distance: null, distanceUnit: 'mi', error: '' },

    // ---------- Loading ----------
    async loadTraining() {
      await ensureProgram();
      const [workouts, schedule, customExercises] = await Promise.all([
        db.workouts.orderBy('id').toArray(),
        getSetting('schedule'),
        db.exercises.toArray(),
      ]);
      this.workouts = workouts;
      this.schedule = schedule;
      this.customExercises = customExercises;
      await this.loadHistory();
    },

    async loadHistory() {
      const [sessions, cardioEntries] = await Promise.all([db.sessions.toArray(), db.cardio.toArray()]);
      this.sessions = sessions;
      this.cardioEntries = cardioEntries;
    },

    // ---------- Today's plan ----------
    get allExercises() { return [...EXERCISES, ...this.customExercises]; },

    exerciseById(id) { return this.allExercises.find((e) => e.id === id) || null; },

    exerciseName(id) {
      const exercise = this.exerciseById(id);
      return exercise ? exercise.name : 'Unknown exercise';
    },

    plannedWorkout(date) {
      if (!this.schedule || !this.workouts.length || date < this.schedule.anchor) return null;
      const index = rotationIndex(date, this.schedule, this.workouts.length);
      return index === null ? null : this.workouts[index];
    },

    get todaysPlan() { return this.plannedWorkout(this.todayCache); },

    get nextPlanLabel() {
      if (!this.schedule) return '';
      const date = nextScheduledDate(addDays(this.todayCache, 1), this.schedule.days);
      const workout = date && this.plannedWorkout(date);
      if (!workout) return '';
      const day = parseLocalDate(date).toLocaleDateString(undefined, { weekday: 'long' });
      return `Next: ${workout.name} on ${day}`;
    },

    get alternateWorkouts() {
      const plan = this.todaysPlan;
      return this.workouts.filter((w) => !plan || w.id !== plan.id);
    },

    get activeSession() { return this.sessions.find((s) => s.status === 'active') || null; },

    get todaysFinishedSessions() {
      return this.sessions.filter((s) => s.status === 'done' && s.date === this.todayCache);
    },

    get weekStrip() {
      return weekDates(this.todayCache).map(({ label, date }) => {
        const plan = this.plannedWorkout(date);
        return {
          label,
          date,
          short: plan ? plan.id : '',
          today: date === this.todayCache,
          done: this.sessions.some((s) => s.status === 'done' && s.date === date),
        };
      });
    },

    // ---------- History ----------
    get historyRows() {
      const sessionRows = this.sessions
        .filter((s) => s.status === 'done')
        .map((s) => ({
          key: `session-${s.id}`,
          date: s.date,
          order: s.startedAt || 0,
          title: s.workoutName,
          detail: `${s.items.length} exercises · ${this.sessionSetCount(s)} sets`,
          session: s,
        }));
      const cardioRows = this.cardioEntries.map((c) => ({
        key: `cardio-${c.id}`,
        date: c.date,
        order: c.createdAt || 0,
        title: c.type,
        detail: [`${formatAmount(c.minutes)} min`, c.distance ? `${formatAmount(c.distance)} ${c.distanceUnit}` : ''].filter(Boolean).join(' · '),
        cardio: c,
      }));
      return [...sessionRows, ...cardioRows]
        .sort((a, b) => b.date.localeCompare(a.date) || b.order - a.order)
        .slice(0, 40);
    },

    sessionSetCount(session) {
      return session.items.reduce((count, item) => count + item.sets.filter((s) => isLoggedSet(s, item.kind)).length, 0);
    },

    shortDate(date) {
      return parseLocalDate(date).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
    },

    openHistoryRow(row) {
      if (row.cardio) this.openCardio(row.cardio);
      else this.openSession(row.session);
    },

    // ---------- Running a workout ----------
    async startWorkout(workout) {
      if (this.activeSession) {
        this.openSession(this.activeSession);
        return;
      }
      await this.loadHistory();
      const unit = this.units;
      const items = workout.exercises
        .filter((row) => this.exerciseById(row.exerciseId))
        .map((row) => buildSessionItem(
          this.exerciseById(row.exerciseId),
          row,
          findPreviousSets(row.exerciseId, this.sessions, unit),
          unit,
        ));
      const session = {
        date: this.todayCache,
        workoutId: workout.id,
        workoutName: workout.name,
        status: 'active',
        unit,
        startedAt: Date.now(),
        restEndsAt: null,
        items,
      };
      session.id = await db.sessions.add(plain(session));
      await this.loadHistory();
      this.requestPersistentStorage();
      this.openSession(session);
    },

    openSession(session) {
      this.session = plain(session);
      if (this.session.status === 'active' && this.session.restEndsAt > Date.now()) {
        this.runRestTimer(this.session.restEndsAt);
      }
      this.openSheet('session');
    },

    saveSession() {
      if (!this.session) return Promise.resolve();
      return db.sessions.put(plain(this.session));
    },

    previousLabel(item) {
      if (!item.previous) return '';
      const when = parseLocalDate(item.previous.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      return `Last time (${when}): ${formatPreviousSets(item.previous.sets, this.session.unit, item.kind)}`;
    },

    targetLabel(item) {
      const side = item.sideLabel ? ` ${item.sideLabel}` : '';
      return `Target: ${item.sets.length} × ${formatRepRange(item.repMin, item.repMax)}${side}`;
    },

    demoLink(item) {
      return `https://www.youtube.com/results?search_query=${encodeURIComponent(`how to ${item.name} proper form`)}`;
    },

    toggleSet(item, set, index) {
      item.error = '';
      if (set.done) {
        set.done = false;
        this.saveSession();
        return;
      }
      const usesWeight = item.kind !== 'bodyweight';
      if (usesWeight && !(Number.isFinite(set.weight) && set.weight >= 0)) {
        item.error = `Enter the weight for set ${index + 1}.`;
        return;
      }
      if (!(Number.isFinite(set.reps) && set.reps > 0)) {
        item.error = `Enter your reps for set ${index + 1}.`;
        return;
      }
      set.done = true;
      // Carries this weight down to later sets you haven't ticked, so a change only needs typing once.
      if (usesWeight) {
        item.sets.slice(index + 1).filter((s) => !s.done).forEach((s) => { s.weight = set.weight; });
      }
      if (this.session.status === 'active') {
        this.unlockAudio();
        this.startRest(item.restSec);
      }
      this.saveSession();
    },

    addSet(item) {
      const last = item.sets[item.sets.length - 1];
      item.sets.push({ weight: last ? last.weight : '', reps: '', rpe: '', done: false });
      this.saveSession();
    },

    removeLastSet(item) {
      if (item.sets.length > 1) {
        item.sets.pop();
        this.saveSession();
      }
    },

    removeItem(index) {
      const item = this.session.items[index];
      this.confirmDialog = {
        title: `Remove ${item.name}?`,
        message: 'This only changes this workout, not your program.',
        action: 'Remove',
        run: () => {
          this.session.items.splice(index, 1);
          this.saveSession();
        },
      };
    },

    finishSession() {
      const items = this.session.items;
      const logged = this.sessionSetCount(this.session);
      const total = items.reduce((count, item) => count + item.sets.length, 0);
      if (logged === 0) {
        this.confirmDialog = {
          title: 'No sets ticked yet',
          message: 'Tick each set as you finish it. To cancel this workout, use Discard workout.',
          action: 'OK',
          run: () => {},
        };
        return;
      }
      if (logged < total) {
        const left = total - logged;
        this.confirmDialog = {
          title: `${left} ${left === 1 ? 'set' : 'sets'} not ticked`,
          message: 'Finish now and leave those sets out of your history?',
          action: 'Finish',
          run: () => this.completeSession(),
        };
        return;
      }
      this.completeSession();
    },

    async completeSession() {
      const session = this.session;
      session.items = session.items
        .map((item) => ({ ...item, sets: item.sets.filter((s) => isLoggedSet(s, item.kind)) }))
        .filter((item) => item.sets.length);
      session.status = 'done';
      session.finishedAt = Date.now();
      session.restEndsAt = null;
      this.stopRest();
      await this.saveSession();
      await this.loadHistory();
      this.closeSheet();
      const setCount = this.sessionSetCount(session);
      this.showToast(`Workout saved: ${setCount} ${setCount === 1 ? 'set' : 'sets'}`);
    },

    discardSession() {
      const finished = this.session.status === 'done';
      this.confirmDialog = {
        title: finished ? 'Delete this workout?' : 'Discard this workout?',
        message: 'Its logged sets will be deleted from this phone.',
        action: finished ? 'Delete' : 'Discard',
        run: async () => {
          const { id } = this.session;
          this.stopRest();
          this.session = null;
          await db.sessions.delete(id);
          await this.loadHistory();
          this.closeSheet();
        },
      };
    },

    async runConfirm() {
      const { run } = this.confirmDialog;
      this.confirmDialog = null;
      await run();
    },

    leaveSession() {
      this.closeSheet();
    },

    // ---------- Rest timer ----------
    // The timer stores when rest ends rather than counting down, so it stays right if Android pauses the app.
    startRest(seconds) {
      if (!(seconds > 0)) return;
      const endsAt = Date.now() + seconds * 1000;
      this.session.restEndsAt = endsAt;
      this.runRestTimer(endsAt);
    },

    runRestTimer(endsAt) {
      clearInterval(this.restInterval);
      this.restEndsAt = endsAt;
      this.restAlerted = false;
      this.now = Date.now();
      this.restInterval = setInterval(() => this.tickRest(), 250);
    },

    tickRest() {
      this.now = Date.now();
      if (!this.restEndsAt || this.now < this.restEndsAt) return;
      if (!this.restAlerted) {
        this.restAlerted = true;
        this.playRestAlert();
      }
      if (this.now > this.restEndsAt + REST_OVER_DISMISS_MS) this.stopRest();
    },

    get restVisible() { return !!this.restEndsAt && this.sheet === 'session'; },
    get restOver() { return !!this.restEndsAt && this.now >= this.restEndsAt; },
    get restLabel() { return this.restOver ? 'Rest over' : formatRestTime((this.restEndsAt - this.now) / 1000); },

    addRest(seconds) {
      const endsAt = Math.max(this.restEndsAt, Date.now()) + seconds * 1000;
      if (this.session) this.session.restEndsAt = endsAt;
      this.runRestTimer(endsAt);
      this.saveSession();
    },

    stopRest() {
      clearInterval(this.restInterval);
      this.restInterval = null;
      this.restEndsAt = null;
      if (this.session && this.session.restEndsAt) {
        this.session.restEndsAt = null;
        this.saveSession();
      }
    },

    // Phones only allow sound after a tap, so this runs when you tick a set.
    unlockAudio() {
      try {
        if (!this.audioContext) this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        if (this.audioContext.state === 'suspended') this.audioContext.resume();
      } catch (error) {
        this.audioContext = null;
      }
    },

    playRestAlert() {
      if (navigator.vibrate) navigator.vibrate([250, 120, 250]);
      const context = Alpine.raw(this.audioContext);
      if (!context || context.state !== 'running') return;
      [0, 0.28, 0.56].forEach((offset) => {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.frequency.value = 880;
        gain.gain.value = 0.25;
        oscillator.connect(gain).connect(context.destination);
        oscillator.start(context.currentTime + offset);
        oscillator.stop(context.currentTime + offset + 0.18);
      });
    },

    // ---------- Keeping the screen on ----------
    // Android releases the lock whenever the app is hidden, so this runs again on return.
    async syncWakeLock() {
      const wanted = !document.hidden
        && this.sheetStack.includes('session')
        && this.session
        && this.session.status === 'active';
      if (wanted && !this.wakeLock && navigator.wakeLock) {
        try {
          const lock = await navigator.wakeLock.request('screen');
          lock.addEventListener('release', () => { this.wakeLock = null; });
          this.wakeLock = lock;
        } catch (error) {
          this.wakeLock = null;
        }
      } else if (!wanted && this.wakeLock) {
        const lock = Alpine.raw(this.wakeLock);
        this.wakeLock = null;
        await lock.release();
      }
    },

    // ---------- Choosing an exercise ----------
    openPicker(mode, details = {}) {
      this.picker = { mode, itemIndex: null, workoutId: null, query: '', ...details };
      this.openSheet('picker');
    },

    get pickerExercises() {
      const words = this.picker.query.trim().toLowerCase().split(/\s+/).filter(Boolean);
      return this.allExercises.filter((e) => {
        const text = `${e.name} ${e.group || ''}`.toLowerCase();
        return words.every((w) => text.includes(w));
      });
    },

    async pickExercise(exercise) {
      const { mode, itemIndex, workoutId } = this.picker;
      if (mode === 'session-swap' || mode === 'session-add') {
        const old = mode === 'session-swap' ? this.session.items[itemIndex] : null;
        const plan = old
          ? { sets: old.sets.length, repMin: old.repMin, repMax: old.repMax, restSec: old.restSec }
          : NEW_EXERCISE_DEFAULTS;
        const previous = findPreviousSets(exercise.id, this.sessions, this.session.unit);
        const item = buildSessionItem(plain(exercise), plan, previous, this.session.unit);
        if (old) this.session.items.splice(itemIndex, 1, item);
        else this.session.items.push(item);
        await this.saveSession();
      } else if (mode === 'plan-swap') {
        this.planForm.exerciseId = exercise.id;
      } else if (mode === 'plan-add') {
        const workout = this.workouts.find((w) => w.id === workoutId);
        workout.exercises.push({ exerciseId: exercise.id, ...NEW_EXERCISE_DEFAULTS });
        await db.workouts.put(plain(workout));
      }
      this.closeSheet();
    },

    openNewExercise() {
      this.newExercise = { name: this.picker.query.trim(), kind: 'dumbbell', cue: '', error: '' };
      this.openSheet('newExercise');
    },

    async saveNewExercise() {
      const form = this.newExercise;
      const name = form.name.trim();
      if (!name) {
        form.error = 'Give this exercise a name.';
        return;
      }
      const exercise = {
        id: `custom-${Date.now()}`,
        name,
        kind: form.kind,
        group: 'Your exercises',
        cues: form.cue.trim() ? [form.cue.trim()] : [],
      };
      await db.exercises.put(exercise);
      this.customExercises.push(exercise);
      this.closeSheet();
      this.showToast(`${name} added to your exercises`);
    },

    // ---------- Program editor ----------
    planRowLabel(row) {
      return `${row.sets} × ${formatRepRange(row.repMin, row.repMax)} · ${formatRestTime(row.restSec)} rest`;
    },

    openPlanRow(workout, index) {
      const row = workout.exercises[index];
      this.planForm = { workoutId: workout.id, index, ...plain(row), error: '' };
      this.openSheet('planRow');
    },

    get planFormWorkout() { return this.workouts.find((w) => w.id === this.planForm.workoutId) || null; },

    async savePlanRow() {
      const form = this.planForm;
      const row = {
        exerciseId: form.exerciseId,
        sets: Number(form.sets),
        repMin: Number(form.repMin),
        repMax: Number(form.repMax),
        restSec: Number(form.restSec),
      };
      if (!(Number.isInteger(row.sets) && row.sets >= 1 && row.sets <= 10)) { form.error = 'Sets must be a whole number from 1 to 10.'; return; }
      if (!(row.repMin >= 1 && row.repMax >= row.repMin && row.repMax <= 100)) { form.error = 'Check your rep range. The low number can’t be above the high number.'; return; }
      if (!(row.restSec >= 0 && row.restSec <= 900)) { form.error = 'Rest must be from 0 to 900 seconds.'; return; }
      const workout = this.planFormWorkout;
      workout.exercises.splice(form.index, 1, row);
      await db.workouts.put(plain(workout));
      this.closeSheet();
      this.showToast('Program updated for future workouts');
    },

    async movePlanRow(direction) {
      const form = this.planForm;
      const workout = this.planFormWorkout;
      const target = form.index + direction;
      if (target < 0 || target >= workout.exercises.length) return;
      const [row] = workout.exercises.splice(form.index, 1);
      workout.exercises.splice(target, 0, row);
      form.index = target;
      await db.workouts.put(plain(workout));
    },

    async removePlanRow() {
      const form = this.planForm;
      const workout = this.planFormWorkout;
      if (workout.exercises.length <= 1) {
        form.error = 'A workout needs at least one exercise.';
        return;
      }
      workout.exercises.splice(form.index, 1);
      await db.workouts.put(plain(workout));
      this.closeSheet();
    },

    // The next training day continues the rotation from your last finished workout.
    nextRotationStart() {
      const finished = this.sessions
        .filter((s) => s.status === 'done')
        .sort((a, b) => b.date.localeCompare(a.date) || b.startedAt - a.startedAt);
      if (!finished.length) return 0;
      const lastIndex = this.workouts.findIndex((w) => w.id === finished[0].workoutId);
      return lastIndex < 0 ? 0 : (lastIndex + 1) % this.workouts.length;
    },

    async toggleScheduleDay(day) {
      const { days } = this.schedule;
      const next = days.includes(day) ? days.filter((d) => d !== day) : [...days, day];
      if (!next.length) {
        this.showToast('Keep at least one training day');
        return;
      }
      this.schedule = makeSchedule(next, this.todayCache, this.nextRotationStart());
      await setSetting('schedule', plain(this.schedule));
    },

    async swapRotation() {
      this.schedule = { ...plain(this.schedule), startIndex: this.schedule.startIndex + 1 };
      await setSetting('schedule', plain(this.schedule));
      this.showToast('Workout order swapped');
    },

    // ---------- Cardio ----------
    openCardio(entry = null) {
      const distanceUnit = this.units === 'kg' ? 'km' : 'mi';
      this.cardioForm = entry
        ? { ...plain(entry), error: '' }
        : { id: null, date: this.todayCache, type: 'Walk', minutes: null, distance: null, distanceUnit, error: '' };
      this.openSheet('cardio');
    },

    async saveCardio() {
      const form = this.cardioForm;
      const minutes = Number(form.minutes);
      const hasDistance = form.distance !== null && form.distance !== '';
      const distance = hasDistance ? Number(form.distance) : null;
      if (!form.date) { form.error = 'Choose a date.'; return; }
      if (!(minutes > 0)) { form.error = 'Enter the minutes, above 0.'; return; }
      if (hasDistance && !(distance >= 0)) { form.error = 'Distance can’t be negative.'; return; }
      const entry = {
        date: form.date,
        type: form.type,
        minutes,
        distance,
        distanceUnit: form.distanceUnit,
        createdAt: form.createdAt || Date.now(),
      };
      if (form.id) entry.id = form.id;
      await db.cardio.put(entry);
      await this.loadHistory();
      this.closeSheet();
      this.showToast('Cardio saved');
    },

    async deleteCardio() {
      const removed = plain(this.cardioForm);
      delete removed.error;
      await db.cardio.delete(removed.id);
      await this.loadHistory();
      this.closeSheet();
      this.showToast('Cardio removed', async () => {
        await db.cardio.put(removed);
        this.toast = null;
        await this.loadHistory();
      });
    },
  };
}
