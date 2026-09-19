// MI.ai — turns raw journal text into structured memory fields (owner C, per docs/CONTRACT.md).
// Keyword heuristic only for now; the Claude call goes in later behind the same signature.
// Contract rule: classify() NEVER rejects — a failure anywhere still resolves with a result.
(function () {
  window.MI = window.MI || {};

  var CATEGORY_KEYWORDS = {
    achievement: ['finished', 'won', 'shipped', 'launched', 'passed', 'promoted', 'graduated', 'built', 'completed', 'achieved', 'nailed', 'accepted', 'hired', 'award'],
    travel: ['trip', 'flew', 'flight', 'beach', 'hike', 'hiked', 'travel', 'vacation', 'airport', 'abroad', 'roadtrip', 'camping', 'visited', 'tourist', 'mountains'],
    home: ['home', 'apartment', 'moved', 'cooked', 'cleaned', 'garden', 'kitchen', 'room', 'furniture', 'laundry', 'plants'],
    social: ['friend', 'friends', 'party', 'dinner', 'lunch', 'coffee', 'hung out', 'met', 'birthday', 'wedding', 'together', 'date', 'family', 'call'],
    everyday: ['work', 'class', 'school', 'gym', 'study', 'studied', 'commute', 'errand', 'shopping', 'grocery', 'homework', 'meeting']
  };

  var POSITIVE = ['happy', 'great', 'amazing', 'love', 'loved', 'fun', 'excited', 'proud', 'good', 'best', 'wonderful', 'beautiful', 'glad', 'grateful', 'awesome', 'relaxing', 'finally'];
  var NEGATIVE = ['sad', 'tired', 'stressed', 'bad', 'awful', 'angry', 'anxious', 'hard', 'tough', 'sick', 'worried', 'lonely', 'frustrated', 'exhausted', 'rough'];

  var MOOD_LABELS = [
    { max: -0.5, label: 'rough' },
    { max: -0.15, label: 'low' },
    { max: 0.15, label: 'steady' },
    { max: 0.5, label: 'good' },
    { max: 1.1, label: 'joyful' }
  ];

  // Capitalized words that aren't sentence-initial and aren't common words read as names.
  var NOT_NAMES = new Set(['i', 'i\'m', 'the', 'a', 'an', 'my', 'we', 'it', 'today', 'yesterday', 'tomorrow',
    'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
    'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august',
    'september', 'october', 'november', 'december', 'this', 'that', 'then', 'but', 'and', 'so']);

  // A capitalized word alone isn't enough — "flew to Lisbon" would read as a person.
  // Require a word that actually implies company, and bail on words that imply a place.
  var PERSON_CUES = new Set(['with', 'and', 'met', 'meeting', 'saw', 'texted', 'called', 'told',
    'thanks', 'joined', 'visited', 'hugged', 'missed', 'love', 'invited', 'brought', 'asked']);
  var PLACE_CUES = new Set(['to', 'in', 'at', 'near', 'around', 'through', 'across', 'toward',
    'towards', 'into', 'from', 'past', 'via', 'outside', 'inside']);

  var RELATIONSHIP_HINTS = [
    { words: ['mom', 'mum', 'mother', 'dad', 'father', 'sister', 'brother', 'grandma', 'grandpa', 'cousin', 'aunt', 'uncle'], relationship: 'family' },
    { words: ['boss', 'manager', 'coworker', 'colleague', 'teammate'], relationship: 'work' },
    { words: ['friend', 'buddy', 'roommate'], relationship: 'friend' }
  ];

  // Whole words only, give or take a plural or a tense: matching anywhere inside a word
  // found "met" in "something", "won" in "wonderful" and "home" in "homework", which is how
  // a quiet evening at home used to get filed as work.
  var wordCache = {};
  function wordPattern(word) {
    if (!wordCache[word]) {
      var escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
      wordCache[word] = new RegExp('\\b' + escaped + '(?:s|es|ed|d|ing)?\\b', 'i');
    }
    return wordCache[word];
  }

  function countHits(lower, words) {
    var n = 0;
    words.forEach(function (w) {
      if (wordPattern(w).test(lower)) n++;
    });
    return n;
  }

  // Ties go to the more specific category: 'everyday' is the fallback for anything with no
  // signal, so it should never win a category that actually matched the same number of words.
  var CATEGORY_ORDER = ['achievement', 'travel', 'home', 'social', 'everyday'];

  function pickCategory(lower) {
    var best = null;
    var bestScore = 0;
    CATEGORY_ORDER.forEach(function (cat) {
      var score = countHits(lower, CATEGORY_KEYWORDS[cat]);
      if (score > bestScore) { bestScore = score; best = cat; }
    });
    return best || 'other';
  }

  function pickMood(lower) {
    var pos = countHits(lower, POSITIVE);
    var neg = countHits(lower, NEGATIVE);
    var total = pos + neg;
    var valence = total === 0 ? 0.1 : (pos - neg) / total;
    var intensity = Math.min(1, 0.3 + total * 0.2);
    var label = 'steady';
    for (var i = 0; i < MOOD_LABELS.length; i++) {
      if (valence <= MOOD_LABELS[i].max) { label = MOOD_LABELS[i].label; break; }
    }
    return { label: label, valence: Math.round(valence * 100) / 100, intensity: Math.round(intensity * 100) / 100 };
  }

  function extractPeople(text) {
    var people = [];
    var seen = new Set();
    var sentences = text.split(/(?:^|[.!?]\s+)/);

    sentences.forEach(function (sentence) {
      var words = sentence.trim().split(/\s+/);
      var placeIndices = new Set();

      words.forEach(function (raw, index) {
        var word = raw.replace(/[^A-Za-z'\-]/g, '');
        if (word.length < 2) return;
        if (NOT_NAMES.has(word.toLowerCase())) return;
        if (index === 0) return; // sentence-initial capital tells us nothing
        if (!/^[A-Z][a-z]+$/.test(word)) return;

        var previous = (words[index - 1] || '').replace(/[^A-Za-z']/g, '').toLowerCase();
        if (PLACE_CUES.has(previous)) { placeIndices.add(index); return; } // "to Lisbon"
        // "to Paris and Rome" — the chain inherits the place reading from its first item.
        if (previous === 'and' && placeIndices.has(index - 2)) { placeIndices.add(index); return; }
        if (!PERSON_CUES.has(previous)) return; // conservative: a stray capital isn't a person

        var key = word.toLowerCase();
        if (seen.has(key)) return;
        seen.add(key);

        var relationship = 'friend';
        var context = sentence.toLowerCase();
        RELATIONSHIP_HINTS.forEach(function (hint) {
          if (countHits(context, hint.words) > 0) relationship = hint.relationship;
        });
        people.push({ name: word, relationship: relationship });
      });
    });
    return people;
  }

  function makeTitle(text) {
    var clean = text.trim().replace(/\s+/g, ' ');
    var firstSentence = clean.split(/[.!?]/)[0] || clean;
    if (firstSentence.length <= 48) return firstSentence;
    var cut = firstSentence.slice(0, 48);
    var lastSpace = cut.lastIndexOf(' ');
    return (lastSpace > 20 ? cut.slice(0, lastSpace) : cut) + '…';
  }

  function heuristic(text) {
    var lower = (text || '').toLowerCase();
    var mood = pickMood(lower);
    var people = extractPeople(text || '');
    // Longer entries with strong feeling read as more significant.
    var importance = Math.max(1, Math.min(5,
      1 + Math.round((text || '').length / 120) + Math.round(mood.intensity * 1.5)));

    return {
      title: makeTitle(text || 'A moment'),
      category: pickCategory(lower),
      mood: mood,
      people: people,
      importance: importance
    };
  }

  function safeHeuristic(text) {
    try {
      return heuristic(text);
    } catch (e) {
      return {
        title: 'A moment',
        category: 'other',
        mood: { label: 'steady', valence: 0, intensity: 0.3 },
        people: [],
        importance: 2
      };
    }
  }

  // Contract: never rejects. Tries the server (which calls Claude) and silently falls back to
  // the keyword heuristic on any failure — no key, offline, timeout, bad shape, all the same.
  // The demo has to work with the wifi unplugged.
  function classify(text) {
    var fallback = safeHeuristic(text);

    if (typeof fetch !== 'function') return Promise.resolve(fallback);

    return fetch('/api/classify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: text })
    }).then(function (res) {
      if (!res.ok) return fallback;
      return res.json().then(function (data) {
        // Trust nothing: one missing field and we'd spawn a broken memory.
        if (!data || typeof data.title !== 'string' || !data.mood) return fallback;
        return {
          title: data.title,
          category: data.category || fallback.category,
          mood: data.mood,
          people: Array.isArray(data.people) ? data.people : [],
          importance: data.importance || fallback.importance,
          source: 'claude'
        };
      }, function () { return fallback; });
    }, function () {
      return fallback; // offline, blocked, DNS failure — all fine, we have an answer already
    });
  }

  // guess() is what the entry flow uses: instant, offline, and only ever a starting point —
  // the tag row beside the text box is what actually decides a memory's fields. classify()
  // is Claude, kept for the title suggestion and called from nowhere else.
  MI.ai = { guess: safeHeuristic, classify: classify, heuristic: heuristic };
})();
