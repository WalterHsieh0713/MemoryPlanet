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
      'reset-btn', 'view-btn', 'view-icon', 'view-label', 'detail-swaps']
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
  }

  function showToast(memory) {
    var flavor = CATEGORY_FLAVOR[memory.category] || CATEGORY_FLAVOR.other;
    el['toast-emoji'].textContent = flavor.emoji;
    el['toast-headline'].textContent = flavor.line;
    el['toast-sub'].textContent = memory.title;
    el.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.toast.classList.remove('show'); }, 3200);
  }

  function formatDate(iso) {
    try {
      return new Date(iso).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
    } catch (e) {
      return iso;
    }
  }

  function showDetail(memory) {
    var world = MI.store.get();
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

  function hideDetail() {
    el.detail.classList.remove('show');
  }

  function setBusy(busy) {
    el['submit-btn'].disabled = busy;
    el['submit-btn'].textContent = busy ? '·' : '→';
  }

  function submitEntry() {
    var text = el['entry-input'].value.trim();
    if (!text) return;
    setBusy(true);
    el['entry-input'].value = '';
    hideDetail();

    MI.app.addEntry(text).then(function (memory) {
      setBusy(false);
      if (!memory) {
        el['toast-emoji'].textContent = '🌊';
        el['toast-headline'].textContent = 'Your planet is full!';
        el['toast-sub'].textContent = 'Every buildable tile has a memory on it.';
        el.toast.classList.add('show');
        return;
      }
      refreshStats();
      showToast(memory);
    }, function (err) {
      setBusy(false);
      console.error('[MI.ui] addEntry failed', err);
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
    MI.store.reset();
    // Nothing left to lay out flat, and nothing worth animating on the way out.
    if (MI.world.isFlatView()) MI.world.setFlatView(false, { instant: true });
    MI.world.clear();
    el['view-icon'].textContent = '🗺';
    el['view-label'].textContent = 'see your land flat';
    hideDetail();
    el.toast.classList.remove('show');
    refreshStats();
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
    el['view-icon'].textContent = goingFlat ? '🪐' : '🗺';
    el['view-label'].textContent = goingFlat ? 'back to the planet' : 'see your land flat';
    hideDetail();
    MI.world.setFlatView(goingFlat);
  }

  function init() {
    cacheElements();
    el['reset-btn'].addEventListener('click', handleReset);
    el['view-btn'].addEventListener('click', toggleView);

    el['submit-btn'].addEventListener('click', submitEntry);
    el['entry-input'].addEventListener('keydown', function (e) {
      if (e.key === 'Enter') submitEntry();
    });
    el['demo-btn'].addEventListener('click', loadDemoPlanet);
    el['detail-close'].addEventListener('click', hideDetail);

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

    refreshStats();
  }

  function hideLoading() {
    el.loading.classList.add('hide');
  }

  MI.ui = { init: init, refreshStats: refreshStats, hideLoading: hideLoading };
})();
