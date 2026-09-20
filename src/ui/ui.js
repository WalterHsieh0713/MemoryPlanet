// MI.ui — the friendly layer over MI.app. Owns all DOM; the world/store modules never
// touch the page so they stay reusable.
(function () {
  window.MI = window.MI || {};

  var CATEGORY_FLAVOR = {
    achievement: { emoji: '🏰', line: 'A castle rose!' },
    everyday: { emoji: '🏡', line: 'A little house appeared!' },
    travel: { emoji: '⛵', line: 'A harbour appeared!' },
    home: { emoji: '🌾', line: 'A farm sprang up!' },
    social: { emoji: '🎪', line: 'A village gathered!' },
    other: { emoji: '⛏️', line: 'Something new appeared!' }
  };

  var DEMO_ENTRIES = [
    'Finally finished the project I have been building for months, so proud of it',
    'Flew to Lisbon with Maya and we spent the whole day wandering the old town',
    'Long slow morning at home, cooked properly and repotted all the plants',
    'Coffee with Sam and Jordan, laughed so much my face hurt',
    'Tough week at work, tired and a bit stressed but got through it',
    'Hiked up to the ridge at sunrise with Ana, the view was unreal'
  ];

  var el = {};
  var toastTimer = null;

  function $(id) { return document.getElementById(id); }

  function cacheElements() {
    ['stats-chip', 'stats-text', 'entry-input', 'submit-btn', 'empty-hint', 'demo-btn',
      'toast', 'toast-emoji', 'toast-headline', 'toast-sub', 'detail', 'detail-close',
      'detail-cat', 'detail-title', 'detail-date', 'detail-text', 'detail-pills', 'loading',
      'reset-btn', 'view-btn', 'detail-swaps', 'toast-shards',
      'planet-card', 'planet-size', 'planet-tiles', 'planet-bar', 'planet-hint',
      'wallet', 'wallet-count', 'shop-btn', 'shop', 'shop-close', 'shop-balance', 'shop-items',
      'journal', 'book', 'book-btn', 'book-close', 'book-count', 'book-note',
      'book-list', 'book-write-tab', 'book-memories-tab', 'write-date', 'title-suggest',
      'tag-row', 'tag-people', 'tag-person-input', 'tag-person-list',
      'tag-mood', 'tag-cat', 'tag-big', 'mic-btn', 'settings-btn', 'settings',
      'book-tabs-left', 'book-tabs-right', 'book-write-panel', 'book-right-body',
      'book-heading', 'book-mobile-tabs']
      .forEach(function (id) { el[id] = $(id); });
  }

  function plural(n, word) {
    return n + ' ' + word + (n === 1 ? '' : 's');
  }

  function refreshStats() {
    var world = MI.store.get();
    var memories = world.memories.length;
    var people = world.people.length;

    el['stats-text'].textContent = memories === 0
      ? 'a quiet ocean'
      : plural(memories, 'memory').replace('memorys', 'memories')
        + (people ? ' · ' + plural(people, 'friend') : '');

    el['empty-hint'].classList.toggle('show', memories === 0);
    el['view-btn'].classList.toggle('show', memories > 0);
    if (el['reset-btn']) el['reset-btn'].disabled = memories === 0;

    el['stats-chip'].classList.add('bump');
    setTimeout(function () { el['stats-chip'].classList.remove('bump'); }, 400);
    refreshWallet();
    refreshPlanet();
    renderBook();
    refreshPersonList();
  }

  // --- The tag row ------------------------------------------------------------------------
  // Who was there, how it felt, what kind of day: asked rather than guessed. The keyword
  // guess pre-selects as you type, so the fast path is still type-and-enter, but a control
  // you have touched is never overwritten by a later guess.

  // Faces map onto the same mood shape the rest of the app stores.
  var MOODS = [
    { key: 'rough', emoji: '😞', label: 'rough', valence: -0.8, intensity: 0.8 },
    { key: 'low', emoji: '😕', label: 'low', valence: -0.35, intensity: 0.5 },
    { key: 'steady', emoji: '😐', label: 'steady', valence: 0.05, intensity: 0.3 },
    { key: 'good', emoji: '🙂', label: 'good', valence: 0.45, intensity: 0.5 },
    { key: 'joyful', emoji: '😄', label: 'joyful', valence: 0.9, intensity: 0.85 }
  ];
  var CATEGORIES = ['achievement', 'everyday', 'travel', 'home', 'social', 'other'];

  // people: [{ name, personId? }] — personId set when picked from the people you already have.
  var tags = { people: [], mood: null, category: null, big: false };
  var touched = {};   // controls the writer has set by hand; guesses leave these alone
  var guessTimer = null;

  function moodFor(key) {
    return MOODS.filter(function (m) { return m.key === key; })[0] || null;
  }

  // The stored mood label comes from thresholds in classify.js, so a guess arrives as a
  // label rather than one of our keys.
  function moodKeyFromLabel(label) {
    return moodFor(label) ? label : 'steady';
  }

  function buildTagRow() {
    MOODS.forEach(function (mood) {
      var button = document.createElement('button');
      button.className = 'tag-opt';
      button.textContent = mood.emoji;
      button.title = mood.label;
      button.setAttribute('aria-label', mood.label);
      button.setAttribute('aria-pressed', 'false');
      button.addEventListener('click', function () {
        touched.mood = true;
        tags.mood = tags.mood === mood.key ? null : mood.key;
        paintTagRow();
      });
      el['tag-mood'].appendChild(button);
    });

    CATEGORIES.forEach(function (category) {
      var flavor = CATEGORY_FLAVOR[category] || CATEGORY_FLAVOR.other;
      var button = document.createElement('button');
      button.className = 'tag-opt';
      button.textContent = flavor.emoji;
      button.title = category;
      button.setAttribute('aria-label', category);
      button.setAttribute('aria-pressed', 'false');
      button.addEventListener('click', function () {
        touched.category = true;
        tags.category = tags.category === category ? null : category;
        paintTagRow();
      });
      el['tag-cat'].appendChild(button);
    });

    el['tag-big'].addEventListener('click', function () {
      touched.importance = true;
      tags.big = !tags.big;
      paintTagRow();
    });

    el['tag-person-input'].addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); commitPerson(); }
      if (e.key === 'Backspace' && !el['tag-person-input'].value && tags.people.length) {
        tags.people.pop();
        paintTagRow();
      }
    });
    // Picking from the datalist fires input, not change, in some browsers; both are cheap.
    el['tag-person-input'].addEventListener('change', commitPerson);
    el['tag-person-input'].addEventListener('blur', commitPerson);
  }

  function commitPerson() {
    var name = el['tag-person-input'].value.trim();
    if (!name) return;
    touched.people = true;
    el['tag-person-input'].value = '';
    addPersonTag(name);
  }

  function addPersonTag(name, personId) {
    var key = name.trim().toLowerCase();
    if (!key) return;
    var already = tags.people.filter(function (p) { return p.name.toLowerCase() === key; });
    if (already.length) return;
    // Typing a name you already have is the same person — no need to ask.
    var known = personId ? null : MI.store.findPerson(name);
    tags.people.push({ name: name.trim(), personId: personId || (known && known.id) || null });
    paintTagRow();
  }

  function paintTagRow() {
    el['tag-people'].innerHTML = '';
    tags.people.forEach(function (entry, index) {
      var person = entry.personId
        ? MI.store.get().people.filter(function (p) { return p.id === entry.personId; })[0]
        : null;
      var chip = document.createElement('span');
      chip.className = 'tag-chip';
      if (person && person.appearance && person.appearance.color !== undefined) {
        var dot = document.createElement('span');
        dot.className = 'dot';
        dot.style.background = '#' + person.appearance.color.toString(16).padStart(6, '0');
        chip.appendChild(dot);
      }
      chip.appendChild(document.createTextNode(entry.name));
      var remove = document.createElement('button');
      remove.type = 'button';
      remove.textContent = '×';
      remove.setAttribute('aria-label', 'Remove ' + entry.name);
      remove.addEventListener('click', function () {
        touched.people = true;
        tags.people.splice(index, 1);
        paintTagRow();
      });
      chip.appendChild(remove);
      el['tag-people'].appendChild(chip);
    });

    Array.prototype.forEach.call(el['tag-mood'].children, function (button, i) {
      button.setAttribute('aria-pressed', String(MOODS[i].key === tags.mood));
    });
    Array.prototype.forEach.call(el['tag-cat'].children, function (button, i) {
      button.setAttribute('aria-pressed', String(CATEGORIES[i] === tags.category));
    });
    el['tag-big'].setAttribute('aria-pressed', String(tags.big));
  }

  // Offer the people this world already knows, so the same name means the same person.
  function refreshPersonList() {
    el['tag-person-list'].innerHTML = '';
    MI.store.get().people.forEach(function (person) {
      var option = document.createElement('option');
      option.value = person.name;
      el['tag-person-list'].appendChild(option);
    });
  }

  function guessTags() {
    var text = el['entry-input'].value.trim();
    if (!text) { resetTags(); return; }
    var guess = MI.ai.guess(text);
    if (!touched.category) tags.category = guess.category;
    if (!touched.mood) tags.mood = moodKeyFromLabel(guess.mood.label);
    if (!touched.people) {
      tags.people = (guess.people || []).map(function (p) {
        var known = MI.store.findPerson(p.name);
        return { name: p.name, personId: known ? known.id : null };
      });
    }
    paintTagRow();
  }

  function resetTags() {
    tags = { people: [], mood: null, category: null, big: false };
    touched = {};
    el['tag-person-input'].value = '';
    paintTagRow();
  }

  function currentTags() {
    var mood = moodFor(tags.mood);
    return {
      people: tags.people.slice(),
      category: tags.category,
      mood: mood ? { label: mood.label, valence: mood.valence, intensity: mood.intensity } : null,
      importance: tags.big ? 4 : null
    };
  }

  // --- Opening the book ---------------------------------------------------------------------

  var bookOpener = null;
  var bookFocusTimer = null;

  function selectBookPage(page) {
    setBookView(page === 'memories' ? { kind: 'toc' } : { kind: 'write' });
  }

  var bookView = { kind: 'write' };
  var MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  var CLIP = {
    achievement: '#c9a46a', everyday: '#8fbf7a', travel: '#6aa7c9',
    home: '#d4a574', social: '#c989b0', other: '#9aa7b0'
  };

  function isNarrowBook() {
    return window.matchMedia('(max-width: 680px)').matches;
  }

  function setBookView(view) {
    bookView = view || { kind: 'write' };
    var writing = bookView.kind === 'write';
    el.book.dataset.page = writing ? 'write' : 'read';
    el['book-write-tab'].setAttribute('aria-selected', String(writing));
    el['book-memories-tab'].setAttribute('aria-selected', String(bookView.kind === 'toc'));
    el['book-write-panel'].hidden = !writing;
    el['book-right-body'].hidden = writing;
    renderBook();
    if (writing && window.innerWidth <= 680 && isBookOpen()) el['entry-input'].focus();
  }

  function openBook(event) {
    if (isBookOpen()) return;
    clearTimeout(toastTimer);
    el.toast.classList.remove('show');
    bookOpener = event && event.currentTarget || document.activeElement;
    var rect = el['book-btn'].querySelector('.mini-book').getBoundingClientRect();
    el.book.style.setProperty('--book-from-x', (rect.left + rect.width / 2 - window.innerWidth / 2) + 'px');
    el.book.style.setProperty('--book-from-y', (rect.top + rect.height / 2 - window.innerHeight / 2) + 'px');
    el.book.style.setProperty('--book-from-scale', rect.width / el.book.querySelector('.spread').offsetWidth);
    // Apply the miniature's measured starting pose before beginning the expansion.
    void el.book.offsetWidth;
    refreshPersonList();
    renderBook();
    el['write-date'].textContent = new Date().toLocaleDateString(undefined,
      { weekday: 'long', month: 'long', day: 'numeric' });
    selectBookPage('write');
    el.book.classList.add('open');
    el['book-btn'].setAttribute('aria-expanded', 'true');
    // Wait for the book to become visible before moving keyboard focus inside it.
    bookFocusTimer = setTimeout(function () {
      if (isBookOpen() && el.book.dataset.page === 'write') el['entry-input'].focus();
    }, 530);
  }

  function closeBook() {
    stopListening({ silent: true });
    clearTimeout(bookFocusTimer);
    el.book.classList.remove('open');
    el['book-btn'].setAttribute('aria-expanded', 'false');
    if (bookOpener && bookOpener.isConnected) bookOpener.focus();
  }

  function isBookOpen() {
    return el.book.classList.contains('open');
  }

  // --- The book ---------------------------------------------------------------------------
  // Tabbed scrapbook: TOC + years on the left, a tab per person on the right. Pages are
  // two-way linked with the planet: hovering a diary entry marks its tile.

  var rowBySlot = {};

  function memoryOn(memory) {
    return (memory.occurredOn || memory.createdAt || '').slice(0, 10);
  }

  function dayLabel(iso) {
    var today = new Date().toISOString().slice(0, 10);
    if (iso === today) return 'today';
    try {
      return new Date(iso + 'T12:00:00').toLocaleDateString(undefined, { month: 'long', day: 'numeric' });
    } catch (e) {
      return iso;
    }
  }

  function personHex(person) {
    var color = (person && person.appearance && person.appearance.color) || 0x7fa3ae;
    return '#' + color.toString(16).padStart(6, '0');
  }

  function mixPaper(hex) {
    var n = parseInt(String(hex).replace('#', ''), 16);
    if (isNaN(n)) return '#e8dcc8';
    var r = n >> 16, g = (n >> 8) & 255, b = n & 255;
    return 'rgb(' + Math.round(r * 0.4 + 247 * 0.6) + ',' +
      Math.round(g * 0.4 + 241 * 0.6) + ',' +
      Math.round(b * 0.4 + 228 * 0.6) + ')';
  }

  function sortMemories(list) {
    return list.slice().sort(function (a, b) {
      var byDate = String(b.occurredOn || '').localeCompare(String(a.occurredOn || ''));
      return byDate !== 0 ? byDate : String(b.createdAt).localeCompare(String(a.createdAt));
    });
  }

  function memoriesWithPerson(world, personId) {
    return sortMemories(world.memories.filter(function (m) {
      return (m.people || []).indexOf(personId) !== -1;
    }));
  }

  function dateTree(world) {
    var tree = {};
    world.memories.forEach(function (memory) {
      var on = memoryOn(memory);
      if (on.length < 10) return;
      var y = on.slice(0, 4), mo = on.slice(5, 7), d = on.slice(8, 10);
      tree[y] = tree[y] || {};
      tree[y][mo] = tree[y][mo] || {};
      tree[y][mo][d] = tree[y][mo][d] || [];
      tree[y][mo][d].push(memory);
    });
    return tree;
  }

  function yearsOf(world) {
    var years = {};
    world.memories.forEach(function (m) {
      var y = memoryOn(m).slice(0, 4);
      if (y) years[y] = true;
    });
    return Object.keys(years).sort().reverse();
  }

  function memoriesInRange(world, prefix) {
    return sortMemories(world.memories.filter(function (m) {
      return memoryOn(m).indexOf(prefix) === 0;
    }));
  }

  function makeTab(label, className, selected, onClick) {
    var tab = document.createElement('button');
    tab.type = 'button';
    tab.className = 'book-tab' + (className ? ' ' + className : '');
    tab.textContent = label;
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-selected', String(!!selected));
    tab.addEventListener('click', onClick);
    return tab;
  }

  function renderSideTabs(world) {
    el['book-tabs-left'].innerHTML = '';
    el['book-tabs-right'].innerHTML = '';
    var years = yearsOf(world);

    el['book-tabs-left'].appendChild(makeTab('contents', 'toc', bookView.kind === 'toc', function () {
      setBookView({ kind: 'toc' });
    }));
    el['book-tabs-left'].appendChild(makeTab('write', 'write', bookView.kind === 'write', function () {
      setBookView({ kind: 'write' });
    }));
    years.forEach(function (year) {
      el['book-tabs-left'].appendChild(makeTab(year, 'year', bookView.kind === 'date' && bookView.prefix === year, function () {
        setBookView({ kind: 'date', prefix: year });
      }));
    });

    world.people.forEach(function (person) {
      var tab = makeTab(person.name, 'person', bookView.kind === 'person' && bookView.id === person.id, function () {
        setBookView({ kind: 'person', id: person.id });
      });
      tab.style.background = mixPaper(personHex(person));
      tab.style.color = '#2a241c';
      el['book-tabs-right'].appendChild(tab);
    });

    // Extra people tabs on the phone strip (Write / Contents stay in the markup).
    Array.prototype.slice.call(el['book-mobile-tabs'].querySelectorAll('[data-dynamic="1"]'))
      .forEach(function (node) { node.parentNode.removeChild(node); });
    years.forEach(function (year) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.dataset.dynamic = '1';
      btn.textContent = year;
      btn.setAttribute('aria-selected', String(bookView.kind === 'date' && bookView.prefix === year));
      btn.addEventListener('click', function () { setBookView({ kind: 'date', prefix: year }); });
      el['book-mobile-tabs'].appendChild(btn);
    });
    world.people.forEach(function (person) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.dataset.dynamic = '1';
      btn.textContent = person.name;
      btn.setAttribute('aria-selected', String(bookView.kind === 'person' && bookView.id === person.id));
      btn.addEventListener('click', function () { setBookView({ kind: 'person', id: person.id }); });
      el['book-mobile-tabs'].appendChild(btn);
    });
  }

  function renderBook() {
    var world = MI.store.get();
    var count = world.memories.length;
    el['book-count'].textContent = count ? count : '';
    rowBySlot = {};
    renderSideTabs(world);

    el['book-list'].innerHTML = '';
    el['book-right-body'].innerHTML = '';

    if (bookView.kind === 'write') {
      el['book-heading'].textContent = 'scene list';
      el['book-note'].textContent = count ? plural(count, 'memory').replace('memorys', 'memories') : 'blank pages';
      renderSceneList(world, el['book-list']);
      return;
    }
    if (bookView.kind === 'toc') {
      renderToc(world);
      return;
    }
    if (bookView.kind === 'person') {
      renderPersonPages(world, bookView.id);
      return;
    }
    renderDatePages(world, bookView.prefix || '');
  }

  function kicker(text) {
    var node = document.createElement('div');
    node.className = 'toc-kicker';
    node.textContent = text;
    return node;
  }

  function renderSceneList(world, into) {
    if (!world.memories.length) {
      var blank = document.createElement('div');
      blank.className = 'empty-page';
      blank.textContent = 'Nothing written yet. Whatever you put on the right becomes a building on your planet.';
      into.appendChild(blank);
      return;
    }
    into.appendChild(kicker('recent'));
    sortMemories(world.memories).slice(0, 8).forEach(function (memory) {
      into.appendChild(buildDiaryEntry(memory, world, true));
    });
  }

  function renderToc(world) {
    el['book-heading'].textContent = 'contents';
    el['book-note'].textContent = 'years · months · days';
    var left = el['book-list'];
    var right = el['book-right-body'];
    var tree = dateTree(world);

    left.appendChild(kicker('table of contents'));
    var years = Object.keys(tree).sort().reverse();
    if (!years.length) {
      var blank = document.createElement('div');
      blank.className = 'empty-page';
      blank.textContent = 'Dates will gather here as you write.';
      left.appendChild(blank);
    }
    years.forEach(function (year) {
      var yh = document.createElement('button');
      yh.type = 'button';
      yh.className = 'toc-year';
      yh.textContent = year;
      yh.addEventListener('click', function () { setBookView({ kind: 'date', prefix: year }); });
      left.appendChild(yh);
      Object.keys(tree[year]).sort().reverse().forEach(function (mo) {
        var mh = document.createElement('div');
        mh.className = 'toc-month';
        mh.textContent = MONTHS[Number(mo) - 1] || mo;
        left.appendChild(mh);
        Object.keys(tree[year][mo]).sort().reverse().forEach(function (d) {
          var iso = year + '-' + mo + '-' + d;
          var n = tree[year][mo][d].length;
          var row = document.createElement('button');
          row.type = 'button';
          row.className = 'toc-day';
          var label = document.createElement('span');
          label.textContent = Number(d) + '  ' + (tree[year][mo][d][0].title || '');
          var dots = document.createElement('span');
          dots.className = 'dots';
          var countEl = document.createElement('span');
          countEl.className = 'n';
          countEl.textContent = n;
          row.appendChild(label);
          row.appendChild(dots);
          row.appendChild(countEl);
          row.addEventListener('click', function () { setBookView({ kind: 'date', prefix: iso }); });
          left.appendChild(row);
        });
      });
    });

    var peopleHost = isNarrowBook() ? left : right;
    peopleHost.appendChild(kicker('people'));
    if (!world.people.length) {
      var none = document.createElement('div');
      none.className = 'empty-page';
      none.textContent = 'Names you add while writing get a tab of their own, along this edge.';
      peopleHost.appendChild(none);
      return;
    }
    world.people.forEach(function (person) {
      var n = memoriesWithPerson(world, person.id).length;
      var row = document.createElement('button');
      row.type = 'button';
      row.className = 'toc-person';
      var who = document.createElement('span');
      var dot = document.createElement('span');
      dot.className = 'who-dot';
      dot.style.background = personHex(person);
      who.appendChild(dot);
      who.appendChild(document.createTextNode(person.name));
      row.appendChild(who);
      var countEl = document.createElement('span');
      countEl.className = 'n';
      countEl.textContent = n;
      row.appendChild(countEl);
      row.addEventListener('click', function () { setBookView({ kind: 'person', id: person.id }); });
      peopleHost.appendChild(row);
    });
  }

  function splitAcrossPages(items, left, right) {
    if (isNarrowBook() || !right) {
      items.forEach(function (node) { left.appendChild(node); });
      return;
    }
    var mid = Math.ceil(items.length / 2) || 0;
    items.forEach(function (node, i) {
      (i < mid ? left : right).appendChild(node);
    });
  }

  function renderDatePages(world, prefix) {
    var list = memoriesInRange(world, prefix);
    var label = prefix.length === 10 ? dayLabel(prefix)
      : prefix.length === 7 ? (MONTHS[Number(prefix.slice(5, 7)) - 1] + ' ' + prefix.slice(0, 4))
      : prefix;
    el['book-heading'].textContent = label || 'pages';
    el['book-note'].textContent = list.length ? plural(list.length, 'memory').replace('memorys', 'memories') : '';
    if (!list.length) {
      var blank = document.createElement('div');
      blank.className = 'empty-page';
      blank.textContent = 'No memories on this page yet.';
      el['book-list'].appendChild(blank);
      return;
    }
    var nodes = list.map(function (memory) { return buildDiaryEntry(memory, world, false); });
    splitAcrossPages(nodes, el['book-list'], el['book-right-body']);
  }

  function renderPersonPages(world, personId) {
    var person = world.people.filter(function (p) { return p.id === personId; })[0];
    var list = memoriesWithPerson(world, personId);
    el['book-heading'].textContent = person ? person.name : 'someone';
    el['book-note'].textContent = list.length ? plural(list.length, 'memory').replace('memorys', 'memories') : 'no pages yet';
    var banner = document.createElement('div');
    banner.className = 'person-banner';
    var h = document.createElement('h3');
    h.textContent = person ? person.name : '';
    var p = document.createElement('p');
    p.textContent = list.length
      ? 'all the days written with them'
      : 'write them into a memory and this chapter fills in';
    banner.appendChild(h);
    banner.appendChild(p);
    el['book-list'].appendChild(banner);
    if (!list.length) return;
    var nodes = list.map(function (memory) { return buildDiaryEntry(memory, world, false); });
    splitAcrossPages(nodes, el['book-list'], el['book-right-body']);
  }

  function buildDiaryEntry(memory, world, compact) {
    var flavor = CATEGORY_FLAVOR[memory.category] || CATEGORY_FLAVOR.other;
    var row = document.createElement('button');
    row.type = 'button';
    row.className = 'diary-entry';

    var date = document.createElement('span');
    date.className = 'd-date';
    date.textContent = dayLabel(memoryOn(memory));
    row.appendChild(date);

    if (!compact) {
      var clip = document.createElement('span');
      clip.className = 'd-clip';
      clip.style.background = CLIP[memory.category] || CLIP.other;
      clip.title = memory.category;
      row.appendChild(clip);
    }

    var title = document.createElement('span');
    title.className = 'd-title';
    title.textContent = memory.title || flavor.line;
    row.appendChild(title);

    if (!compact && memory.text) {
      var text = document.createElement('span');
      text.className = 'd-text';
      text.textContent = memory.text;
      row.appendChild(text);
    }

    var people = (memory.people || []).map(function (id) {
      return world.people.filter(function (p) { return p.id === id; })[0];
    }).filter(Boolean);
    if (people.length) {
      var who = document.createElement('span');
      who.className = 'd-who';
      people.forEach(function (person) {
        var dot = document.createElement('span');
        dot.className = 'who-dot';
        dot.style.background = personHex(person);
        who.appendChild(dot);
      });
      who.appendChild(document.createTextNode(people.map(function (p) { return p.name; }).join(', ')));
      row.appendChild(who);
    }

    if (!compact && memory.mood && memory.mood.label) {
      var note = document.createElement('span');
      note.className = 'd-note';
      note.textContent = memory.mood.label;
      row.appendChild(note);
    }

    var slot = memory.placement && memory.placement.slot;
    if (slot !== undefined && slot !== null) {
      rowBySlot[slot] = row;
      if (slot === openSlot) row.classList.add('current');
      row.addEventListener('mouseenter', function () {
        if (openSlot === null) MI.world.highlightSlot(slot, { soft: true });
      });
      row.addEventListener('mouseleave', function () {
        if (openSlot === null) MI.world.clearHighlight();
      });
      row.addEventListener('click', function () {
        closeBook();
        showDetail(memory);
        MI.world.focus(slot);
      });
    }
    return row;
  }

  // Keep the list in step with whatever is open, and bring that row into view.
  function markOpenRow(scrollTo) {
    Object.keys(rowBySlot).forEach(function (slot) {
      rowBySlot[slot].classList.toggle('current', Number(slot) === openSlot);
    });
    var row = openSlot === null ? null : rowBySlot[openSlot];
    if (!row || !scrollTo) return;
    row.scrollIntoView({ block: 'nearest' });
    bump(row, 'flash');
  }

  // --- Shards + planet size ------------------------------------------------------------

  function refreshWallet() {
    var shards = MI.economy.balance();
    el['wallet-count'].textContent = shards;
    el['shop-balance'].textContent = shards;
    if (el.shop.classList.contains('open')) renderShop();
  }

  function refreshPlanet() {
    var world = MI.store.get();
    var tiles = MI.world.currentTiles();
    if (!tiles) return;
    var p = MI.growth.progress(world, tiles, world.planet.frequency);
    var size = MI.growth.tierIndex(p.frequency) + 1;
    el['planet-size'].textContent = 'Size ' + size + ' of ' + MI.growth.LADDER.length;
    el['planet-tiles'].textContent = tiles.length + ' tiles';
    var pct = p.next === null ? 100 : Math.min(100, Math.round(100 * p.land / p.threshold));
    el['planet-bar'].firstElementChild.style.transform = 'scaleX(' + (pct / 100) + ')';
    el['planet-bar'].setAttribute('aria-valuenow', pct);
    el['planet-hint'].textContent = p.next === null
      ? 'full size — the biggest planet there is'
      : 'grows when half of it is land · ' + pct + '%';
  }

  function bump(node, className) {
    node.classList.remove(className);
    void node.offsetWidth; // restart the transition if it's mid-bump
    node.classList.add(className);
    setTimeout(function () { node.classList.remove(className); }, 450);
  }

  // A "+18 ✦" that drifts up off the wallet.
  function floatShards(amount) {
    if (!amount) return;
    var rect = el.wallet.getBoundingClientRect();
    var tag = document.createElement('div');
    tag.className = 'shard-float';
    tag.textContent = '+' + amount + ' ✦';
    tag.style.left = (rect.left + 10) + 'px';
    tag.style.top = (rect.bottom + 6) + 'px';
    document.body.appendChild(tag);
    setTimeout(function () { tag.remove(); }, 1300);
  }

  function toast(emoji, headline, sub, shards, holdMs) {
    el['toast-emoji'].textContent = emoji;
    el['toast-headline'].textContent = headline;
    el['toast-sub'].textContent = sub || '';
    el['toast-shards'].textContent = shards ? '+' + shards + ' ✦' : '';
    el.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.toast.classList.remove('show'); }, holdMs || 3200);
  }

  function showToast(memory, reward) {
    var flavor = CATEGORY_FLAVOR[memory.category] || CATEGORY_FLAVOR.other;
    toast(flavor.emoji, flavor.line, memory.title, reward && reward.total);
  }

  function handleAppEvent(event) {
    if (event.type === 'reward') {
      showToast(event.memory, event.reward);
      refreshStats(); // counts, wallet and planet bar, the moment the memory lands
      bump(el.wallet, 'bump');
      bump(el['book-btn'], 'nudge'); // the book just got another page
      floatShards(event.reward.total);
    } else if (event.type === 'grew') {
      syncViewButton(); // growing always returns to the planet view
      refreshStats();
      bump(el['planet-card'], 'grew');
      bump(el.wallet, 'bump');
      floatShards(event.reward.total);
      toast('🪐', 'Your planet grew!',
        'Size ' + event.size + ' of ' + event.sizes + ' · ' + event.tiles + ' tiles of room',
        event.reward.total, 4200);
    }
  }

  // --- Shop ------------------------------------------------------------------------------

  var shopKind = 'themes';
  var shopOpener = null;

  function openShop() {
    closeSettings();
    shopOpener = document.activeElement;
    renderShop();
    el.shop.classList.add('open');
    el['shop-close'].focus();
  }

  function closeShop() {
    el.shop.classList.remove('open');
    if (shopOpener && shopOpener.focus) shopOpener.focus();
  }

  function openSettings() {
    closeShop();
    el.settings.classList.add('open');
    el['settings-btn'].setAttribute('aria-expanded', 'true');
  }
  function closeSettings() {
    el.settings.classList.remove('open');
    el['settings-btn'].setAttribute('aria-expanded', 'false');
    disarmReset();
  }

  function themeThumb(id) {
    var theme = MI.world.themes.get(id);
    function hex(n) { return '#' + n.toString(16).padStart(6, '0'); }
    var thumb = document.createElement('div');
    thumb.className = 'thumb';
    thumb.style.background = hex(theme.sky);
    var planet = document.createElement('div');
    planet.className = 'mini-planet';
    planet.style.background = 'conic-gradient(from 200deg, ' + hex(theme.land) + ' 0 42%, ' +
      hex(theme.water) + ' 0 100%)';
    thumb.appendChild(planet);
    return thumb;
  }

  function renderShop() {
    var kind = shopKind;
    var balance = MI.economy.balance();
    el['shop-balance'].textContent = balance;
    Array.prototype.forEach.call(el.shop.querySelectorAll('.tabs button'), function (tab) {
      tab.setAttribute('aria-selected', String(tab.dataset.kind === kind));
    });

    var equippedId = MI.economy.equipped(kind);
    el['shop-items'].innerHTML = '';
    MI.economy.CATALOG[kind].forEach(function (item) {
      var owned = MI.economy.owns(kind, item.id);
      var inUse = equippedId === item.id;
      var card = document.createElement('div');
      card.className = 'item' + (inUse ? ' equipped' : '');

      var thumb;
      if (kind === 'themes') thumb = themeThumb(item.id);
      else {
        thumb = document.createElement('div');
        thumb.className = 'thumb';
        thumb.textContent = item.icon;
      }
      thumb.setAttribute('aria-hidden', 'true');
      card.appendChild(thumb);

      var info = document.createElement('div');
      info.className = 'info';
      var name = document.createElement('div');
      name.className = 'name';
      name.textContent = item.name;
      var blurb = document.createElement('div');
      blurb.className = 'blurb';
      blurb.textContent = item.blurb;
      info.appendChild(name);
      info.appendChild(blurb);

      var action = document.createElement('button');
      action.className = 'action';
      // Pets and satellites are the two kinds you're allowed to have none of, so only they
      // offer a way back out; a theme or skin is always wearing something.
      if (inUse && (kind === 'pets' || kind === 'satellites')) {
        action.className += ' use';
        action.textContent = 'Put away';
        action.addEventListener('click', function () { MI.app.equip(kind, null); renderShop(); });
      } else if (inUse) {
        action.className += ' in-use';
        action.textContent = 'In use ✓';
        action.disabled = true;
      } else if (owned) {
        action.className += ' use';
        action.textContent = 'Use';
        action.addEventListener('click', function () { MI.app.equip(kind, item.id); renderShop(); });
      } else if (balance >= item.price) {
        action.textContent = 'Unlock · ✦ ' + item.price;
        action.addEventListener('click', function () { buy(kind, item); });
      } else {
        action.className += ' short';
        action.textContent = '✦ ' + item.price + ' · ' + (item.price - balance) + ' to go';
        action.disabled = true;
      }
      info.appendChild(action);
      card.appendChild(info);
      el['shop-items'].appendChild(card);
    });
  }

  function buy(kind, item) {
    var result = MI.economy.buy(kind, item.id);
    if (!result.ok) return;
    MI.app.equip(kind, item.id); // a new unlock goes straight on
    refreshWallet();
    renderShop();
    toast(item.icon, item.name + ' unlocked!', 'Now on your planet.', 0, 2600);
  }

  function formatDate(iso) {
    try {
      return new Date(iso).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
    } catch (e) {
      return iso;
    }
  }

  // The tile whose entry is open, so hovering elsewhere and coming back restores its mark.
  var openSlot = null;

  function showDetail(memory) {
    var world = MI.store.get();
    openSlot = memory.placement ? memory.placement.slot : null;
    openMemory = memory;
    if (openSlot !== null) MI.world.highlightSlot(openSlot);
    markOpenRow(true);
    el['title-suggest'].hidden = claudeAvailable === false;
    el['detail-cat'].textContent = memory.category + ' · ' + (memory.mood && memory.mood.label || '');
    el['detail-title'].textContent = memory.title;
    el['detail-date'].textContent = formatDate(memory.occurredOn || memory.createdAt);
    el['detail-text'].textContent = memory.text;

    el['detail-pills'].innerHTML = '';
    (memory.people || []).forEach(function (personId) {
      var person = world.people.filter(function (p) { return p.id === personId; })[0];
      if (!person) return;
      var pill = document.createElement('span');
      pill.className = 'pill';
      pill.textContent = person.name;
      if (person.appearance && person.appearance.color !== undefined) {
        pill.style.background = '#' + person.appearance.color.toString(16).padStart(6, '0') + '33';
      }
      el['detail-pills'].appendChild(pill);
    });

    renderSwaps(memory);
    el.detail.classList.add('show');
  }

  // The classifier picks the building, but you're never stuck with its call.
  function renderSwaps(memory) {
    var options = MI.world.buildingsFor(memory.category);
    var current = memory.asset && memory.asset.key;
    el['detail-swaps'].innerHTML = '';

    options.forEach(function (file) {
      var button = document.createElement('button');
      button.className = 'swap' + (file === current ? ' current' : '');
      // "building-wizard-tower.glb" -> "wizard tower"
      button.textContent = file.replace(/^building-/, '').replace(/\.glb$/, '').replace(/-/g, ' ');
      if (file !== current) {
        button.addEventListener('click', function () {
          memory.asset = { pack: 'kenney-hexagon-kit', key: file };
          MI.store.save();
          MI.world.respawnMemory(memory);
          renderSwaps(memory);
        });
      }
      el['detail-swaps'].appendChild(button);
    });
  }

  // --- Renaming an entry -------------------------------------------------------------------
  // A title is a guess until someone says otherwise, so it is editable in place. Claude can
  // offer a nicer one when a key is configured; the button hides itself when it can't.

  var openMemory = null;
  var claudeAvailable = null; // unknown until the first attempt

  function saveTitle() {
    if (!openMemory) return;
    var next = el['detail-title'].textContent.trim().replace(/\s+/g, ' ');
    if (!next) { el['detail-title'].textContent = openMemory.title; return; }
    if (next === openMemory.title) return;
    openMemory.title = next;
    MI.store.save();
    renderBook();
    markOpenRow(false);
  }

  function suggestTitle() {
    if (!openMemory) return;
    var memory = openMemory;
    el['title-suggest'].disabled = true;
    el['title-suggest'].textContent = 'thinking…';
    MI.ai.classify(memory.text).then(function (result) {
      el['title-suggest'].disabled = false;
      el['title-suggest'].textContent = '✨ suggest a title';
      // classify() falls back to the local guess when Claude is unreachable, and that would
      // just hand back the title we already have.
      if (result.source !== 'claude') {
        claudeAvailable = false;
        el['title-suggest'].hidden = true;
        toast('🔌', 'No title suggestions', 'Claude is not configured for this planet.', 0, 3000);
        return;
      }
      claudeAvailable = true;
      if (memory !== openMemory) return; // they moved on while it was thinking
      memory.title = result.title;
      el['detail-title'].textContent = result.title;
      MI.store.save();
      renderBook();
      markOpenRow(false);
    });
  }

  function hideDetail() {
    saveTitle(); // a rename in progress counts, even if they click away
    el.detail.classList.remove('show');
    openSlot = null;
    openMemory = null;
    MI.world.clearHighlight();
    markOpenRow(false);
  }

  function setBusy(busy) {
    el['submit-btn'].disabled = busy;
    el['submit-btn'].textContent = busy ? 'planting…' : 'Plant it on my planet ✨';
    if (el['mic-btn']) el['mic-btn'].disabled = busy;
  }

  // --- Speak a memory -------------------------------------------------------------------
  // Web Speech API (Chrome/Safari). Interim results fill the page as you talk; when a
  // browser only returns a finished phrase, the same text is revealed a few letters at a
  // time so it still looks like handwriting appearing on the ruled paper.

  var SpeechEngine = window.SpeechRecognition || window.webkitSpeechRecognition;
  var recognition = null;
  var listening = false;
  var speechPrefix = '';
  var revealTarget = '';
  var revealTimer = null;
  var doneAnimTimer = null;
  var startMicTimer = null;
  var micLockUntil = 0;
  var micCanStopAt = 0;

  function joinSpoken(prefix, spoken) {
    var bit = String(spoken || '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
    if (!bit) return prefix || '';
    if (!prefix) return bit;
    if (/[\s]$/.test(prefix) || /^[\n,.!?;:)'"]/.test(bit)) return prefix + bit;
    return prefix + ' ' + bit;
  }

  // Longest phrases first so "question mark" does not leave a stray "mark".
  var DICTATION_MARKS = [
    { re: /\bexclamation\s+(?:mark|point)s?\b/gi, to: '!' },
    { re: /\bquestion\s+marks?\b/gi, to: '?' },
    { re: /\bfull\s+stops?\b/gi, to: '.' },
    { re: /\bdot\s+dot\s+dot\b/gi, to: '...' },
    { re: /\b(?:new|next)\s+paragraphs?\b/gi, to: '\n\n' },
    { re: /\b(?:new|next)\s+lines?\b/gi, to: '\n' },
    { re: /\b(?:open|left)\s+(?:quote|quotation\s+mark)s?\b/gi, to: '"' },
    { re: /\b(?:close|right|end)\s+(?:quote|quotation\s+mark)s?\b/gi, to: '"' },
    { re: /\b(?:open|left)\s+parenthes(?:is|es)\b/gi, to: '(' },
    { re: /\b(?:close|right)\s+parenthes(?:is|es)\b/gi, to: ')' },
    { re: /\bsemi[-\s]?colons?\b/gi, to: ';' },
    { re: /\bellipsis\b/gi, to: '...' },
    { re: /\bapostrophes?\b/gi, to: "'" },
    { re: /\bpercent\s+signs?\b/gi, to: '%' },
    { re: /\bat\s+signs?\b/gi, to: '@' },
    { re: /\bhashtags?\b/gi, to: '#' },
    { re: /\basterisks?\b/gi, to: '*' },
    { re: /\bunderscores?\b/gi, to: '_' },
    { re: /\bsmiley(?:\s+face)?s?\b/gi, to: ' :)' },
    { re: /\bcolons?\b/gi, to: ':' },
    { re: /\bcommas?\b/gi, to: ',' },
    { re: /\bhyphens?\b/gi, to: '-' },
    { re: /\bdashes?\b/gi, to: '—' },
    { re: /\bperiods?\b(?!\s+(?:of|piece|drama|in|when|where|from|to|between|during)\b)/gi, to: '.' }
  ];

  function applyDictationMarks(text) {
    var out = String(text || '');
    DICTATION_MARKS.forEach(function (rule) {
      out = out.replace(rule.re, rule.to);
    });
    return out;
  }

  function looksLikeQuestion(phrase) {
    var t = phrase.replace(/['"]/g, '').trim();
    if (/^(?:what a|how a|how the)\b/i.test(t)) return false;
    return /^(?:who|what|when|where|why|how|is|are|am|do|does|did|can|could|would|will|should|shall|wasn't|isn't|aren't|won't|didn't|couldn't|wouldn't)\b/i.test(t);
  }

  function looksExcited(phrase) {
    return /^(?:wow|yay|no way|oh my god|oh my gosh)(?:\b|[!.,]|$)/i.test(phrase.trim());
  }

  function capitalizePhrase(phrase) {
    return phrase.replace(/^(\s*["'(]*)([a-z])/, function (_, lead, letter) {
      return lead + letter.toUpperCase();
    });
  }

  function autoPunctuatePhrase(phrase) {
    var t = String(phrase || '').replace(/[ \t]+/g, ' ').trim();
    if (!t) return t;
    t = capitalizePhrase(t);
    if (/[.!?…]$/.test(t) || /\.\.\.$/.test(t)) return t;
    if (looksLikeQuestion(t)) return t + '?';
    if (looksExcited(t)) return t + '!';
    if (t.split(/\s+/).length < 2) return t;
    return t + '.';
  }

  function tidyPunctuation(text) {
    return String(text || '')
      .replace(/\.{3}/g, '\u2026')
      .replace(/[ \t]+([,.!?;:])/g, '$1')
      .replace(/([!?])\1+/g, '$1')
      .replace(/([.!?…])([^\s"'.)\]])/g, '$1 $2')
      .replace(/([.!?…])\s+([a-z])/g, function (_, mark, letter) {
        return mark + ' ' + letter.toUpperCase();
      })
      .replace(/(^|\n)(\s*)([a-z])/g, function (_, br, space, letter) {
        return br + space + letter.toUpperCase();
      })
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n[ \t]+/g, '\n')
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/\u2026/g, '...');
  }

  function paintMic(mode) {
    var btn = el['mic-btn'];
    if (!btn) return;
    btn.classList.remove('listening', 'done');
    if (mode) {
      void btn.offsetWidth; // restart the press / done animation
      btn.classList.add(mode);
    }
    var on = mode === 'listening';
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    btn.setAttribute('aria-label', on ? 'Stop listening' : (mode === 'done' ? 'Heard' : 'Speak a memory'));
    btn.title = on ? 'Done' : 'Speak a memory';
  }

  function scrollEntry() {
    el['entry-input'].scrollTop = el['entry-input'].scrollHeight;
  }

  function tickReveal() {
    var current = el['entry-input'].value;
    if (current === revealTarget) {
      clearInterval(revealTimer);
      revealTimer = null;
      return;
    }
    if (revealTarget.indexOf(current) !== 0) {
      el['entry-input'].value = revealTarget;
      clearInterval(revealTimer);
      revealTimer = null;
    } else {
      var step = current.length + Math.max(1, Math.min(3, revealTarget.length - current.length));
      el['entry-input'].value = revealTarget.slice(0, step);
    }
    scrollEntry();
    clearTimeout(guessTimer);
    guessTimer = setTimeout(guessTags, 220);
  }

  function revealToward(text) {
    revealTarget = text;
    if (el['entry-input'].value === revealTarget) return;
    if (!revealTimer) revealTimer = setInterval(tickReveal, 28);
  }

  function snapReveal() {
    clearInterval(revealTimer);
    revealTimer = null;
    if (revealTarget) {
      el['entry-input'].value = revealTarget;
      scrollEntry();
    }
  }

  function applyTranscript(event) {
    var spoken = '';
    for (var i = 0; i < event.results.length; i++) {
      var marked = applyDictationMarks(event.results[i][0].transcript);
      if (event.results[i].isFinal) {
        if (spoken && !/[\s]$/.test(spoken) && !/^[\n,.!?;:]/.test(marked)) spoken += ' ';
        spoken += autoPunctuatePhrase(marked);
      } else {
        if (spoken && !/[\s]$/.test(spoken) && marked) spoken += ' ';
        spoken += marked;
      }
    }
    revealToward(joinSpoken(speechPrefix, tidyPunctuation(spoken)));
  }

  function stopListening(options) {
    var opts = options || {};
    clearTimeout(startMicTimer);
    startMicTimer = null;
    if (!listening && !recognition) {
      snapReveal();
      return;
    }
    listening = false;
    if (recognition) {
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
      try { recognition.stop(); } catch (e) { /* already stopped */ }
      recognition = null;
    }
    if (revealTarget) revealTarget = tidyPunctuation(applyDictationMarks(revealTarget));
    snapReveal();
    if (opts.silent) {
      paintMic(null);
      return;
    }
    paintMic('done');
    clearTimeout(doneAnimTimer);
    doneAnimTimer = setTimeout(function () { paintMic(null); }, 900);
  }

  function bindRecognition(engine) {
    engine.onresult = applyTranscript;
    engine.onerror = function (event) {
      // aborted/no-speech fire when Chrome tears down a phrase; keep the session.
      if (event.error === 'no-speech' || event.error === 'aborted') return;
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        listening = false;
        recognition = null;
        paintMic(null);
        toast('🎤', 'Microphone is blocked', 'Allow the mic for this page, then try Speak again.', 0, 3600);
        return;
      }
      // network and other blips: stay on the listening look and try again
    };
    engine.onend = function () {
      if (!listening) return;
      speechPrefix = revealTarget || el['entry-input'].value;
      try { engine.start(); } catch (e) { /* start() while starting */ }
    };
  }

  function startListening() {
    if (!SpeechEngine) {
      toast('🎤', 'This browser cannot listen', 'Try Chrome or Safari — they can write as you speak.', 0, 3600);
      return;
    }
    clearTimeout(startMicTimer);
    speechPrefix = el['entry-input'].value;
    revealTarget = speechPrefix;
    listening = true;
    paintMic('listening');
    // Start after the click finishes. Starting SpeechRecognition inside the click
    // often aborts it, which used to look like the button immediately pressing Done.
    startMicTimer = setTimeout(function () {
      startMicTimer = null;
      if (!listening) return;
      if (recognition) {
        try { recognition.stop(); } catch (e) { /* none */ }
      }
      recognition = new SpeechEngine();
      recognition.lang = (navigator.language || 'en-US');
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.maxAlternatives = 1;
      bindRecognition(recognition);
      try {
        recognition.start();
      } catch (e) {
        listening = false;
        recognition = null;
        paintMic(null);
        toast('🎤', 'Could not start listening', 'Check the microphone and try again.', 0, 3200);
      }
    }, 80);
  }

  function toggleListening(event) {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    if (el['mic-btn'].disabled) return;
    var now = Date.now();
    if (now < micLockUntil) return;
    if (listening) {
      if (now < micCanStopAt) return;
      micLockUntil = now + 300;
      stopListening();
      return;
    }
    micLockUntil = now + 400;
    micCanStopAt = now + 600;
    startListening();
  }

  function submitEntry() {
    if (el['submit-btn'].disabled) return;
    stopListening({ silent: true });
    var text = el['entry-input'].value.trim();
    if (!text) return;
    commitPerson(); // a name still sitting in the box counts
    var entryTags = currentTags();
    setBusy(true);
    hideDetail();
    closeBook(); // out of the way, so the building is the thing you see appear

    // The memory's toast comes from the app's 'reward' event as it lands, and a growth toast
    // from 'grew' — this only has to handle the end of the whole thing.
    MI.app.addEntry(text, { tags: entryTags }).then(function (memory) {
      setBusy(false);
      if (!memory) {
        openBook();
        toast('🌊', 'Your planet is full!', 'Every buildable tile has a memory on it.', 0, 4200);
        return;
      }
      if (el['entry-input'].value.trim() === text) {
        el['entry-input'].value = '';
        resetTags();
      }
      refreshStats();
    }, function (err) {
      setBusy(false);
      console.error('[MI.ui] addEntry failed', err);
      openBook(); // keep the writing available to retry
    });
  }

  // Seeds through MI.app.addEntry itself, so the button exercises the real path rather
  // than a parallel one that could silently drift.
  function loadDemoPlanet() {
    el['demo-btn'].disabled = true;
    setBusy(true);
    var index = 0;
    (function next() {
      if (index >= DEMO_ENTRIES.length) {
        setBusy(false);
        el['demo-btn'].disabled = false;
        refreshStats();
        return;
      }
      var text = DEMO_ENTRIES[index++];
      MI.app.addEntry(text, { focus: index === DEMO_ENTRIES.length }).then(function () {
        refreshStats();
        setTimeout(next, 260);
      });
    })();
  }

  // Two-step confirm rather than a browser dialog: wiping the planet is destructive, but a
  // native confirm() box would land like a brick in the middle of this.
  var resetArmed = null;
  function handleReset() {
    if (MI.world.isTransitioning()) return;
    if (!resetArmed) {
      el['reset-btn'].textContent = 'sure? sinks everything';
      el['reset-btn'].classList.add('confirming');
      resetArmed = setTimeout(disarmReset, 4000);
      return;
    }
    disarmReset();
    hideDetail();
    closeShop();
    closeSettings();
    el.toast.classList.remove('show');
    // Back to the smallest planet, with shards and unlocks wiped too.
    MI.app.startOver().then(function () {
      syncViewButton();
      refreshStats();
    });
  }

  function syncViewButton() {
    el['view-btn'].classList.toggle('is-island', MI.world.isFlatView());
  }
  function disarmReset() {
    clearTimeout(resetArmed);
    resetArmed = null;
    el['reset-btn'].textContent = 'start over';
    el['reset-btn'].classList.remove('confirming');
  }

  function toggleView() {
    if (MI.store.get().memories.length === 0) return; // nothing to lay out yet
    if (MI.world.isTransitioning()) return; // let the fold finish before reversing it
    var goingFlat = !MI.world.isFlatView();
    el['view-btn'].classList.toggle('is-island', goingFlat);
    hideDetail();
    MI.world.setFlatView(goingFlat);
  }

  function init() {
    cacheElements();
    el['settings-btn'].addEventListener('click', function () {
      if (el.settings.classList.contains('open')) closeSettings();
      else openSettings();
    });
    el.settings.addEventListener('click', function (e) {
      if (e.target === el.settings) closeSettings();
    });
    el['reset-btn'].addEventListener('click', handleReset);
    el['view-btn'].addEventListener('click', toggleView);

    el['submit-btn'].addEventListener('click', submitEntry);
    el['mic-btn'].addEventListener('click', toggleListening);
    el['entry-input'].addEventListener('keydown', function (e) {
      // It is a page in a book, so Enter is a new line; Ctrl/Cmd+Enter puts it on the planet.
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submitEntry(); }
    });

    el['book-btn'].addEventListener('click', openBook);
    el['book-close'].addEventListener('click', closeBook);
    el['book-write-tab'].addEventListener('click', function () { selectBookPage('write'); });
    el['book-memories-tab'].addEventListener('click', function () { selectBookPage('memories'); });
    el.book.addEventListener('click', function (e) {
      if (e.target === el.book) closeBook(); // the cover around the pages, not the pages
    });

    buildTagRow();
    paintTagRow();
    el['entry-input'].addEventListener('input', function () {
      clearTimeout(guessTimer);
      guessTimer = setTimeout(guessTags, 220); // after the typing pauses, not on every key
    });
    el['entry-input'].addEventListener('focus', refreshPersonList);
    el['demo-btn'].addEventListener('click', loadDemoPlanet);
    el['detail-close'].addEventListener('click', hideDetail);

    el['detail-title'].addEventListener('blur', saveTitle);
    el['detail-title'].addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); el['detail-title'].blur(); }
      if (e.key === 'Escape' && openMemory) {
        el['detail-title'].textContent = openMemory.title;
        el['detail-title'].blur();
      }
    });
    el['title-suggest'].addEventListener('click', suggestTitle);

    MI.app.onEvent(handleAppEvent);
    el['shop-btn'].addEventListener('click', openShop);
    el['shop-close'].addEventListener('click', closeShop);
    el.shop.addEventListener('click', function (e) {
      if (e.target === el.shop) closeShop(); // a click on the backdrop, not the sheet
    });
    Array.prototype.forEach.call(el.shop.querySelectorAll('.tabs button'), function (tab) {
      tab.addEventListener('click', function () {
        shopKind = tab.dataset.kind;
        renderShop();
      });
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Tab' && isBookOpen()) {
        var focusable = Array.prototype.filter.call(
          el.book.querySelectorAll('button:not([disabled]), textarea:not([disabled]), input:not([disabled])'),
          function (node) { return node.getClientRects().length > 0; }
        );
        if (focusable.length) {
          var first = focusable[0], last = focusable[focusable.length - 1];
          if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
          else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        }
      }
      if (e.key !== 'Escape') return;
      if (el.shop.classList.contains('open')) closeShop();
      else if (el.settings.classList.contains('open')) closeSettings();
      else if (isBookOpen()) closeBook();
    });

    MI.world.onPick(function (slot) {
      if (slot === null || slot === undefined) { hideDetail(); return; }
      var memory = MI.store.findMemoryBySlot(slot);
      if (memory) {
        showDetail(memory);
        MI.world.focus(slot);
      } else {
        hideDetail();
      }
    });

    // Pointer cursor only over tiles that open something, and a light mark under it. When
    // the pointer leaves, the open entry's own mark comes back.
    MI.world.onHover(function (slot) {
      var memory = slot === null || slot === undefined ? null : MI.store.findMemoryBySlot(slot);
      if (memory) MI.world.highlightSlot(slot, { soft: true });
      else if (openSlot === null) MI.world.clearHighlight();
      else MI.world.highlightSlot(openSlot);
      return !!memory;
    });

    refreshStats();
  }

  function hideLoading() {
    el.loading.classList.add('hide');
  }

  MI.ui = { init: init, refreshStats: refreshStats, hideLoading: hideLoading };
})();
