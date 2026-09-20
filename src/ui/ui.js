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
      'reset-btn', 'view-btn', 'view-planet-label', 'view-island-label',
      'detail-swaps', 'toast-coins',
      'planet-card', 'planet-size', 'planet-tiles', 'planet-bar', 'planet-hint',
      'wallet', 'wallet-count', 'shop-btn', 'shop', 'shop-close', 'shop-balance', 'shop-items', 'shop-title',
      'shop-blurb',
      'ground-btn', 'picker', 'picker-grid', 'picker-play',
      'character-btn', 'theme-rack',
      'journal', 'book', 'book-btn', 'book-close', 'book-count', 'book-note',
      'book-list', 'book-write-tab', 'book-memories-tab', 'write-date',
      'tag-row', 'tag-people', 'tag-person-input', 'tag-person-list',
      'tag-mood', 'tag-cat', 'tag-big', 'mic-btn', 'settings-btn', 'settings',
      'book-tabs-left', 'book-tabs-right', 'book-write-panel', 'book-right-body',
      'book-heading', 'book-mobile-tabs', 'write-title', 'edit-cancel', 'detail-edit',
      'world-title', 'world-title-text', 'journals-btn',
      'gate', 'gate-shelf', 'gate-create', 'gate-journals', 'gate-empty', 'gate-blurb',
      'gate-new', 'gate-back', 'gate-name', 'gate-avatars', 'gate-create-btn',
      'gate-create-kicker', 'gate-create-title', 'gate-create-blurb',
      'galaxy-ui', 'galaxy-count', 'galaxy-count-text', 'galaxy-hint', 'galaxy-labels',
      'galaxy-card', 'galaxy-card-meta', 'galaxy-delete', 'galaxy-tools',
      'galaxy-edit', 'galaxy-left', 'galaxy-right',
      'galaxy-new',
      'ship-card', 'ship-close', 'ship-flag', 'ship-name', 'ship-ask', 'ship-bar', 'ship-fill',
      'ship-count', 'ship-claim',
      'hub-ui', 'hub-leave', 'hub-card', 'hub-card-name', 'hub-card-sub',
      'hub-card-friend', 'hub-card-friend-meta', 'hub-card-titles',
      'hub-card-swap', 'hub-card-close']
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
    // The view toggle means nothing on an empty planet. (The follow button belongs to the
    // island view alone, and syncGroundButton decides it.)
    el['view-btn'].classList.toggle('show', memories > 0);
    if (el['reset-btn']) el['reset-btn'].disabled = memories === 0;

    el['stats-chip'].classList.add('bump');
    setTimeout(function () { el['stats-chip'].classList.remove('bump'); }, 400);
    refreshWallet();
    refreshPlanet();
    renderBook();
    refreshPersonList();
    refreshWorldTitle();
  }

  function refreshWorldTitle() {
    var name = MI.store.get().name;
    if (!name) {
      el['world-title'].hidden = true;
      document.title = 'Memory Planet';
      return;
    }
    el['world-title'].hidden = false;
    el['world-title-text'].textContent = name;
    document.title = name + ' · Memory Planet';
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

  var bookOpenTimer = null;
  var bookAnimTimers = [];

  function clearBookAnim() {
    clearTimeout(bookFocusTimer);
    clearTimeout(bookOpenTimer);
    bookOpenTimer = null;
    for (var i = 0; i < bookAnimTimers.length; i++) clearTimeout(bookAnimTimers[i]);
    bookAnimTimers = [];
  }

  function bookLater(ms, fn) {
    var t = setTimeout(fn, ms);
    bookAnimTimers.push(t);
    return t;
  }

  function isBookBusy() {
    return el.book.classList.contains('prep') || el.book.classList.contains('open');
  }

  function openBook(event) {
    if (isBookBusy()) return;
    clearTimeout(toastTimer);
    clearBookAnim();
    el.toast.classList.remove('show');
    bookOpener = event && event.currentTarget || document.activeElement;

    refreshPersonList();
    renderBook();
    if (!isEditing()) el['write-date'].textContent = todayLabel();
    syncWriteMode();
    selectBookPage('write');

    var mini = el['book-btn'].querySelector('.mini-book');
    var stage = el.book.querySelector('.stage-3d');
    el.book.classList.remove('from-pose', 'arriving', 'uncover', 'flipping', 'open');
    el.book.classList.add('prep');
    var dest = stage.getBoundingClientRect();
    var mr = mini.getBoundingClientRect();
    el.book.style.setProperty('--from-x', (mr.left + mr.width / 2 - (dest.left + dest.width / 2)) + 'px');
    el.book.style.setProperty('--from-y', (mr.top + mr.height / 2 - (dest.top + dest.height / 2)) + 'px');
    el.book.style.setProperty('--from-s', String(Math.max(0.08, mr.height / Math.max(dest.height, 1))));
    el.book.classList.add('from-pose');
    el['book-btn'].classList.add('hand-off');
    el['book-btn'].setAttribute('aria-expanded', 'true');
    unpeekMiniBook();
    void stage.offsetWidth;

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      el.book.classList.add('arriving', 'uncover', 'flipping', 'open');
      bookFocusTimer = setTimeout(function () {
        if (isBookOpen() && el.book.dataset.page === 'write') el['entry-input'].focus();
      }, 40);
      return;
    }

    requestAnimationFrame(function () {
      el.book.classList.add('arriving');
    });
    // Closed book arrives, cover opens fully, then pages turn, then the journal.
    bookLater(640, function () { el.book.classList.add('uncover'); });
    bookLater(1380, function () { el.book.classList.add('flipping'); });
    bookLater(2680, function () { el.book.classList.add('open'); });

    bookFocusTimer = setTimeout(function () {
      if (isBookOpen() && el.book.dataset.page === 'write') el['entry-input'].focus();
    }, 2900);
  }

  // Shutting the book yourself abandons whatever rewrite was in it. submitEdit closes the
  // book too, but only to get out of the way of the result, so it calls closeBook directly.
  function dismissBook() {
    stopEditing();
    closeBook();
  }

  function closeBook() {
    stopListening({ silent: true });
    clearBookAnim();
    el.book.classList.remove('open', 'from-pose', 'arriving', 'uncover', 'flipping', 'prep');
    el.book.style.removeProperty('--from-x');
    el.book.style.removeProperty('--from-y');
    el.book.style.removeProperty('--from-s');
    el['book-btn'].setAttribute('aria-expanded', 'false');
    el['book-btn'].classList.remove('hand-off');
    // Closing used to focus the mini book, which peeked and paused the spin until
    // you clicked away. Resume the idle turn as soon as the journal is gone.
    skipMiniPeek = true;
    unpeekMiniBook();
    var spin = el['book-btn'].querySelector('.mini-spin');
    if (spin) {
      clearTimeout(miniResumeTimer);
      playMiniSpin(spin);
    }
    if (bookOpener && bookOpener !== el['book-btn'] && bookOpener.isConnected) {
      bookOpener.focus();
    } else if (document.activeElement && document.activeElement.blur) {
      document.activeElement.blur();
    }
    skipMiniPeek = false;
  }

  function isBookOpen() {
    return el.book.classList.contains('open');
  }

  // Hover faces the reader without throwing away the idle spin. The spin is paused
  // at its current heading, a child turn eases the cover toward the camera, and
  // unhovering unwinds that turn then continues the 14s spin from the same spot.
  var miniResumeTimer = null;
  var miniPeeking = false;
  var skipMiniPeek = false;
  var MINI_FACE = -16;
  var MINI_TURN_MS = 400;

  function spinY(node) {
    var t = getComputedStyle(node).transform;
    if (!t || t === 'none') return 0;
    var n = t.replace(/^matrix3d\(|^matrix\(|\)$/g, '').split(',');
    if (n.length === 16) {
      return Math.atan2(parseFloat(n[8]), parseFloat(n[0])) * 180 / Math.PI;
    }
    if (n.length === 6) {
      return Math.atan2(parseFloat(n[1]), parseFloat(n[0])) * 180 / Math.PI;
    }
    return 0;
  }

  function shortestDeg(deg) {
    deg = ((deg + 180) % 360 + 360) % 360 - 180;
    return deg;
  }

  function pauseMiniSpin(spin) {
    var anims = spin.getAnimations ? spin.getAnimations() : [];
    if (anims[0]) anims[0].pause();
    else spin.style.animationPlayState = 'paused';
  }

  function playMiniSpin(spin) {
    var anims = spin.getAnimations ? spin.getAnimations() : [];
    if (anims[0]) anims[0].play();
    spin.style.animationPlayState = '';
  }

  function peekMiniBook() {
    if (skipMiniPeek) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    if (el['book-btn'].classList.contains('hand-off')) return;
    clearTimeout(miniResumeTimer);
    var spin = el['book-btn'].querySelector('.mini-spin');
    var turn = el['book-btn'].querySelector('.mini-turn');
    pauseMiniSpin(spin);
    turn.style.transform = 'rotateY(' + shortestDeg(MINI_FACE - spinY(spin)) + 'deg)';
    el['book-btn'].classList.add('peeking');
    miniPeeking = true;
  }

  function unpeekMiniBook() {
    if (!miniPeeking) return;
    miniPeeking = false;
    el['book-btn'].classList.remove('peeking');
    var spin = el['book-btn'].querySelector('.mini-spin');
    var turn = el['book-btn'].querySelector('.mini-turn');
    turn.style.transform = 'rotateY(0deg)';
    miniResumeTimer = setTimeout(function () { playMiniSpin(spin); }, MINI_TURN_MS);
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
        dismissBook();
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

  // --- Coins + planet size ------------------------------------------------------------

  function refreshWallet() {
    var coins = MI.economy.balance();
    el['wallet-count'].textContent = coins;
    el['shop-balance'].textContent = coins;
    if (el.shop.classList.contains('open')) renderShop();
    renderThemeTray();
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

  // A "+18" that drifts up off the wallet.
  function floatCoins(amount) {
    if (!amount) return;
    var rect = el.wallet.getBoundingClientRect();
    var tag = document.createElement('div');
    tag.className = 'coin-float';
    tag.textContent = '+' + amount;
    tag.style.left = (rect.left + 10) + 'px';
    tag.style.top = (rect.bottom + 6) + 'px';
    document.body.appendChild(tag);
    setTimeout(function () { tag.remove(); }, 1300);
  }

  function toast(emoji, headline, sub, coins, holdMs) {
    el['toast-emoji'].textContent = emoji;
    el['toast-headline'].textContent = headline;
    el['toast-sub'].textContent = sub || '';
    el['toast-coins'].textContent = coins ? '+' + coins : '';
    el.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.toast.classList.remove('show'); }, holdMs || 3200);
  }

  function showToast(memory, reward) {
    var flavor = CATEGORY_FLAVOR[memory.category] || CATEGORY_FLAVOR.other;
    var daily = reward && reward.lines.filter(function (line) {
      return line.label === 'first today' || line.label.indexOf('-day streak') !== -1;
    })[0];
    var milestone = reward && reward.lines.filter(function (line) {
      return line.label.indexOf('-day milestone') !== -1;
    })[0];
    toast(flavor.emoji, milestone ? milestone.label + '!' : flavor.line,
      daily ? memory.title + ' · ' + daily.label + ' +' + daily.amount : memory.title,
      reward && reward.total, milestone ? 4800 : 3200);
  }

  function handleAppEvent(event) {
    if (event.type === 'reward') {
      showToast(event.memory, event.reward);
      refreshStats(); // counts, wallet and planet bar, the moment the memory lands
      bump(el.wallet, 'bump');
      bump(el['book-btn'], 'nudge'); // the book just got another page
      floatCoins(event.reward.total);
    } else if (event.type === 'grew') {
      syncViewButton(); // growing always returns to the planet view
      refreshStats();
      bump(el['planet-card'], 'grew');
      bump(el.wallet, 'bump');
      floatCoins(event.reward.total);
      toast('🪐', 'Your planet grew!',
        'Size ' + event.size + ' of ' + event.sizes + ' · ' + event.tiles + ' tiles of room',
        event.reward.total, 4200);
    } else if (event.type === 'ship-ready') {
      // Claiming is the player's to do, so this points at the ship rather than taking it.
      toast('🏴', event.ship.name + ' will hear you out',
        'You gave them what they asked. Click the ship to take her.', 0, 5200);
      MI.world.focusShip(event.ship.id);
    } else if (event.type === 'ship-claimed') {
      toast('⛵', event.ship.name + ' sails with you',
        'Their black flag is down, and they keep to your coast now.', 0, 4200);
    }
  }

  // --- Shop ------------------------------------------------------------------------------

  var shopKind = 'themes';
  var shopOpener = null;

  function openShop() {
    closeSettings();
    closeThemeTray();
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
    closeThemeTray();
    el.settings.classList.add('open');
    el['settings-btn'].setAttribute('aria-expanded', 'true');
  }
  function closeSettings() {
    el.settings.classList.remove('open');
    el['settings-btn'].setAttribute('aria-expanded', 'false');
    disarmReset();
  }

  function themeFill(id) {
    var theme = MI.world.themes.get(id);
    function hex(n) { return '#' + n.toString(16).padStart(6, '0'); }
    return 'conic-gradient(from 200deg, ' + hex(theme.land) + ' 0 42%, ' +
      hex(theme.water) + ' 0 100%)';
  }

  // One shelf per kind of thing you can own. Drawn rather than set in emoji, so they match
  // the gear above them and each other. Same 1.9 stroke, same round joins.
  var TRAY_SECTIONS = [
    {
      kind: 'themes', label: 'Themes', help: 'Change the planet\u2019s look.', empty: 'No themes yet.',
      icon: '<circle cx="12" cy="12" r="8.5"/>' +
            '<path d="M12 3.5a8.5 8.5 0 0 1 0 17Z" fill="currentColor" stroke="none"/>'
    },
    {
      kind: 'pets', label: 'Pets', help: 'Choose a pet to walk the land.', empty: 'No pets yet.',
      icon: '<ellipse cx="8" cy="7.6" rx="1.9" ry="2.5"/><ellipse cx="14.6" cy="6.8" rx="1.9" ry="2.5"/>' +
            '<ellipse cx="19" cy="11.6" rx="1.8" ry="2.2"/>' +
            '<path d="M12.3 12.2c2.6 0 4.6 2 5 4.1.4 1.9-1 3.2-2.8 3.2-1.2 0-1.6-.5-2.5-.5s-1.3.5-2.5.5c-1.8 0-3.2-1.3-2.8-3.2.4-2.1 2.4-4.1 5.6-4.1Z"/>'
    },
    {
      kind: 'satellites', label: 'Satellites', help: 'Choose a companion to orbit above.', empty: 'No satellites yet.',
      icon: '<circle cx="12" cy="11.4" r="4.6"/>' +
            '<ellipse cx="12" cy="12" rx="9.4" ry="3.3" transform="rotate(-22 12 12)"/>'
    }
  ];
  // Only one drawer at a time: three open at once buries the planet you are dressing.
  var trayOpenKind = null;

  function closeThemeTray() {
    var returnKind = trayOpenKind && el['theme-rack'].contains(document.activeElement)
      ? trayOpenKind : null;
    trayOpenKind = null;
    syncTrayOpen();
    if (returnKind) {
      var wrap = Array.prototype.filter.call(el['theme-rack'].children, function (child) {
        return child.dataset.kind === returnKind;
      })[0];
      if (wrap) wrap.querySelector('.tray-tab').focus();
    }
  }

  function syncTrayOpen() {
    Array.prototype.forEach.call(el['theme-rack'].children, function (wrap) {
      var open = wrap.dataset.kind === trayOpenKind;
      wrap.classList.toggle('open', open);
      var tab = wrap.querySelector('.tray-tab');
      var items = wrap.querySelector('.tray-items');
      if (tab) tab.setAttribute('aria-expanded', String(open));
      if (items) {
        items.setAttribute('aria-hidden', String(!open));
        items.inert = !open;
      }
    });
    el['theme-rack'].classList.toggle('open', trayOpenKind !== null);
  }

  function toggleTrayKind(kind) {
    trayOpenKind = trayOpenKind === kind ? null : kind;
    if (trayOpenKind) closeSettings();
    syncTrayOpen();
  }

  function ownedCatalog(kind) {
    return MI.economy.CATALOG[kind].filter(function (item) {
      return MI.economy.owns(kind, item.id);
    });
  }

  function fillTrayItems(container, kind) {
    container.innerHTML = '';
    var equippedId = MI.economy.equipped(kind);
    ownedCatalog(kind).forEach(function (item) {
      var btn = document.createElement('button');
      btn.type = 'button';
      var selected = item.id === equippedId;
      var action = selected && kind !== 'themes' ? 'Put away ' : 'Use ';
      btn.title = action + item.name;
      btn.setAttribute('aria-label', action + item.name);
      btn.setAttribute('aria-pressed', String(selected));
      btn.dataset.trayKind = kind;
      btn.dataset.itemId = item.id;
      if (kind === 'themes') btn.style.background = themeFill(item.id);
      else btn.textContent = item.icon;
      btn.addEventListener('click', function () {
        MI.app.equip(kind, selected && kind !== 'themes' ? null : item.id);
        renderThemeTray();
      });
      container.appendChild(btn);
    });
  }

  function trayIcon(section) {
    return '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" ' +
      'stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">' + section.icon + '</svg>';
  }

  function renderThemeTray() {
    var rack = el['theme-rack'];
    var active = document.activeElement;
    var focusedKind = rack.contains(active) && active.dataset.trayKind;
    var focusedItem = focusedKind && active.dataset.itemId;
    rack.innerHTML = '';
    TRAY_SECTIONS.forEach(function (section) {
      var owned = ownedCatalog(section.kind);
      var wrap = document.createElement('div');
      wrap.className = 'tray-kind';
      wrap.dataset.kind = section.kind;

      var tab = document.createElement('button');
      tab.type = 'button';
      tab.className = 'tray-tab';
      tab.dataset.trayKind = section.kind;
      tab.setAttribute('aria-expanded', 'false');
      tab.setAttribute('aria-controls', 'tray-items-' + section.kind);
      tab.innerHTML = trayIcon(section) +
        '<span class="tray-name"></span><span class="tray-count"></span>';
      tab.querySelector('.tray-name').textContent = section.label;
      tab.querySelector('.tray-count').textContent = String(owned.length);
      tab.setAttribute('aria-label', section.label + ', ' + owned.length + ' owned. ' + section.help);
      tab.addEventListener('click', function () { toggleTrayKind(section.kind); });

      var items = document.createElement('div');
      items.className = 'tray-items';
      items.id = 'tray-items-' + section.kind;
      items.setAttribute('role', 'group');
      items.setAttribute('aria-label', section.label + ' you own');
      items.setAttribute('aria-hidden', 'true');
      var help = document.createElement('p');
      help.className = 'tray-help';
      help.textContent = section.help;
      if (owned.length) {
        fillTrayItems(items, section.kind);
        items.insertBefore(help, items.firstChild);
      } else {
        items.appendChild(help);
        var note = document.createElement('p');
        note.className = 'tray-empty';
        note.textContent = section.empty;
        items.appendChild(note);
        var browse = document.createElement('button');
        browse.type = 'button';
        browse.className = 'tray-shop-link';
        browse.textContent = 'Browse ' + section.label + ' in Shop';
        browse.addEventListener('click', function () {
          shopKind = section.kind;
          openShop();
        });
        items.appendChild(browse);
      }

      wrap.appendChild(tab);
      wrap.appendChild(items);
      rack.appendChild(wrap);
    });
    syncTrayOpen();
    if (focusedKind) {
      Array.prototype.forEach.call(rack.querySelectorAll('button'), function (button) {
        if (button.dataset.trayKind === focusedKind && button.dataset.itemId === focusedItem) button.focus();
      });
    }
  }

  var SHOP_TITLES = { themes: 'themes', pets: 'pets', satellites: 'satellites' };
  var SHOP_BLURBS = {
    themes: 'Whole-planet clothes. Swap a world on like a postcard.',
    pets: 'Little walkers for the paths. One can be out at a time.',
    satellites: 'Orbiting company. They keep circling, even when the view folds.'
  };
  var POLAROID_TILT = ['r1', 'r2', 'r3', 'r4'];

  function renderShop() {
    if (!SHOP_TITLES[shopKind]) shopKind = 'themes';
    var kind = shopKind;
    var balance = MI.economy.balance();
    el['shop-balance'].textContent = balance;
    el['shop-title'].textContent = SHOP_TITLES[kind] || kind;
    if (el['shop-blurb']) el['shop-blurb'].textContent = SHOP_BLURBS[kind] || '';
    el.shop.setAttribute('data-kind', kind);
    Array.prototype.forEach.call(el.shop.querySelectorAll('.tabs button'), function (tab) {
      tab.setAttribute('aria-selected', String(tab.dataset.kind === kind));
    });

    el['shop-items'].innerHTML = '';
    var listed = 0;
    MI.economy.CATALOG[kind].forEach(function (item) {
      if (MI.economy.owns(kind, item.id)) return;
      listed += 1;
      var canBuy = balance >= item.price;
      var card = document.createElement('button');
      card.type = 'button';
      card.className = 'polaroid ' + POLAROID_TILT[(listed - 1) % POLAROID_TILT.length] + (canBuy ? '' : ' short');
      if (!canBuy) card.disabled = true;

      var photo = document.createElement('span');
      photo.className = 'photo';
      if (kind === 'themes') {
        var planet = document.createElement('span');
        planet.className = 'mini-planet';
        planet.style.background = themeFill(item.id);
        photo.appendChild(planet);
      } else {
        var glyph = document.createElement('span');
        glyph.className = 'glyph';
        glyph.textContent = item.icon;
        photo.appendChild(glyph);
      }
      card.appendChild(photo);

      var caption = document.createElement('span');
      caption.className = 'caption';
      caption.textContent = item.name;
      card.appendChild(caption);

      var sticker = document.createElement('span');
      sticker.className = 'sticker';
      sticker.textContent = canBuy ? String(item.price) : ((item.price - balance) + ' short');
      card.appendChild(sticker);

      if (canBuy) card.addEventListener('click', function () { buy(kind, item); });
      el['shop-items'].appendChild(card);
    });
    if (!listed) {
      var empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = 'Everything here is yours. Use the controls below Settings to choose one.';
      el['shop-items'].appendChild(empty);
    }
  }

  // --- Your character, and ground view ----------------------------------------------------
  // The character is always on the planet, so the button is a pure camera toggle: it never
  // asks who you are. Choosing a character is its own action (openCharacterPicker, which the
  // settings menu opens) and it swaps the model where it stands, without moving the camera.

  var pickerChoice = null;
  var pickerOpener = null;
  var hubLookId = null;
  var gateAvatar = null;
  var gateBusy = false;
  var hoveredGalaxy = null;
  var galaxyEditing = false;
  var galaxyDeleteArmed = null;
  var galaxyCardHide = null;
  var lastGalaxyScreens = [];

  function fillAvatarGrid(container, selectedId, onPick) {
    var characters = MI.world.characters();
    var chosen = selectedId || (characters[0] && characters[0].id);
    container.innerHTML = '';
    characters.forEach(function (character) {
      var card = document.createElement('button');
      card.className = 'card';
      card.type = 'button';
      card.setAttribute('role', 'radio');
      card.setAttribute('aria-checked', String(character.id === chosen));
      var tint = '#' + ('000000' + character.color.toString(16)).slice(-6);
      card.innerHTML = '<span class="figure" style="--tint: ' + tint + '">' +
        '<span class="head"></span><span class="body"></span><span class="legs"></span></span>' +
        '<span class="name"></span>';
      card.querySelector('.name').textContent = character.name;
      card.addEventListener('click', function () { onPick(character.id); });
      container.appendChild(card);
    });
    return chosen;
  }

  function openPicker() {
    pickerOpener = document.activeElement;
    var saved = MI.store.get().player;
    pickerChoice = MI.world.currentCharacter() || (saved && saved.character) || null;
    el['picker-play'].textContent = 'Choose';
    renderPicker();
    el.picker.classList.add('open');
    el['picker-play'].focus();
  }

  function closePicker() {
    el.picker.classList.remove('open');
    if (pickerOpener && pickerOpener.focus) pickerOpener.focus();
  }

  function closeHubCard() {
    hubLookId = null;
    if (el['hub-card']) el['hub-card'].classList.remove('open');
  }

  function showHubCard(lookId) {
    if (!lookId) { closeHubCard(); return; }
    var info = MI.world.inspectHubLook(lookId);
    if (!info) { closeHubCard(); return; }
    hubLookId = lookId;
    el['hub-card-name'].textContent = info.person ? info.person.name : info.look.name;
    if (info.you) {
      el['hub-card-sub'].textContent = info.person
        ? 'This is you — ' + info.person.name + ' wears this look too'
        : 'This is you';
    } else if (info.person) {
      el['hub-card-sub'].textContent = (info.person.relationship || 'friend')
        + ' · wearing ' + info.look.name;
    } else {
      el['hub-card-sub'].textContent = 'Nobody is using this look';
    }
    if (info.person && !info.you) {
      el['hub-card-friend'].hidden = false;
      var n = (info.person.memoryIds && info.person.memoryIds.length)
        || info.titles.length;
      el['hub-card-friend-meta'].textContent = n
        ? (info.person.name + ' is in ' + plural(n, 'memory').replace('memorys', 'memories'))
        : (info.person.name + ' lives on your planet');
      el['hub-card-titles'].innerHTML = '';
      info.titles.forEach(function (title) {
        var li = document.createElement('li');
        li.textContent = title;
        el['hub-card-titles'].appendChild(li);
      });
    } else {
      el['hub-card-friend'].hidden = true;
    }
    el['hub-card-swap'].hidden = !info.canSwap;
    el['hub-card-swap'].textContent = info.person ? 'Swap looks' : 'Swap';
    el['hub-card'].classList.add('open');
  }

  function confirmHubSwap() {
    if (!hubLookId) return;
    var wanted = hubLookId;
    MI.world.applyHubSwap(wanted).then(function (result) {
      if (!result || !result.ok) return;
      closeHubCard();
      var name = result.look ? result.look.name : 'that look';
      if (result.person) {
        toast('🤝', 'Looks swapped', result.person.name + ' took your old look.', 0, 2400);
      } else {
        toast('✨', 'Now ' + name, 'Walk around — this is you.', 0, 2200);
      }
    });
  }

  function openHub() {
    closeSettings();
    closeShop();
    closePicker();
    hideDetail();
    hideShip();
    if (isBookBusy()) closeBook();
    closeHubCard();
    return Promise.resolve(MI.world.enterHub());
  }

  function exitHub() {
    closeHubCard();
    return Promise.resolve(MI.world.leaveHub());
  }

  function syncHubUi(on) {
    document.body.classList.toggle('hub', !!on);
    if (el['hub-ui']) el['hub-ui'].setAttribute('aria-hidden', on ? 'false' : 'true');
    if (on) {
      closeSettings();
      closeShop();
      closePicker();
      hideDetail();
    } else {
      closeHubCard();
    }
    syncGroundButton();
  }

  function renderPicker() {
    pickerChoice = fillAvatarGrid(el['picker-grid'], pickerChoice, function (id) {
      pickerChoice = id;
      renderPicker();
    });
  }

  function characterName(id) {
    var list = MI.world.characters();
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === id) return list[i].name;
    }
    return list[0] ? list[0].name : '';
  }

  function showGate(screen) {
    document.body.classList.add('gated');
    var empty = !MI.store.listJournals().length;
    if (screen === 'create' || empty) {
      el.gate.classList.add('open');
      showGateScreen('create', { first: empty });
      if (empty && MI.world.isGalaxy()) {
        hideGalaxyHud();
        MI.world.leaveGalaxy({ instant: true });
      }
      return;
    }
    el.gate.classList.remove('open');
    showGalaxyHud();
    MI.world.enterGalaxy(MI.store.listJournals(), {
      currentId: MI.store.currentId(),
      instant: !MI.store.currentId()
    });
  }

  function hideGate() {
    el.gate.classList.remove('open', 'busy');
    hideGalaxyHud();
    document.body.classList.remove('gated');
    gateBusy = false;
  }

  function showGateScreen(screen, opts) {
    var creating = screen === 'create';
    var first = !!(opts && opts.first) || !MI.store.listJournals().length;
    el['gate-shelf'].hidden = true;
    el['gate-create'].hidden = !creating;
    if (creating) {
      setGateCreateCopy(first);
      gateAvatar = fillAvatarGrid(el['gate-avatars'], gateAvatar, pickGateAvatar);
      syncGateCreate();
      setTimeout(function () { el['gate-name'].focus(); }, 40);
    }
  }

  function setGateCreateCopy(first) {
    el.gate.classList.toggle('first', !!first);
    el['gate-back'].hidden = !!first;
    if (el['gate-create-kicker']) {
      el['gate-create-kicker'].textContent = first ? 'welcome' : 'new journal';
    }
    if (el['gate-create-title']) {
      el['gate-create-title'].textContent = first ? 'Start your journal' : 'Name your world';
    }
    if (el['gate-create-blurb']) {
      el['gate-create-blurb'].textContent = first
        ? 'This is your first world. Give it a name and pick who you are — you can keep more journals later.'
        : 'This title sits at the top of your planet, on the journal you are keeping.';
    }
    if (!gateBusy) {
      el['gate-create-btn'].textContent = first ? 'Begin' : 'Create this world';
    }
  }

  function pickGateAvatar(id) {
    gateAvatar = id;
    fillAvatarGrid(el['gate-avatars'], gateAvatar, pickGateAvatar);
  }

  function journalById(id) {
    var list = MI.store.listJournals();
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === id) return list[i];
    }
    return null;
  }

  function showGalaxyHud() {
    el['galaxy-ui'].classList.add('open');
    refreshGalaxyCount();
  }

  function hideGalaxyHud() {
    el['galaxy-ui'].classList.remove('open');
    hideGalaxyCard(true);
    hoveredGalaxy = null;
    setGalaxyEditing(false);
  }

  function hideGalaxyCard(immediate) {
    clearTimeout(galaxyCardHide);
    galaxyCardHide = null;
    if (immediate) {
      el['galaxy-ui'].classList.remove('detail');
      el['galaxy-card'].classList.remove('show', 'beside');
      el['galaxy-card'].setAttribute('aria-hidden', 'true');
      return;
    }
    galaxyCardHide = setTimeout(function () {
      if (el['galaxy-card'].matches(':hover')) return;
      hoveredGalaxy = null;
      el['galaxy-ui'].classList.remove('detail');
      el['galaxy-card'].classList.remove('show');
      el['galaxy-card'].setAttribute('aria-hidden', 'true');
      disarmGalaxyDelete();
    }, 140);
  }

  function placeGalaxyCard(id) {
    var hit = null;
    lastGalaxyScreens.forEach(function (s) { if (s.id === id) hit = s; });
    if (!hit || hit.behind) return false;
    var radius = hit.r || 36;
    var above = hit.y - radius - 16;
    if (above < 118) {
      el['galaxy-card'].classList.add('beside');
      el['galaxy-card'].style.left = (hit.x + radius + 18) + 'px';
      el['galaxy-card'].style.top = Math.max(118, hit.y) + 'px';
    } else {
      el['galaxy-card'].classList.remove('beside');
      el['galaxy-card'].style.left = hit.x + 'px';
      el['galaxy-card'].style.top = above + 'px';
    }
    return true;
  }

  function refreshGalaxyCount() {
    var n = MI.store.listJournals().length;
    el['galaxy-count-text'].textContent = n === 1 ? '1 planet' : n + ' planets';
    el['galaxy-hint'].textContent = n
      ? 'arrows or WASD to move · hover for details · click to open'
      : 'no worlds yet — start a new journal';
  }

  function updateGalaxyCard(id) {
    el['galaxy-hint'].classList.toggle('dim', !!id); // the bold planet names land on it
    if (!id) {
      hideGalaxyCard(false);
      return;
    }
    clearTimeout(galaxyCardHide);
    galaxyCardHide = null;
    if (id === hoveredGalaxy && el['galaxy-card'].classList.contains('show')) {
      placeGalaxyCard(id);
      return;
    }
    hoveredGalaxy = id;
    disarmGalaxyDelete();
    var journal = journalById(id);
    if (!journal) {
      hideGalaxyCard(true);
      return;
    }
    var bits = [plural(journal.memories, 'memory').replace('memorys', 'memories')];
    if (journal.people) bits.push(plural(journal.people, 'friend'));
    el['galaxy-card-meta'].textContent = bits.join(' · ');
    syncGalaxyTools();
    placeGalaxyCard(id);
    el['galaxy-ui'].classList.add('detail');
    el['galaxy-card'].setAttribute('aria-hidden', 'false');
    el['galaxy-card'].classList.add('show');
  }

  // Delete and the reorder nudges only exist while editing; hovering is otherwise read-only.
  function syncGalaxyTools() {
    el['galaxy-tools'].hidden = !galaxyEditing;
    var list = MI.store.listJournals();
    var at = -1;
    if (hoveredGalaxy) list.forEach(function (j, i) { if (j.id === hoveredGalaxy) at = i; });
    // A world at the end of the shelf has nowhere further to go that way.
    el['galaxy-left'].disabled = gateBusy || at <= 0;
    el['galaxy-right'].disabled = gateBusy || at < 0 || at >= list.length - 1;
    el['galaxy-delete'].disabled = gateBusy || at < 0;
  }

  function setGalaxyEditing(on) {
    galaxyEditing = !!on;
    el['galaxy-edit'].setAttribute('aria-pressed', String(galaxyEditing));
    // The button holds a pencil icon, so its state goes in the label — writing textContent
    // here would throw the svg away.
    var label = galaxyEditing ? 'Done editing your worlds' : 'Edit your worlds';
    el['galaxy-edit'].setAttribute('aria-label', label);
    el['galaxy-edit'].title = label;
    if (galaxyEditing) el['galaxy-hint'].textContent = 'editing · reorder with ‹ › · delete a world';
    else refreshGalaxyCount(); // owns the hint text, and theirs now names the controls
    disarmGalaxyDelete();
    syncGalaxyTools();
  }

  // Swap a world with its neighbour and lay the ring out again. The card follows the planet,
  // so keep the same world hovered rather than dropping the panel mid-edit.
  function nudgeGalaxy(delta) {
    if (gateBusy || !galaxyEditing || !hoveredGalaxy) return;
    if (!MI.store.reorderJournal(hoveredGalaxy, delta)) return;
    var keep = hoveredGalaxy;
    disarmGalaxyDelete();
    hoveredGalaxy = null;      // force updateGalaxyCard to redraw against the new order
    refreshGalaxy();
    updateGalaxyCard(keep);
    MI.world.hoverGalaxyPlanet(keep); // stay held, but do not fly the camera on every nudge
  }

  function syncGalaxyLabels(screens) {
    lastGalaxyScreens = screens || [];
    var wrap = el['galaxy-labels'];
    var seen = {};
    screens.forEach(function (s) {
      if (s.behind) return;
      seen[s.id] = true;
      var node = wrap.querySelector('[data-id="' + s.id + '"]');
      if (!node) {
        node = document.createElement('div');
        node.className = 'label';
        node.setAttribute('data-id', s.id);
        wrap.appendChild(node);
      }
      var journal = s.journal || journalById(s.id);
      node.textContent = journal ? journal.name : '';
      node.style.left = s.x + 'px';
      node.style.top = (s.y + (s.r || 28) + 10) + 'px';
      node.classList.toggle('hover', !!s.hover);
      node.classList.toggle('focus', !!s.focus);
    });
    Array.prototype.forEach.call(wrap.querySelectorAll('.label'), function (node) {
      if (!seen[node.getAttribute('data-id')]) node.parentNode.removeChild(node);
    });
    if (hoveredGalaxy && el['galaxy-card'].classList.contains('show')) {
      placeGalaxyCard(hoveredGalaxy);
    }
  }

  function refreshGalaxy() {
    MI.world.enterGalaxy(MI.store.listJournals(), { currentId: MI.store.currentId() });
    refreshGalaxyCount();
    updateGalaxyCard(hoveredGalaxy);
  }

  function disarmGalaxyDelete() {
    clearTimeout(galaxyDeleteArmed);
    galaxyDeleteArmed = null;
    if (el['galaxy-delete']) {
      el['galaxy-delete'].textContent = 'delete';
      el['galaxy-delete'].classList.remove('confirming');
    }
  }

  function handleGalaxyDelete() {
    if (gateBusy || !hoveredGalaxy) return;
    if (!galaxyDeleteArmed) {
      el['galaxy-delete'].textContent = 'sure? gone for good';
      el['galaxy-delete'].classList.add('confirming');
      galaxyDeleteArmed = setTimeout(disarmGalaxyDelete, 4000);
      return;
    }
    var id = hoveredGalaxy;
    disarmGalaxyDelete();
    var result = MI.store.deleteJournal(id);
    if (!result.ok) return;
    hoveredGalaxy = null;
    hideGalaxyCard(true);
    if (!MI.store.listJournals().length) {
      hideGalaxyHud();
      MI.world.leaveGalaxy({ instant: true }).then(function () {
        showGate('create');
      });
      return;
    }
    refreshGalaxy();
  }

  function syncGateCreate() {
    el['gate-create-btn'].disabled = gateBusy || !el['gate-name'].value.trim();
  }

  function setGateBusy(busy) {
    gateBusy = !!busy;
    el.gate.classList.toggle('busy', gateBusy);
    el['galaxy-ui'].classList.toggle('busy', gateBusy);
    el['gate-create-btn'].disabled = gateBusy || !el['gate-name'].value.trim();
    el['gate-create-btn'].textContent = gateBusy
      ? 'opening…'
      : (el.gate.classList.contains('first') ? 'Begin' : 'Create this world');
    el['galaxy-new'].disabled = gateBusy;
    el['galaxy-edit'].disabled = gateBusy;
    syncGalaxyTools();
  }

  function finishEnter() {
    hideGate();
    refreshStats();
    renderThemeTray();
    syncViewButton();
    syncGroundButton();
  }

  function afterEntered() {
    finishEnter();
  }

  function enterExisting(id) {
    if (gateBusy || !id) return;
    setGateBusy(true);
    hideGalaxyHud();
    var same = MI.store.currentId() === id;
    beginTravel('Opening your planet…').then(function () { return MI.world.selectGalaxyPlanet(id); }).then(function () {
      if (same) return true;
      return MI.app.enterJournal(id, { keepCamera: true });
    }).then(function (ok) {
      if (!ok) {
        setGateBusy(false);
        endTravel();
        showGalaxyHud();
        refreshGalaxy();
        return;
      }
      return MI.world.leaveGalaxy({ fit: !same }).then(function () {
        setGateBusy(false);
        finishEnter();
        endTravel();
      });
    }).catch(function () {
      setGateBusy(false);
      endTravel();
      showGalaxyHud();
      refreshGalaxy();
    });
  }

  function submitNewJournal() {
    if (gateBusy) return;
    var name = el['gate-name'].value.trim();
    if (!name) {
      el['gate-name'].focus();
      return;
    }
    setGateBusy(true);
    el.gate.classList.remove('open');
    hideGalaxyHud();
    var fromGalaxy = MI.world.isGalaxy();
    beginTravel('Making your planet…').then(function () { return MI.app.createJournal({
      name: name,
      character: gateAvatar,
      keepCamera: fromGalaxy
    }); }).then(function () {
      return fromGalaxy ? MI.world.leaveGalaxy({ fit: true }) : Promise.resolve();
    }).then(function () {
      el['gate-name'].value = '';
      setGateBusy(false);
      finishEnter();
      endTravel();
    }).catch(function () { setGateBusy(false); endTravel(); });
  }

  function returnToShelf() {
    closeSettings();
    closeShop();
    closePicker();
    hideDetail();
    if (isBookBusy()) dismissBook();
    var ready = Promise.resolve();
    if (MI.world.isHub && MI.world.isHub()) ready = Promise.resolve(MI.world.leaveHub({ instant: true }));
    ready.then(function () {
      return MI.world.isGroundView() ? leaveGroundView() : Promise.resolve();
    }).then(function () { showGate('shelf'); });
  }

  function chooseCharacter() {
    var world = MI.store.get();
    world.player = world.player || { character: null };
    world.player.character = pickerChoice;
    MI.store.save();
    closePicker();
    return MI.world.setCharacter(pickerChoice);
  }

  function toggleGroundView() {
    if (!MI.world.isFlatView()) return Promise.resolve();
    return Promise.resolve(MI.world.setGroundView(!MI.world.isGroundView()))
      .then(syncGroundButton);
  }

  function leaveGroundView() {
    return Promise.resolve(MI.world.setGroundView(false)).then(syncGroundButton);
  }

  // The follow button exists only on a settled island: hidden on the planet and for the whole
  // of a fold, and lit while you are following.
  function syncGroundButton() {
    var onGround = MI.world.isGroundView();
    var available = MI.world.isFlatView() && !MI.world.isTransitioning()
      && !(MI.world.isHub && MI.world.isHub());
    el['ground-btn'].classList.toggle('show', available);
    el['ground-btn'].classList.toggle('on', onGround);
    el['ground-btn'].setAttribute('aria-pressed', onGround ? 'true' : 'false');
    el['ground-btn'].tabIndex = available ? 0 : -1;
  }

  function buy(kind, item) {
    var result = MI.economy.buy(kind, item.id);
    if (!result.ok) return;
    MI.app.equip(kind, item.id); // a new unlock goes straight on
    refreshWallet();
    renderShop();
    renderThemeTray();
    toast(item.icon, item.name + ' unlocked!',
      'Now on your planet. Change it below Settings.', 0, 2600);
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
          // Which pack a building comes from is world.js's to know, not ours.
          memory.asset = MI.world.assetFor(file);
          MI.store.save();
          MI.world.respawnMemory(memory);
          renderSwaps(memory);
        });
      }
      el['detail-swaps'].appendChild(button);
    });
  }

  // --- Renaming an entry -------------------------------------------------------------------
  // A title is a guess until someone says otherwise, so it is editable in place.

  var openMemory = null;

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

  function hideDetail() {
    saveTitle(); // a rename in progress counts, even if they click away
    el.detail.classList.remove('show');
    openSlot = null;
    openMemory = null;
    MI.world.clearHighlight();
    markOpenRow(false);
  }

  // --- Ships ------------------------------------------------------------------------------
  // A ship is the one thing here you cannot buy: it asks for something written, and until you
  // write it the ship keeps its distance. The card is the only place that says what it wants,
  // so it has to say it plainly.

  var openShipId = null;

  function showShip(shipId) {
    var world = MI.store.get();
    var ship = MI.ships.find(world, shipId);
    if (!ship) return;
    hideDetail(); // the two cards share a corner
    openShipId = shipId;
    var progress = MI.ships.progressFor(world, ship);

    el['ship-card'].classList.toggle('claimed', !!ship.claimed);
    el['ship-flag'].textContent = ship.claimed ? 'sails with you' : 'flies a black flag';
    el['ship-name'].textContent = ship.name;
    el['ship-ask'].textContent = ship.claimed
      ? 'Yours. They keep to your coast now, and they will not trouble you again.'
      : progress.ask + ', and they will hear you out.';
    el['ship-bar'].hidden = !!ship.claimed;
    el['ship-count'].textContent = ship.claimed
      ? ''
      : progress.done + ' of ' + progress.target + ' ' + progress.unit;
    el['ship-fill'].style.width = Math.round((progress.done / progress.target) * 100) + '%';
    el['ship-claim'].hidden = !!ship.claimed || !progress.complete;
    el['ship-card'].classList.add('show');
  }

  function hideShip() {
    openShipId = null;
    el['ship-card'].classList.remove('show');
  }

  function claimOpenShip() {
    if (!openShipId) return;
    var id = openShipId;
    if (MI.app.claimShip(id)) showShip(id); // the same card, now saying it is yours
  }

  function setBusy(busy) {
    el['submit-btn'].disabled = busy;
    if (busy) el['submit-btn'].textContent = isEditing() ? 'saving…' : 'planting…';
    else syncWriteMode(); // the label depends on whether this is a new entry or a rewrite
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

  // --- Editing a memory -------------------------------------------------------------------
  // An edit reuses the writing page rather than growing a second, lesser set of controls
  // inside the detail card: same textarea, same chips that carry a person, same faces, same
  // kinds. Only the labels and what Save does are different.

  var editingId = null;       // the memory being rewritten, or null while writing a new one
  var draftBeforeEdit = null; // the unsent entry we interrupted, handed back when editing ends

  function isEditing() { return editingId !== null; }

  function syncWriteMode() {
    var editing = isEditing();
    el['write-title'].textContent = editing ? 'editing' : 'today';
    el['edit-cancel'].hidden = !editing;
    el['entry-input'].placeholder = editing ? 'What actually happened?' : 'What happened today?';
    if (!el['submit-btn'].disabled) {
      el['submit-btn'].textContent = editing
        ? el['submit-btn'].dataset.edit
        : el['submit-btn'].dataset.write;
    }
  }

  function todayLabel() {
    return new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  }

  // An edit is dated by the day the memory is about, not the day you fixed it.
  function entryDateLabel(memory) {
    var when = memory.occurredOn || (memory.createdAt || '').slice(0, 10);
    var parsed = when ? new Date(when + 'T00:00:00') : null;
    if (!parsed || isNaN(parsed.getTime())) return todayLabel();
    return parsed.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  }

  function startEditing(memory) {
    if (!memory) return;
    // Hold on to whatever was half-written, or opening an edit would eat it.
    if (!isEditing()) draftBeforeEdit = { text: el['entry-input'].value, tags: tags, touched: touched };
    editingId = memory.id;

    el['entry-input'].value = memory.text || '';
    tags = {
      people: (memory.people || []).map(function (id) {
        var person = MI.store.get().people.filter(function (p) { return p.id === id; })[0];
        return person ? { name: person.name, personId: person.id } : null;
      }).filter(Boolean),
      mood: memory.mood && memory.mood.label ? moodKeyFromLabel(memory.mood.label) : null,
      category: memory.category || null,
      big: memory.importance === 4
    };
    // All marked touched: these are answers the writer already gave, and the keyword guess
    // must not quietly overwrite them as the sentence is retyped.
    touched = { people: true, mood: true, category: true, importance: true };

    hideDetail();
    refreshPersonList();
    paintTagRow();
    syncWriteMode();
    el['write-date'].textContent = entryDateLabel(memory);
    if (isBookOpen()) {
      selectBookPage('write');
      el['entry-input'].focus();
    } else {
      openBook();
    }
  }

  // Leave edit mode and put the interrupted draft back on the page.
  function stopEditing() {
    if (!isEditing()) return;
    editingId = null;
    if (draftBeforeEdit) {
      el['entry-input'].value = draftBeforeEdit.text;
      tags = draftBeforeEdit.tags;
      touched = draftBeforeEdit.touched;
      draftBeforeEdit = null;
    } else {
      el['entry-input'].value = '';
      tags = { people: [], mood: null, category: null, big: false };
      touched = {};
    }
    el['tag-person-input'].value = '';
    paintTagRow();
    syncWriteMode();
    el['write-date'].textContent = todayLabel();
  }

  // Say what quietly changed on the planet, so an edit never silently removes someone.
  function describeEdit(result) {
    var gone = (result.departed || []).map(function (p) { return p.name; });
    var came = (result.arrived || []).map(function (p) { return p.name; });
    if (gone.length && came.length) {
      return ['🔁', 'Your world changed', came.join(', ') + ' moved in · ' + gone.join(', ') + ' left.'];
    }
    if (gone.length === 1) {
      return ['👋', gone[0] + ' left your world', 'No memory mentions them any more.'];
    }
    if (gone.length) {
      return ['👋', gone.length + ' friends left your world', gone.join(', ') + ' are no longer in any memory.'];
    }
    if (came.length === 1) {
      return ['🙋', came[0] + ' moved in', 'They are standing by this memory.'];
    }
    if (came.length) {
      return ['🙋', came.length + ' friends moved in', came.join(', ') + ' are standing by this memory.'];
    }
    return ['✏️', 'Memory updated', 'Your planet matches what it says now.'];
  }

  function submitEdit() {
    var text = el['entry-input'].value.trim();
    if (!text) return;
    commitPerson(); // a name still sitting in the box counts
    var id = editingId;
    var entryTags = currentTags();
    setBusy(true);
    closeBook();

    MI.app.updateEntry(id, text, { tags: entryTags }).then(function (result) {
      setBusy(false);
      if (!result) { openBook(); return; } // nothing saved: leave the rewrite on screen
      stopEditing();
      var said = describeEdit(result);
      toast(said[0], said[1], said[2], 0, 4200);
      refreshStats();
      renderBook();
      showDetail(result.memory);
    }, function (err) {
      setBusy(false);
      console.error('[MI.ui] updateEntry failed', err);
      openBook(); // keep the rewrite available to retry
    });
  }

  function submitEntry() {
    if (el['submit-btn'].disabled) return;
    stopListening({ silent: true });
    if (isEditing()) { submitEdit(); return; }
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
    // Back to the smallest planet, with coins and unlocks wiped too.
    MI.app.startOver().then(function () {
      syncViewButton();
      refreshStats();
    });
  }

  function syncViewButton() {
    markView(MI.world.isFlatView());
  }

  function markView(island) {
    el['view-btn'].classList.toggle('is-island', island);
    el['view-planet-label'].setAttribute('aria-pressed', String(!island));
    el['view-island-label'].setAttribute('aria-pressed', String(island));
  }
  function disarmReset() {
    clearTimeout(resetArmed);
    resetArmed = null;
    el['reset-btn'].textContent = 'start over';
    el['reset-btn'].classList.remove('confirming');
  }

  // Each option selects its own view. Asking for the view you are already in does nothing:
  // it is a two-position switch, not a toggle that flips from whichever side you press.
  function showView(wantIsland) {
    if (MI.store.get().memories.length === 0) return; // nothing to lay out yet
    if (MI.world.isTransitioning()) return; // let the fold finish before reversing it
    if (wantIsland === MI.world.isFlatView()) return; // already there
    markView(wantIsland);
    hideDetail();
    MI.world.setFlatView(wantIsland);
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
    el['view-btn'].addEventListener('click', function (e) {
      var opt = e.target.closest('.opt');
      if (!opt) return;
      var wantIsland = opt.dataset.view === 'island';
      // The two views hold the character in different places and the fold animates the
      // camera, so come back up first; they can drop to the ground again after. From the
      // ground both options are live — either one lifts you into the view you asked for.
      if (MI.world.isGroundView()) {
        leaveGroundView().then(function () { showView(wantIsland); });
        return;
      }
      showView(wantIsland);
    });

    el['submit-btn'].addEventListener('click', submitEntry);
    el['mic-btn'].addEventListener('click', toggleListening);
    el['entry-input'].addEventListener('keydown', function (e) {
      // It is a page in a book, so Enter is a new line; Ctrl/Cmd+Enter puts it on the planet.
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submitEntry(); }
    });

    el['detail-edit'].addEventListener('click', function () {
      if (openMemory) startEditing(openMemory);
    });
    el['edit-cancel'].addEventListener('click', function () {
      var memory = MI.store.get().memories.filter(function (m) { return m.id === editingId; })[0];
      stopEditing();
      if (memory) showDetail(memory); // back to the card you came from
    });
    el['book-btn'].addEventListener('click', openBook);
    el['book-btn'].addEventListener('pointerenter', peekMiniBook);
    el['book-btn'].addEventListener('pointerleave', function () {
      if (document.activeElement !== el['book-btn']) unpeekMiniBook();
    });
    el['book-btn'].addEventListener('focus', peekMiniBook);
    el['book-btn'].addEventListener('blur', function () {
      if (!el['book-btn'].matches(':hover')) unpeekMiniBook();
    });
    el['book-close'].addEventListener('click', dismissBook);
    el['book-write-tab'].addEventListener('click', function () { selectBookPage('write'); });
    el['book-memories-tab'].addEventListener('click', function () { selectBookPage('memories'); });
    el.book.addEventListener('click', function (e) {
      if (e.target === el.book) dismissBook(); // the cover around the pages, not the pages
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

    MI.app.onEvent(handleAppEvent);
    el['ground-btn'].addEventListener('click', toggleGroundView);
    MI.world.onViewChange(syncGroundButton);
    MI.world.onGroundView(syncGroundButton);
    // Settings is where you change who you are: the picker is the same full-sheet grid you
    // would have seen the first time.
    el['character-btn'].addEventListener('click', function () {
      closeSettings();
      openHub();
    });
    el['journals-btn'].addEventListener('click', returnToShelf);
    el['galaxy-new'].addEventListener('click', function () {
      hideGalaxyCard(true);
      showGate('create');
    });
    el['galaxy-delete'].addEventListener('click', handleGalaxyDelete);
    el['galaxy-edit'].addEventListener('click', function () { setGalaxyEditing(!galaxyEditing); });
    el['galaxy-left'].addEventListener('click', function () { nudgeGalaxy(-1); });
    el['galaxy-right'].addEventListener('click', function () { nudgeGalaxy(1); });
    el['galaxy-card'].addEventListener('mouseenter', function () {
      clearTimeout(galaxyCardHide);
    });
    el['galaxy-card'].addEventListener('mouseleave', function () {
      updateGalaxyCard(null);
    });
    el['gate-new'].addEventListener('click', function () { showGate('create'); });
    el['gate-back'].addEventListener('click', function () {
      if (!MI.store.listJournals().length) return;
      el.gate.classList.remove('open');
    });
    el['gate-create-btn'].addEventListener('click', submitNewJournal);
    el['gate-name'].addEventListener('input', syncGateCreate);
    el['gate-name'].addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); submitNewJournal(); }
    });
    el['picker-play'].addEventListener('click', chooseCharacter);
    el.picker.addEventListener('click', function (e) {
      if (e.target === el.picker) closePicker(); // the backdrop, not the sheet
    });
    syncGroundButton();
    el['shop-btn'].addEventListener('click', openShop);
    el['shop-close'].addEventListener('click', closeShop);
    el.shop.addEventListener('click', function (e) {
      if (e.target === el.shop) closeShop(); // a click on the backdrop, not the sheet
    });

    document.addEventListener('pointerdown', function (e) {
      if (!el['theme-rack'].classList.contains('open')) return;
      if (el['theme-rack'].contains(e.target)) return;
      closeThemeTray();
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
      if (gateBusy) return;
      if (el.gate.classList.contains('open')) {
        if (MI.store.listJournals().length) el.gate.classList.remove('open');
        return;
      }
      if (MI.world.isGalaxy()) {
        if (MI.store.currentId()) {
          setGateBusy(true);
          MI.world.leaveGalaxy().then(function () {
            setGateBusy(false);
            afterEntered();
          }).catch(function () { setGateBusy(false); });
        }
        return;
      }
      if (el.picker.classList.contains('open')) { closePicker(); return; }
      if (el['hub-card'] && el['hub-card'].classList.contains('open')) { closeHubCard(); return; }
      if (MI.world.isHub && MI.world.isHub()) { exitHub(); return; }
      if (MI.world.isGroundView()) { leaveGroundView(); return; }
      if (el.shop.classList.contains('open')) closeShop();
      else if (el.settings.classList.contains('open')) closeSettings();
      else if (el['theme-rack'].classList.contains('open')) closeThemeTray();
      else if (el['ship-card'] && el['ship-card'].classList.contains('show')) hideShip();
      else if (isBookBusy()) dismissBook();
    });

    MI.world.onShipPick(function (shipId) {
      if (document.body.classList.contains('gated')) return;
      showShip(shipId);
    });
    el['ship-close'].addEventListener('click', hideShip);
    el['ship-claim'].addEventListener('click', claimOpenShip);

    MI.world.onPick(function (slot) {
      if (document.body.classList.contains('gated')) return;
      hideShip(); // clicked away from the ocean
      if (MI.world.isHubSlot && MI.world.isHubSlot(slot)) {
        hideDetail();
        openHub();
        return;
      }
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
      if (document.body.classList.contains('gated')) return false;
      if (MI.world.isHubSlot && MI.world.isHubSlot(slot)) {
        MI.world.highlightSlot(slot, { soft: true });
        return true;
      }
      var memory = slot === null || slot === undefined ? null : MI.store.findMemoryBySlot(slot);
      if (memory) MI.world.highlightSlot(slot, { soft: true });
      else if (openSlot === null) MI.world.clearHighlight();
      else MI.world.highlightSlot(openSlot);
      return !!memory;
    });

    MI.world.onGalaxyHover(function (id) {
      if (gateBusy) return;
      updateGalaxyCard(id);
    });
    MI.world.onGalaxyPick(function (id) {
      if (gateBusy) return;
      if (!id) {
        updateGalaxyCard(null);
        return;
      }
      // Clicking a world is how you open it — except while editing, where a click is aimed
      // at the tools on the card and opening the world underneath would be a nasty surprise.
      if (galaxyEditing) {
        updateGalaxyCard(id);
        return;
      }
      enterExisting(id);
    });
    MI.world.onGalaxyFrame(syncGalaxyLabels);
    MI.world.onHubPick(showHubCard);
    MI.world.onHubChange(syncHubUi);
    el['hub-leave'].addEventListener('click', exitHub);
    el['hub-card-close'].addEventListener('click', closeHubCard);
    el['hub-card-swap'].addEventListener('click', confirmHubSwap);

    refreshStats();
  }

  function hideLoading() {
    el.loading.classList.add('hide');
  }

  function beginTravel(message) {
    var label = document.getElementById('loading-text');
    if (label) label.textContent = message || 'Loading…';
    el.loading.classList.add('travel');
    el.loading.classList.remove('hide');
    return new Promise(function (resolve) {
      setTimeout(resolve, window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 440);
    });
  }

  function endTravel() {
    el.loading.classList.add('hide');
  }

  MI.ui = {
    init: init, refreshStats: refreshStats, hideLoading: hideLoading,
    beginTravel: beginTravel, endTravel: endTravel,
    showGate: showGate,
    // The settings menu opens this; it is the only way to change who you are.
    openCharacterPicker: openHub
  };
})();
