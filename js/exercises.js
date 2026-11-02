// The built-in exercise list and your starter program.
// `kind` decides how much weight the "ready to go up" prompt suggests adding.

const EXERCISE_KINDS = [
  { id: 'dumbbell', label: 'Dumbbell' },
  { id: 'barbell', label: 'Barbell' },
  { id: 'barbellPress', label: 'Barbell press' },
  { id: 'machine', label: 'Machine or cable' },
  { id: 'bodyweight', label: 'Bodyweight' },
];

const EXERCISES = [
  // Legs
  { id: 'goblet-squat', name: 'Goblet squat', kind: 'dumbbell', group: 'Legs', cues: ['Hold the dumbbell against your chest', 'Push your knees out as you sit down'] },
  { id: 'db-split-squat', name: 'Dumbbell split squat', kind: 'dumbbell', group: 'Legs', sideLabel: 'per leg', cues: ['Lower straight down, not forward', 'Push through your front foot'] },
  { id: 'back-squat', name: 'Barbell back squat', kind: 'barbell', group: 'Legs', cues: ['Brace your stomach before each rep', 'Keep your whole foot on the floor'] },
  { id: 'front-squat', name: 'Barbell front squat', kind: 'barbell', group: 'Legs', cues: ['Keep your elbows high', 'Stay tall as you stand up'] },
  { id: 'leg-press', name: 'Leg press', kind: 'machine', group: 'Legs', cues: ['Keep your lower back on the pad', 'Don’t lock your knees hard at the top'] },
  { id: 'db-lunge', name: 'Dumbbell walking lunge', kind: 'dumbbell', group: 'Legs', sideLabel: 'per leg', cues: ['Take a long, controlled step', 'Stay tall through your chest'] },
  { id: 'leg-extension', name: 'Leg extension', kind: 'machine', group: 'Legs', cues: ['Lift smoothly without swinging'] },

  // Hips and hamstrings
  { id: 'db-rdl', name: 'Dumbbell Romanian deadlift', kind: 'dumbbell', group: 'Hips and hamstrings', cues: ['Push your hips back like closing a car door', 'Keep the dumbbells close to your legs'] },
  { id: 'barbell-rdl', name: 'Romanian deadlift', kind: 'barbell', group: 'Hips and hamstrings', cues: ['Push your hips back with a slight knee bend', 'Keep the bar close and your back flat'] },
  { id: 'deadlift', name: 'Barbell deadlift', kind: 'barbell', group: 'Hips and hamstrings', cues: ['Start with the bar over the middle of your foot', 'Brace, then stand up without jerking the bar'] },
  { id: 'hip-thrust', name: 'Barbell hip thrust', kind: 'barbell', group: 'Hips and hamstrings', cues: ['Tuck your chin slightly', 'Squeeze your glutes at the top'] },
  { id: 'leg-curl', name: 'Leg curl', kind: 'machine', group: 'Hips and hamstrings', cues: ['Lower slowly with control'] },

  // Push
  { id: 'db-bench', name: 'Dumbbell bench press', kind: 'dumbbell', group: 'Push', cues: ['Pull your shoulder blades back and down', 'Lower to chest level with elbows angled in'] },
  { id: 'db-ohp', name: 'Dumbbell overhead press', kind: 'dumbbell', group: 'Push', cues: ['Squeeze your glutes and brace your stomach', 'Press up without leaning back'] },
  { id: 'bench-press', name: 'Barbell bench press', kind: 'barbellPress', group: 'Push', cues: ['Keep your feet planted and shoulder blades back', 'Touch your lower chest, then press'] },
  { id: 'overhead-press', name: 'Barbell overhead press', kind: 'barbellPress', group: 'Push', cues: ['Brace your stomach and glutes', 'Move your head back so the bar travels straight'] },
  { id: 'incline-db-press', name: 'Incline dumbbell press', kind: 'dumbbell', group: 'Push', cues: ['Use a low incline', 'Keep your shoulder blades pulled back'] },
  { id: 'machine-chest-press', name: 'Machine chest press', kind: 'machine', group: 'Push', cues: ['Set the handles at mid-chest height', 'Keep your shoulders down and back'] },
  { id: 'push-up', name: 'Push-up', kind: 'bodyweight', group: 'Push', cues: ['Keep your body in one straight line', 'Lower your chest close to the floor'] },

  // Pull
  { id: 'one-arm-row', name: 'One-arm dumbbell row', kind: 'dumbbell', group: 'Pull', sideLabel: 'per arm', cues: ['Keep your back flat and still', 'Pull your elbow toward your hip'] },
  { id: 'lat-pulldown', name: 'Lat pulldown', kind: 'machine', group: 'Pull', cues: ['Pull your elbows down toward your ribs', 'Don’t lean far back or swing'] },
  { id: 'cable-row', name: 'Seated cable row', kind: 'machine', group: 'Pull', cues: ['Sit tall through the whole rep', 'Pull your shoulder blades together'] },
  { id: 'barbell-row', name: 'Barbell row', kind: 'barbell', group: 'Pull', cues: ['Keep your back flat and hinge at the hips', 'Pull the bar to your lower ribs'] },
  { id: 'chest-supported-row', name: 'Chest-supported dumbbell row', kind: 'dumbbell', group: 'Pull', cues: ['Keep your chest on the pad', 'Pull your elbows back and squeeze'] },
  { id: 'assisted-pull-up', name: 'Assisted pull-up', kind: 'machine', group: 'Pull', cues: ['Start from a full hang', 'Pull your chest toward the bar'] },
  { id: 'pull-up', name: 'Pull-up', kind: 'bodyweight', group: 'Pull', cues: ['Start from a full hang', 'Pull your chest toward the bar'] },

  // Shoulders and arms
  { id: 'lateral-raise', name: 'Dumbbell lateral raise', kind: 'dumbbell', group: 'Shoulders and arms', cues: ['Lead with your elbows', 'Stop around shoulder height'] },
  { id: 'face-pull', name: 'Cable face pull', kind: 'machine', group: 'Shoulders and arms', cues: ['Pull the rope toward your forehead', 'Finish with your elbows high'] },
  { id: 'db-curl', name: 'Dumbbell curl', kind: 'dumbbell', group: 'Shoulders and arms', cues: ['Keep your elbows by your sides'] },
  { id: 'triceps-pushdown', name: 'Triceps pushdown', kind: 'machine', group: 'Shoulders and arms', cues: ['Keep your elbows pinned to your sides'] },

  // Core
  { id: 'plank', name: 'Plank', kind: 'bodyweight', group: 'Core', cues: ['Squeeze your glutes and stomach', 'Log each hold in seconds as reps'] },
  { id: 'hanging-knee-raise', name: 'Hanging knee raise', kind: 'bodyweight', group: 'Core', cues: ['Curl your hips up without swinging'] },
];

const NEW_EXERCISE_DEFAULTS = { sets: 3, repMin: 8, repMax: 10, restSec: 90 };

// Two full-body workouts of 4 free-weight-focused compound lifts, built for learning technique.
const STARTER_WORKOUTS = [
  {
    id: 'A',
    name: 'Workout A',
    exercises: [
      { exerciseId: 'goblet-squat', sets: 3, repMin: 8, repMax: 10, restSec: 120 },
      { exerciseId: 'db-bench', sets: 3, repMin: 6, repMax: 10, restSec: 120 },
      { exerciseId: 'one-arm-row', sets: 3, repMin: 8, repMax: 10, restSec: 90 },
      { exerciseId: 'db-rdl', sets: 2, repMin: 8, repMax: 10, restSec: 90 },
    ],
  },
  {
    id: 'B',
    name: 'Workout B',
    exercises: [
      { exerciseId: 'barbell-rdl', sets: 3, repMin: 6, repMax: 10, restSec: 120 },
      { exerciseId: 'db-ohp', sets: 3, repMin: 6, repMax: 10, restSec: 120 },
      { exerciseId: 'lat-pulldown', sets: 3, repMin: 8, repMax: 10, restSec: 90 },
      { exerciseId: 'db-split-squat', sets: 2, repMin: 8, repMax: 10, restSec: 90 },
    ],
  },
];

// Weekdays count from Monday: 0 is Monday, 2 is Wednesday, 4 is Friday.
const STARTER_DAYS = [0, 2, 4];
const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const CARDIO_TYPES = ['Walk', 'Run', 'Cycle', 'Elliptical', 'Rower', 'Stairs', 'Other'];
