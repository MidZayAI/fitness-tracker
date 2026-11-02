// Pure calculations and date helpers. Nothing in this file touches the database or the network.

const MEALS = [
  { id: 'breakfast', label: 'Breakfast' },
  { id: 'lunch', label: 'Lunch' },
  { id: 'dinner', label: 'Dinner' },
  { id: 'snacks', label: 'Snacks' },
];

const ACTIVITY_LEVELS = [
  { id: 'low', factor: 1.2, label: 'Mostly sitting', hint: 'Desk job, little walking' },
  { id: 'light', factor: 1.375, label: 'Lightly active', hint: 'Some walking, training 1–3 days a week' },
  { id: 'moderate', factor: 1.55, label: 'Moderately active', hint: 'On your feet often, training 3–5 days a week' },
  { id: 'high', factor: 1.725, label: 'Very active', hint: 'Physical job or hard training most days' },
];

const FAT_LOSS_PACES = [
  { id: 'gentle', deficit: 0.1, label: 'Gentle', hint: 'About 10% below maintenance. Easiest to stick to.' },
  { id: 'moderate', deficit: 0.2, label: 'Moderate', hint: 'About 20% below maintenance. A common starting point.' },
  { id: 'faster', deficit: 0.25, label: 'Faster', hint: 'About 25% below maintenance. Harder to sustain.' },
];

// Lowest calorie number the app will suggest on its own. You can still type a different target yourself.
const CALORIE_FLOORS = { male: 1500, female: 1200, average: 1350 };
const SEX_OFFSETS = { male: 5, female: -161, average: -78 };

const LB_PER_KG = 2.20462;
const CM_PER_INCH = 2.54;

function lbToKg(lb) { return lb / LB_PER_KG; }
function kgToLb(kg) { return kg * LB_PER_KG; }
function feetInchesToCm(feet, inches) { return (feet * 12 + inches) * CM_PER_INCH; }
function cmToFeetInches(cm) {
  const totalInches = Math.round(cm / CM_PER_INCH);
  return { feet: Math.floor(totalInches / 12), inches: totalInches % 12 };
}

// Dates are stored as local calendar days ("2026-11-01"), so a late dinner stays on the day you ate it.
function localDate(d = new Date()) {
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${month}-${day}`;
}

function parseLocalDate(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d, 12);
}

function addDays(s, n) {
  const d = parseLocalDate(s);
  d.setDate(d.getDate() + n);
  return localDate(d);
}

// Mifflin-St Jeor resting calories.
function restingCalories({ sex, kg, cm, age }) {
  return 10 * kg + 6.25 * cm - 5 * age + SEX_OFFSETS[sex];
}

function suggestTargets({ sex, kg, cm, age, activity, pace }) {
  const activityFactor = ACTIVITY_LEVELS.find((a) => a.id === activity).factor;
  const deficit = FAT_LOSS_PACES.find((p) => p.id === pace).deficit;
  const maintenance = restingCalories({ sex, kg, cm, age }) * activityFactor;
  const floor = CALORIE_FLOORS[sex];
  const raw = maintenance * (1 - deficit);
  const kcal = Math.round(Math.max(raw, floor) / 10) * 10;

  // Protein: 1.8 g per kg, capped at 40% of calories so it stays sensible at higher body weights.
  const protein = Math.round(Math.min(1.8 * kg, (kcal * 0.4) / 4) / 5) * 5;
  const fat = Math.round((kcal * 0.25) / 9 / 5) * 5;
  const carbs = Math.max(0, Math.round((kcal - protein * 4 - fat * 9) / 4));

  return {
    kcal,
    protein,
    carbs,
    fat,
    maintenance: Math.round(maintenance / 10) * 10,
    raisedToFloor: raw < floor,
  };
}

function macroCalories({ protein, carbs, fat }) {
  return protein * 4 + carbs * 4 + fat * 9;
}

function portionTotals(food, portionIndex, qty) {
  const portion = food.portions[portionIndex] || food.portions[0];
  const amount = portion.factor * qty;
  return {
    kcal: food.nutrients.kcal * amount,
    protein: food.nutrients.protein * amount,
    carbs: food.nutrients.carbs * amount,
    fat: food.nutrients.fat * amount,
  };
}

function entryTotals(entry) {
  return portionTotals(entry.food, entry.portionIndex, entry.qty);
}

function sumEntries(entries) {
  const total = { kcal: 0, protein: 0, carbs: 0, fat: 0 };
  for (const entry of entries) {
    const t = entryTotals(entry);
    total.kcal += t.kcal;
    total.protein += t.protein;
    total.carbs += t.carbs;
    total.fat += t.fat;
  }
  return total;
}
