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
      'reset-btn', 'view-btn', 'view-icon', 'view-label', 'detail-swaps', 'toast-shards',
      'planet-card', 'planet-size', 'planet-tiles', 'planet-bar', 'planet-hint',
      'wallet', 'wallet-count', 'shop-btn', 'shop', 'shop-close', 'shop-balance', 'shop-items',
      'journal', 'book', 'book-btn', 'book-close', 'book-count', 'book-note',
      'book-list', 'book-write-tab', 'book-memories-tab', 'write-date', 'title-suggest',
      'tag-row', 'tag-people', 'tag-person-input', 'tag-person-list',
      'tag-mood', 'tag-cat', 'tag-big']
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
    // Neither button means anything on an empty planet.
    el['reset-btn'].classList.toggle('show', memories > 0);
    el['view-btn'].classList.toggle('show', memories > 0);

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
    el.book.dataset.page = page;
    el['book-write-tab'].setAttribute('aria-selected', String(page === 'write'));
    el['book-memories-tab'].setAttribute('aria-selected', String(page === 'memories'));
    if (page === 'write' && window.innerWidth <= 680 && isBookOpen()) el['entry-input'].focus();
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
    clearTimeout(bookFocusTimer);
    el.book.classList.remove('open');
    el['book-btn'].setAttribute('aria-expanded', 'false');
    if (bookOpener && bookOpener.isConnected) bookOpener.focus();
  }

  function isBookOpen() {
    return el.book.classList.contains('open');
  }

  // --- The book ---------------------------------------------------------------------------
  // Every entry, newest first, two-way linked with the planet: hovering a row marks its tile,
  // clicking one opens it, and clicking the tile flashes the row.

  var rowBySlot = {};

  function dayLabel(iso) {
    var today = new Date().toISOString().slice(0, 10);
    if (iso === today) return 'today';
    try {
      return new Date(iso + 'T12:00:00').toLocaleDateString(undefined, { month: 'long', day: 'numeric' });
    } catch (e) {
      return iso;
    }
  }

  function renderBook() {
    var world = MI.store.get();
    var count = world.memories.length;
    el['book-count'].textContent = count ? count : '';
    el['book-note'].textContent = count ? plural(count, 'memory').replace('memorys', 'memories') : '';
    el['book-list'].innerHTML = '';
    rowBySlot = {};

    if (!count) {
      var blank = document.createElement('div');
      blank.className = 'empty-page';
      blank.textContent = 'Nothing written yet. Whatever you put on the right becomes a building on your planet.';
      el['book-list'].appendChild(blank);
      return;
    }

    // Memories are stored in the order they were written, so the book sorts for itself.
    var entries = world.memories.slice().sort(function (a, b) {
      var byDate = String(b.occurredOn || '').localeCompare(String(a.occurredOn || ''));
      return byDate !== 0 ? byDate : String(b.createdAt).localeCompare(String(a.createdAt));
    });

    var day = null;
    entries.forEach(function (memory) {
      var on = (memory.occurredOn || memory.createdAt || '').slice(0, 10);
      if (on !== day) {
        day = on;
        var heading = document.createElement('div');
        heading.className = 'day';
        heading.textContent = dayLabel(on);
        el['book-list'].appendChild(heading);
      }
      el['book-list'].appendChild(buildRow(memory, world));
    });
  }

  function buildRow(memory, world) {
    var flavor = CATEGORY_FLAVOR[memory.category] || CATEGORY_FLAVOR.other;
    var row = document.createElement('button');
    row.className = 'entry';

    var emoji = document.createElement('span');
    emoji.className = 'entry-emoji';
    emoji.textContent = flavor.emoji;

    var body = document.createElement('span');
    body.className = 'entry-body';
    var name = document.createElement('span');
    name.className = 'entry-name';
    name.textContent = memory.title;
    body.appendChild(name);

    var people = (memory.people || []).map(function (id) {
      return world.people.filter(function (p) { return p.id === id; })[0];
    }).filter(Boolean);
    if (people.length) {
      var who = document.createElement('span');
      who.className = 'entry-who';
      people.forEach(function (person) {
        var dot = document.createElement('span');
        dot.className = 'who-dot';
        var color = (person.appearance && person.appearance.color) || 0x7fa3ae;
        dot.style.background = '#' + color.toString(16).padStart(6, '0');
        who.appendChild(dot);
      });
      who.appendChild(document.createTextNode(people.map(function (p) { return p.name; }).join(', ')));
      body.appendChild(who);
    }

    row.appendChild(emoji);
    row.appendChild(body);

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
        closeBook(); // the card and the planet are behind the book
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
    el['planet-size'].textContent = '🪐 Size ' + size + ' of ' + MI.growth.LADDER.length;
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
    shopOpener = document.activeElement;
    renderShop();
    el.shop.classList.add('open');
    el['shop-close'].focus();
  }

  function closeShop() {
    el.shop.classList.remove('open');
    if (shopOpener && shopOpener.focus) shopOpener.focus();
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
  }

  function submitEntry() {
    if (el['submit-btn'].disabled) return;
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
    el.toast.classList.remove('show');
    // Back to the smallest planet, with shards and unlocks wiped too.
    MI.app.startOver().then(function () {
      syncViewButton();
      refreshStats();
    });
  }

  function syncViewButton() {
    var flat = MI.world.isFlatView();
    el['view-icon'].textContent = flat ? '🪐' : '🏝️';
    el['view-label'].textContent = flat ? 'planet view' : 'island view';
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
    el['view-icon'].textContent = goingFlat ? '🪐' : '🏝️';
    el['view-label'].textContent = goingFlat ? 'planet view' : 'island view';
    hideDetail();
    MI.world.setFlatView(goingFlat);
  }

  function init() {
    cacheElements();
    el['reset-btn'].addEventListener('click', handleReset);
    el['view-btn'].addEventListener('click', toggleView);

    el['submit-btn'].addEventListener('click', submitEntry);
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
