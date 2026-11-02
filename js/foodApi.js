// Food search. Turns replies from USDA and Open Food Facts into one shared food format:
//   { key, source, name, brand, nutrients: {kcal, protein, carbs, fat}, portions: [{label, factor}] }
// A portion's factor is how many times `nutrients` that portion contains.

const USDA_DEMO_KEY = 'DEMO_KEY';
const USDA_URL = 'https://api.nal.usda.gov/fdc/v1/foods/search';
const OFF_URL = 'https://world.openfoodfacts.org/cgi/search.pl';
const SEARCH_TIMEOUT_MS = 10000;
const RETRY_DELAY_MS = 700;
const NO_RETRY_STATUSES = [401, 403, 429];
const MAX_KCAL_PER_100 = 1000; // Pure fat is about 900, so anything far above that is bad data.

const SOURCE_LABELS = { usda: 'USDA', off: 'Open Food Facts', custom: 'Your food' };

function titleCaseIfShouting(text) {
  if (!text || text !== text.toUpperCase()) return text;
  return text.toLowerCase().replace(/(^|[\s,(/-])(\p{L})/gu, (m, sep, ch) => sep + ch.toUpperCase());
}

function formatAmount(n) {
  return String(Math.round(n * 10) / 10);
}

function basePortions(unit, servings) {
  const portions = [];
  for (const s of servings) {
    if (!(s.amount > 0) || !s.label) continue;
    const label = `${s.label} (${formatAmount(s.amount)} ${unit})`;
    if (!portions.some((p) => p.label === label)) portions.push({ label, factor: s.amount / 100 });
  }
  portions.push({ label: `100 ${unit}`, factor: 1 });
  portions.push({ label: `1 ${unit}`, factor: 0.01 });
  portions.push(unit === 'ml'
    ? { label: '1 fl oz (30 ml)', factor: 0.2957 }
    : { label: '1 oz (28 g)', factor: 0.2835 });
  return portions;
}

function cleanNumber(value) {
  const n = typeof value === 'string' ? parseFloat(value) : value;
  return Number.isFinite(n) && n >= 0 ? n : null;
}

// Returns complete nutrients, or null when the data is missing or impossible.
function buildNutrients(kcal, protein, carbs, fat) {
  const p = cleanNumber(protein);
  const c = cleanNumber(carbs);
  const f = cleanNumber(fat);
  let k = cleanNumber(kcal);
  if (k === null && p !== null && c !== null && f !== null) k = macroCalories({ protein: p, carbs: c, fat: f });
  if (k === null || k > MAX_KCAL_PER_100) return null;
  return { kcal: k, protein: p ?? 0, carbs: c ?? 0, fat: f ?? 0, macrosMissing: p === null || c === null || f === null };
}

function normalizeUsdaFood(item) {
  const byId = {};
  for (const n of item.foodNutrients || []) byId[n.nutrientId] = n.value;
  // Newer USDA foods sometimes report calories under the Atwater ids instead of 1008.
  const nutrients = buildNutrients(byId[1008] ?? byId[2047] ?? byId[2048], byId[1003], byId[1005], byId[1004]);
  if (!nutrients) return null;

  const servingUnit = String(item.servingSizeUnit || '').toLowerCase();
  const unit = servingUnit === 'ml' || servingUnit === 'mlt' ? 'ml' : 'g';
  const servings = [];
  if (item.servingSize > 0) {
    servings.push({ label: item.householdServingFullText || 'Serving', amount: item.servingSize });
  }
  for (const m of item.foodMeasures || []) {
    if (m.disseminationText && m.disseminationText !== 'Quantity not specified') {
      servings.push({ label: m.disseminationText, amount: m.gramWeight });
    }
  }

  return {
    key: `usda:${item.fdcId}`,
    source: 'usda',
    name: titleCaseIfShouting(item.description) || 'Unnamed food',
    brand: titleCaseIfShouting(item.brandName || item.brandOwner || ''),
    nutrients,
    portions: basePortions(unit, servings),
  };
}

function normalizeOffProduct(product) {
  const n = product.nutriments || {};
  const name = (product.product_name || '').trim();
  if (!name || !product.code) return null;
  const kj = cleanNumber(n.energy_100g);
  const kcal = n['energy-kcal_100g'] ?? (kj === null ? null : kj / 4.184);
  const nutrients = buildNutrients(kcal, n.proteins_100g, n.carbohydrates_100g, n.fat_100g);
  if (!nutrients) return null;

  const sizeText = (product.serving_size || '').trim();
  const unit = /\d\s*ml\b/i.test(sizeText) ? 'ml' : 'g';
  const amount = cleanNumber(product.serving_quantity);
  const servings = amount ? [{ label: 'Serving', amount }] : [];

  return {
    key: `off:${product.code}`,
    source: 'off',
    name,
    brand: (product.brands || '').split(',')[0].trim(),
    nutrients,
    portions: basePortions(unit, servings),
  };
}

async function fetchJsonOnce(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      const error = new Error(`HTTP ${response.status}`);
      error.status = response.status;
      throw error;
    }
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

// Both services sometimes fail once and work seconds later, so try a second time.
// A rejected key or a reached limit won't fix itself, so those aren't retried.
async function fetchJson(url) {
  try {
    return await fetchJsonOnce(url);
  } catch (error) {
    if (NO_RETRY_STATUSES.includes(error.status)) throw error;
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    return fetchJsonOnce(url);
  }
}

async function searchUsda(query, apiKey, dataTypes, pageSize) {
  const params = new URLSearchParams({ query, pageSize, dataType: dataTypes, api_key: apiKey });
  const data = await fetchJson(`${USDA_URL}?${params}`);
  return (data.foods || []).map(normalizeUsdaFood).filter(Boolean);
}

async function searchOpenFoodFacts(query, pageSize) {
  const params = new URLSearchParams({
    search_terms: query,
    search_simple: 1,
    action: 'process',
    json: 1,
    page_size: pageSize,
    fields: 'code,product_name,brands,nutriments,serving_size,serving_quantity',
  });
  const data = await fetchJson(`${OFF_URL}?${params}`);
  return (data.products || []).map(normalizeOffProduct).filter(Boolean);
}

function describeUsdaError(error) {
  if (error.status === 429) return 'USDA search limit reached. Add your own free key in Settings, or try again in an hour.';
  if (error.status === 401 || error.status === 403) return 'USDA did not accept your key. Check it in Settings.';
  return 'USDA search had a problem, so some results may be missing. Try again in a moment.';
}

// Each source can fail by itself, so one outage still leaves results from the others.
async function searchFoods(query, apiKey) {
  const key = apiKey || USDA_DEMO_KEY;
  const [general, usdaBranded, off] = await Promise.allSettled([
    searchUsda(query, key, 'Foundation,SR Legacy,Survey (FNDDS)', 15),
    searchUsda(query, key, 'Branded', 10),
    searchOpenFoodFacts(query, 10),
  ]);

  const errors = [];
  const usdaFailure = [general, usdaBranded].find((r) => r.status === 'rejected');
  if (usdaFailure) errors.push(describeUsdaError(usdaFailure.reason));
  if (off.status === 'rejected') errors.push('Open Food Facts had a problem, so some results may be missing. Try again in a moment.');

  return {
    general: general.status === 'fulfilled' ? general.value : [],
    branded: [
      ...(usdaBranded.status === 'fulfilled' ? usdaBranded.value : []),
      ...(off.status === 'fulfilled' ? off.value : []),
    ],
    errors,
  };
}
