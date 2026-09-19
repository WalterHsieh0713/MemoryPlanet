// Offline check for the keyword guess in src/ai/classify.js. Run:  node scripts/test-guess.js
// The guess only pre-selects the tag row beside the entry box — the tags are what decide a
// memory — but a guess that reads "a quiet evening at home" as work makes the row feel
// broken, and keyword matching is exactly the kind of thing that rots silently.
var path = require('path');
var fs = require('fs');
var vm = require('vm');

var ctx = { console: console, Math: Math, Set: Set, Object: Object, Array: Array,
  JSON: JSON, RegExp: RegExp, String: String, Promise: Promise };
ctx.window = ctx;
ctx.self = ctx;
vm.createContext(ctx);
vm.runInContext(
  fs.readFileSync(path.join(__dirname, '..', 'src', 'ai', 'classify.js'), 'utf8'),
  ctx, { filename: 'classify.js' });
var guess = ctx.MI.ai.guess;

// [entry, acceptable categories, the people it should offer]
var CASES = [
  ['There was something strange about the light today', 'everyday|other', []],
  ['Pushed an update to the site this afternoon', 'everyday|other|achievement', []],
  ['The garden looked wonderful after the rain', 'home', []],
  ['Homework all evening, endless', 'everyday', []],
  ['Coffee with Sam and Jordan, laughed so much', 'social', ['Sam', 'Jordan']],
  ['Flew to Lisbon with Maya and wandered the old town', 'travel', ['Maya']],
  ['Finally finished the project I have been building for months', 'achievement', []],
  ['Long slow morning at home, cooked properly and repotted the plants', 'home', []],
  ['Hiked up to the ridge at sunrise with Ana', 'travel', ['Ana']],
  ['Tough week at work, tired and stressed', 'everyday', []]
];

// Words that used to match a keyword hiding inside them.
var TRAPS = ['something', 'update', 'wonderful', 'homework', 'strip', 'bedroom', 'saddle', 'badge'];

var failures = 0;
CASES.forEach(function (test) {
  var got = guess(test[0]);
  var names = got.people.map(function (p) { return p.name; });
  var categoryOk = test[1].split('|').indexOf(got.category) !== -1;
  var peopleOk = JSON.stringify(names) === JSON.stringify(test[2]);
  if (categoryOk && peopleOk) return;
  failures++;
  console.log('MISS "' + test[0] + '"');
  console.log('     category ' + got.category + ' (want ' + test[1] + '), people '
    + JSON.stringify(names) + ' (want ' + JSON.stringify(test[2]) + ')');
});

TRAPS.forEach(function (word) {
  var got = guess('The ' + word + ' was fine');
  // Nothing in that sentence is a real signal, so anything but the fallbacks is a stray hit.
  if (got.category === 'everyday' || got.category === 'other') return;
  failures++;
  console.log('MISS "' + word + '" still matches a keyword inside it -> ' + got.category);
});

// Mood swings with the words, not with their substrings.
var happy = guess('A wonderful, joyful day, so proud');
var rough = guess('An awful day, exhausted and frustrated');
if (!(happy.mood.valence > 0.5)) { failures++; console.log('MISS happy entry read as ' + happy.mood.label); }
if (!(rough.mood.valence < -0.5)) { failures++; console.log('MISS rough entry read as ' + rough.mood.label); }

console.log(failures === 0
  ? '--- all guess checks passed (' + (CASES.length + TRAPS.length + 2) + ') ---'
  : '--- ' + failures + ' guess checks failed ---');
process.exit(failures ? 1 : 0);
