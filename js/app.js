// The app's screens and behavior. index.html displays the state held here.

const APP_VERSION = '0.2.0';
const BACKUP_REMINDER_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

// The browser's database can't store Alpine's reactive wrappers, so data is copied before saving.
function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function foodSnapshot(food) {
  const { key, source, name, brand, nutrients, portions } = food;
  return plain({ key, source, name, brand, nutrients, portions });
}

function emptySetup(units) {
  return {
    step: 1, units, sex: '', age: null, feet: null, inches: null, cm: null, weight: null,
    activity: 'light', pace: 'moderate', error: '', suggestion: null,
    kcal: null, protein: null, carbs: null, fat: null,
  };
}

function emptyCustomFood() {
  return {
    key: null, name: '', brand: '', servingLabel: '1 serving', grams: null,
    kcal: null, protein: null, carbs: null, fat: null, error: '',
  };
}

function app() {
  // Copies property descriptors so the Workout tab's computed values stay live rather than frozen.
  return Object.defineProperties(diaryAndSettings(), Object.getOwnPropertyDescriptors(workoutScreen()));
}

function diaryAndSettings() {
  return {
    MEALS, ACTIVITY_LEVELS, FAT_LOSS_PACES, SOURCE_LABELS, APP_VERSION,
    ready: false,
    loadError: '',
    tab: 'diary',
    date: localDate(),
    entries: [],
    target: null,
    hasTargets: false,
    units: 'lb',
    usdaKey: '',
    usdaKeyDraft: '',
    lastBackupAt: null,
    setupAt: null,
    storagePersisted: null,
    entryCount: 0,

    sheetStack: [],
    setup: emptySetup('lb'),
    targetForm: { kcal: null, protein: null, carbs: null, fat: null, error: '' },

    addMeal: 'breakfast',
    savedFoods: [],
    query: '',
    searching: false,
    searched: false,
    results: { general: [], branded: [], errors: [] },
    searchToken: 0,

    form: null,
    custom: emptyCustomFood(),
    pendingRestore: null,
    restoreError: '',
    toast: null,
    toastTimer: null,
    online: navigator.onLine,
    installPrompt: null,
    installed: window.matchMedia('(display-mode: standalone)').matches,
    swWaiting: null,
    dayToken: 0,
    todayCache: localDate(),

    async init() {
      // A restarted app opens with no sheets, but the browser remembers the old history step. Clear it.
      history.replaceState({ depth: 0 }, '');
      window.addEventListener('popstate', (e) => {
        const depth = (e.state && e.state.depth) || 0;
        if (depth < this.sheetStack.length) this.sheetStack.splice(depth);
      });
      window.addEventListener('online', () => { this.online = true; });
      window.addEventListener('offline', () => { this.online = false; });
      window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        this.installPrompt = e;
      });
      window.addEventListener('appinstalled', () => {
        this.installed = true;
        this.installPrompt = null;
      });
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden) this.onReturn();
        this.syncWakeLock();
        this.tickRest();
      });
      this.$watch('sheetStack.length', () => {
        this.syncWakeLock();
        if (!this.sheetStack.length) this.loadHistory();
      });
      this.registerServiceWorker();

      try {
        await this.loadSettings();
        await this.loadDay();
        await this.loadTraining();
        this.ready = true;
      } catch (error) {
        console.error(error);
        this.loadError = 'The app could not open its storage on this device. Try closing and reopening it.';
      }
    },

    // ---------- Loading ----------
    async loadSettings() {
      this.units = await getSetting('units', 'lb');
      this.usdaKey = await getSetting('usdaKey', '');
      this.usdaKeyDraft = this.usdaKey;
      this.lastBackupAt = await getSetting('lastBackupAt');
      this.setupAt = await getSetting('setupAt');
      this.hasTargets = (await db.targets.count()) > 0;
      this.entryCount = await db.entries.count();
      if (!this.hasTargets) this.setup = emptySetup(this.units);
      if (navigator.storage && navigator.storage.persisted) {
        this.storagePersisted = await navigator.storage.persisted();
      }
    },

    async loadDay() {
      const token = ++this.dayToken;
      const date = this.date;
      const [entries, target] = await Promise.all([
        db.entries.where('date').equals(date).sortBy('createdAt'),
        targetsForDate(date),
      ]);
      if (token !== this.dayToken) return;
      this.entries = entries;
      this.target = target || null;
    },

    // If the app was left open overnight, move from yesterday to the new today.
    onReturn() {
      const today = localDate();
      if (today === this.todayCache) return;
      const wasOnToday = this.date === this.todayCache;
      this.todayCache = today;
      if (wasOnToday) this.goToDate(today);
    },

    // ---------- Day view ----------
    get isToday() { return this.date === this.todayCache; },

    get dateTitle() {
      if (this.date === this.todayCache) return 'Today';
      if (this.date === addDays(this.todayCache, -1)) return 'Yesterday';
      if (this.date === addDays(this.todayCache, 1)) return 'Tomorrow';
      return parseLocalDate(this.date).toLocaleDateString(undefined, { weekday: 'long' });
    },

    get dateSubtitle() {
      return parseLocalDate(this.date).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
    },

    goToDate(date) {
      if (!date) return;
      this.date = date;
      this.loadDay();
    },

    shiftDate(days) { this.goToDate(addDays(this.date, days)); },

    get totals() { return sumEntries(this.entries); },

    get kcalLeft() {
      return this.target ? Math.round(this.target.kcal) - Math.round(this.totals.kcal) : 0;
    },

    percent(value, goal) {
      if (!(goal > 0)) return 0;
      return Math.min(100, (value / goal) * 100);
    },

    macroRows() {
      if (!this.target) return [];
      return [
        { id: 'protein', label: 'Protein', value: this.totals.protein, goal: this.target.protein },
        { id: 'carbs', label: 'Carbs', value: this.totals.carbs, goal: this.target.carbs },
        { id: 'fat', label: 'Fat', value: this.totals.fat, goal: this.target.fat },
      ];
    },

    mealEntries(mealId) { return this.entries.filter((e) => e.meal === mealId); },
    mealCalories(mealId) { return Math.round(sumEntries(this.mealEntries(mealId)).kcal); },
    entryCalories(entry) { return Math.round(entryTotals(entry).kcal); },

    entryAmount(entry) {
      const portion = entry.food.portions[entry.portionIndex];
      return entry.qty === 1 ? portion.label : `${formatAmount(entry.qty)} × ${portion.label}`;
    },

    // ---------- Sheets and the Android back button ----------
    // Each open sheet adds a history step, so the back button closes the sheet rather than the app.
    get sheet() { return this.sheetStack[this.sheetStack.length - 1] || null; },

    openSheet(name) {
      this.sheetStack.push(name);
      history.pushState({ depth: this.sheetStack.length }, '');
    },

    closeSheet() { history.back(); },

    closeAllSheets() {
      if (this.sheetStack.length) history.go(-this.sheetStack.length);
    },

    showToast(message, undo = null) {
      clearTimeout(this.toastTimer);
      this.toast = { message, undo };
      this.toastTimer = setTimeout(() => { this.toast = null; }, undo ? 6000 : 3000);
    },

    // ---------- Adding food ----------
    async openAddFood(mealId) {
      this.addMeal = mealId;
      this.query = '';
      this.searched = false;
      this.searching = false;
      this.results = { general: [], branded: [], errors: [] };
      await this.loadSavedFoods();
      this.openSheet('add');
    },

    async loadSavedFoods() {
      this.savedFoods = await db.foods.orderBy('lastUsed').reverse().toArray();
    },

    get matchingSavedFoods() {
      const words = this.query.trim().toLowerCase().split(/\s+/).filter(Boolean);
      if (!words.length) return this.savedFoods.slice(0, 20);
      return this.savedFoods
        .filter((f) => {
          const text = `${f.name} ${f.brand || ''}`.toLowerCase();
          return words.every((w) => text.includes(w));
        })
        .slice(0, 20);
    },

    async runSearch() {
      const query = this.query.trim();
      if (!query) return;
      const token = ++this.searchToken;
      this.searched = true;
      if (!navigator.onLine) {
        this.searching = false;
        this.results = { general: [], branded: [], errors: ['You are offline, so only your saved foods are shown.'] };
        return;
      }
      this.searching = true;
      this.results = { general: [], branded: [], errors: [] };
      const results = await searchFoods(query, this.usdaKey);
      if (token !== this.searchToken) return;
      this.results = results;
      this.searching = false;
    },

    foodCaloriesLabel(food) {
      const first = food.portions[0];
      return `${Math.round(food.nutrients.kcal * first.factor)} kcal · ${first.label}`;
    },

    openFood(food, saved = false) {
      const portionIndex = Number.isInteger(food.lastPortionIndex) && food.lastPortionIndex < food.portions.length
        ? food.lastPortionIndex : 0;
      this.form = {
        mode: 'new',
        entryId: null,
        food: foodSnapshot(food),
        saved,
        qty: food.lastQty || 1,
        portionIndex,
        meal: this.addMeal,
        error: '',
      };
      this.openSheet('portion');
    },

    openEntry(entry) {
      this.form = {
        mode: 'edit',
        entryId: entry.id,
        food: plain(entry.food),
        saved: false,
        qty: entry.qty,
        portionIndex: entry.portionIndex,
        meal: entry.meal,
        error: '',
      };
      this.openSheet('portion');
    },

    get formTotals() {
      const qty = Number(this.form && this.form.qty);
      if (!this.form || !(qty > 0)) return { kcal: 0, protein: 0, carbs: 0, fat: 0 };
      return portionTotals(this.form.food, Number(this.form.portionIndex), qty);
    },

    async saveEntry() {
      const form = this.form;
      const qty = Number(form.qty);
      const portionIndex = Number(form.portionIndex);
      if (!(qty > 0)) {
        form.error = 'Enter an amount above 0.';
        return;
      }
      if (form.mode === 'edit') {
        await db.entries.update(form.entryId, { qty, portionIndex, meal: form.meal });
        this.closeAllSheets();
        this.showToast('Entry updated');
      } else {
        const food = foodSnapshot(form.food);
        const now = Date.now();
        await db.transaction('rw', db.entries, db.foods, async () => {
          const existing = await db.foods.get(food.key);
          await db.entries.add({
            date: this.date, meal: form.meal, foodKey: food.key, qty, portionIndex, food, createdAt: now,
          });
          await db.foods.put({
            ...food,
            lastUsed: now,
            lastQty: qty,
            lastPortionIndex: portionIndex,
            useCount: ((existing && existing.useCount) || 0) + 1,
          });
        });
        this.entryCount += 1;
        this.requestPersistentStorage();
        this.closeAllSheets();
        this.showToast(`Added to ${MEALS.find((m) => m.id === form.meal).label}`);
      }
      await this.loadDay();
    },

    async deleteEntry() {
      const removed = await db.entries.get(this.form.entryId);
      await db.entries.delete(this.form.entryId);
      this.entryCount -= 1;
      this.closeAllSheets();
      await this.loadDay();
      this.showToast('Entry removed', async () => {
        await db.entries.put(removed);
        this.entryCount += 1;
        this.toast = null;
        await this.loadDay();
      });
    },

    async forgetFood() {
      await db.foods.delete(this.form.food.key);
      await this.loadSavedFoods();
      this.closeSheet();
      this.showToast('Removed from your foods');
    },

    // ---------- Custom foods ----------
    openCustomFood() {
      this.custom = emptyCustomFood();
      this.custom.name = this.query.trim();
      this.openSheet('custom');
    },

    editCustomFood() {
      const food = this.form.food;
      const gramPortion = food.portions.find((p) => p.label === '1 g');
      this.custom = {
        key: food.key,
        name: food.name,
        brand: food.brand || '',
        servingLabel: food.portions[0].label,
        grams: gramPortion ? Math.round((1 / gramPortion.factor) * 10) / 10 : null,
        kcal: food.nutrients.kcal,
        protein: food.nutrients.protein,
        carbs: food.nutrients.carbs,
        fat: food.nutrients.fat,
        error: '',
      };
      this.openSheet('custom');
    },

    async saveCustomFood() {
      const c = this.custom;
      const number = (v) => (v === '' || v === null ? 0 : Number(v));
      const values = [c.kcal, c.protein, c.carbs, c.fat].map(number);
      const grams = c.grams === '' || c.grams === null ? null : Number(c.grams);
      if (!c.name.trim()) { c.error = 'Give this food a name.'; return; }
      if (!c.servingLabel.trim()) { c.error = 'Name the serving, such as "1 bar".'; return; }
      if (c.kcal === '' || c.kcal === null) { c.error = 'Enter the calories per serving.'; return; }
      if (values.some((v) => !Number.isFinite(v) || v < 0)) { c.error = 'Nutrition numbers can\'t be negative.'; return; }
      if (grams !== null && !(grams > 0)) { c.error = 'Serving weight must be above 0, or left empty.'; return; }

      const [kcal, protein, carbs, fat] = values;
      const portions = [{ label: c.servingLabel.trim(), factor: 1 }];
      if (grams) portions.push({ label: '1 g', factor: 1 / grams });
      const isEdit = !!c.key;
      const existing = isEdit ? await db.foods.get(c.key) : null;
      const food = {
        key: c.key || `custom:${crypto.randomUUID()}`,
        source: 'custom',
        name: c.name.trim(),
        brand: c.brand.trim(),
        nutrients: { kcal, protein, carbs, fat },
        portions,
      };
      await db.foods.put({
        ...food,
        lastUsed: (existing && existing.lastUsed) || Date.now(),
        useCount: (existing && existing.useCount) || 0,
      });
      await this.loadSavedFoods();

      if (isEdit) {
        // Past diary entries keep the numbers they were logged with.
        this.form.food = food;
        this.form.portionIndex = 0;
        this.closeSheet();
        return;
      }
      this.form = {
        mode: 'new', entryId: null, food, saved: true, qty: 1, portionIndex: 0, meal: this.addMeal, error: '',
      };
      this.sheetStack.splice(this.sheetStack.length - 1, 1, 'portion');
    },

    // ---------- Setup and targets ----------
    startRecalculate() {
      this.setup = emptySetup(this.units);
      this.prefillSetup();
      this.openSheet('setup');
    },

    async prefillSetup() {
      const profile = await getSetting('profile');
      if (!profile) return;
      const s = this.setup;
      Object.assign(s, { sex: profile.sex, age: profile.age, activity: profile.activity, pace: profile.pace });
      if (s.units === 'lb') {
        const { feet, inches } = cmToFeetInches(profile.cm);
        s.feet = feet;
        s.inches = inches;
        s.weight = Math.round(kgToLb(profile.kg));
      } else {
        s.cm = Math.round(profile.cm);
        s.weight = Math.round(profile.kg * 10) / 10;
      }
    },

    setupProfile() {
      const s = this.setup;
      const inLb = s.units === 'lb';
      return {
        sex: s.sex,
        age: Number(s.age),
        cm: inLb ? feetInchesToCm(Number(s.feet), Number(s.inches || 0)) : Number(s.cm),
        kg: inLb ? lbToKg(Number(s.weight)) : Number(s.weight),
        activity: s.activity,
        pace: s.pace,
      };
    },

    setupNext() {
      const s = this.setup;
      s.error = '';
      if (s.step === 2) {
        const p = this.setupProfile();
        if (!s.sex) { s.error = 'Choose an option for the calorie formula.'; return; }
        if (!(p.age >= 18 && p.age <= 100)) {
          s.error = 'Suggestions are for adults aged 18–100. If you\'re under 18, please ask a doctor or dietitian about calorie targets.';
          return;
        }
        if (!(p.cm >= 120 && p.cm <= 250)) { s.error = 'Check your height.'; return; }
        if (!(p.kg >= 30 && p.kg <= 350)) { s.error = 'Check your weight.'; return; }
      }
      if (s.step === 3) {
        const suggestion = suggestTargets(this.setupProfile());
        s.suggestion = suggestion;
        Object.assign(s, {
          kcal: suggestion.kcal, protein: suggestion.protein, carbs: suggestion.carbs, fat: suggestion.fat,
        });
      }
      s.step += 1;
      window.scrollTo(0, 0);
    },

    setupBack() {
      this.setup.error = '';
      this.setup.step -= 1;
    },

    readTargets(source) {
      const targets = {
        kcal: Number(source.kcal), protein: Number(source.protein), carbs: Number(source.carbs), fat: Number(source.fat),
      };
      const valid = targets.kcal > 0 && [targets.protein, targets.carbs, targets.fat].every((v) => Number.isFinite(v) && v >= 0);
      return valid ? targets : null;
    },

    async finishSetup() {
      const s = this.setup;
      const targets = this.readTargets(s);
      if (!targets) {
        s.error = 'Enter calories above 0, and macros of 0 or more.';
        return;
      }
      const firstRun = !this.hasTargets;
      await this.saveTargets(targets);
      await setSetting('profile', this.setupProfile());
      await this.setUnits(s.units);
      if (firstRun) {
        this.setupAt = Date.now();
        await setSetting('setupAt', this.setupAt);
        this.requestPersistentStorage();
      } else {
        this.closeSheet();
        this.showToast('Targets updated from today onward');
      }
    },

    // Past days keep the targets they had. New targets apply from today onward.
    async saveTargets(targets) {
      await db.targets.put({ startDate: localDate(), ...targets });
      this.hasTargets = true;
      await this.loadDay();
    },

    openTargetEditor() {
      const t = this.target || {};
      this.targetForm = { kcal: t.kcal, protein: t.protein, carbs: t.carbs, fat: t.fat, error: '' };
      this.openSheet('targets');
    },

    async saveTargetForm() {
      const targets = this.readTargets(this.targetForm);
      if (!targets) {
        this.targetForm.error = 'Enter calories above 0, and macros of 0 or more.';
        return;
      }
      await this.saveTargets(targets);
      this.closeSheet();
      this.showToast('Targets updated from today onward');
    },

    async setUnits(units) {
      this.units = units;
      await setSetting('units', units);
    },

    // ---------- Settings ----------
    async saveUsdaKey() {
      this.usdaKey = this.usdaKeyDraft.trim();
      this.usdaKeyDraft = this.usdaKey;
      await setSetting('usdaKey', this.usdaKey);
      this.showToast(this.usdaKey ? 'USDA key saved on this phone' : 'USDA key removed');
    },

    // Asks the browser not to clear this app's data when the phone is low on space.
    async requestPersistentStorage() {
      if (!navigator.storage || !navigator.storage.persist) return;
      this.storagePersisted = await navigator.storage.persist();
    },

    get backupDue() {
      if (!this.hasTargets || (!this.entryCount && !this.sessions.length)) return false;
      const since = this.lastBackupAt || this.setupAt;
      return !since || Date.now() - since > BACKUP_REMINDER_DAYS * DAY_MS;
    },

    get lastBackupLabel() {
      if (!this.lastBackupAt) return 'No backup saved yet.';
      return `Last backup: ${new Date(this.lastBackupAt).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}.`;
    },

    async downloadBackup() {
      const backup = await createBackup();
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `fitness-backup-${localDate()}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      this.lastBackupAt = Date.now();
      await setSetting('lastBackupAt', this.lastBackupAt);
      this.showToast('Backup saved to your Downloads');
    },

    async chooseRestoreFile(event) {
      const file = event.target.files[0];
      event.target.value = '';
      if (!file) return;
      this.restoreError = '';
      try {
        const backup = JSON.parse(await file.text());
        const counts = validateBackup(backup);
        this.pendingRestore = { backup, counts, exportedAt: backup.exportedAt };
      } catch (error) {
        this.restoreError = error instanceof SyntaxError
          ? 'This file is not a Fitness Tracker backup.'
          : error.message;
      }
    },

    get pendingRestoreDate() {
      const at = this.pendingRestore && Date.parse(this.pendingRestore.exportedAt);
      return at ? new Date(at).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' }) : 'an unknown date';
    },

    async confirmRestore() {
      try {
        await restoreBackup(plain(this.pendingRestore.backup));
      } catch (error) {
        console.error(error);
        this.restoreError = error.message || 'The backup could not be restored, so nothing was changed.';
        this.pendingRestore = null;
        return;
      }
      this.pendingRestore = null;
      this.sheetStack.splice(0);
      await this.loadSettings();
      this.date = localDate();
      this.tab = 'diary';
      await this.loadDay();
      await this.loadTraining();
      this.showToast('Backup restored');
    },

    // ---------- Install and updates ----------
    async promptInstall() {
      if (!this.installPrompt) return;
      this.installPrompt.prompt();
      await this.installPrompt.userChoice;
      this.installPrompt = null;
    },

    registerServiceWorker() {
      if (!('serviceWorker' in navigator)) return;
      navigator.serviceWorker.register('sw.js').then((registration) => {
        const noteWaiting = () => {
          if (registration.waiting && navigator.serviceWorker.controller) this.swWaiting = registration.waiting;
        };
        noteWaiting();
        registration.addEventListener('updatefound', () => {
          const worker = registration.installing;
          if (worker) worker.addEventListener('statechange', noteWaiting);
        });
      }).catch((error) => console.error('Offline support did not start', error));
    },

    applyUpdate() {
      if (!this.swWaiting) return;
      navigator.serviceWorker.addEventListener('controllerchange', () => window.location.reload());
      this.swWaiting.postMessage('skipWaiting');
    },

    round: Math.round,
  };
}
