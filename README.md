# Fitness Tracker

A personal food and workout tracker that installs on an Android phone as a web app (PWA). There are no accounts, and all personal data stays on the phone.

## How it's built

- Plain HTML, CSS and JavaScript with no build step or Node.js.
- [Alpine.js](https://alpinejs.dev) for screens and [Dexie](https://dexie.org) for the on-phone database, both stored in `lib/`.
- Food data from [USDA FoodData Central](https://fdc.nal.usda.gov) and [Open Food Facts](https://world.openfoodfacts.org).
- Hosted on GitHub Pages. This repository holds only code, never personal data.

## Files

- `index.html`, `app.css`: screens and styling
- `js/app.js`: app behavior
- `js/nutrition.js`: target calculations, totals and dates
- `js/foodApi.js`: food search
- `js/db.js`: on-phone database, backup and restore
- `js/exercises.js`: built-in exercises and the starter program
- `js/workout.js`: schedule rotation and weight progression
- `js/workoutScreen.js`: Workout tab behavior
- `sw.js`: offline support
- `tests/tests.html`: open in a browser to run the tests

## Releasing an update

Change `CACHE_VERSION` in `sw.js` whenever any app file changes, or phones won't pick up the update. If you add a file, also add it to `APP_FILES` there.
