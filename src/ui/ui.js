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
      'wallet', 'wallet-count', 'shop-btn', 'shop', 'shop-close', 'shop-balance', 'shop-items']
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
      if (inUse && (kind === 'pets' || kind === 'characters')) {
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

    // The memory's toast comes from the app's 'reward' event as it lands, and a growth toast
    // from 'grew' — this only has to handle the end of the whole thing.
    MI.app.addEntry(text).then(function (memory) {
      setBusy(false);
      if (!memory) {
        toast('🌊', 'Your planet is full!', 'Every buildable tile has a memory on it.', 0, 4200);
        return;
      }
      refreshStats();
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
      if (e.key === 'Enter') submitEntry();
    });
    el['demo-btn'].addEventListener('click', loadDemoPlanet);
    el['detail-close'].addEventListener('click', hideDetail);

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
      if (e.key === 'Escape' && el.shop.classList.contains('open')) closeShop();
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

    refreshStats();
  }

  function hideLoading() {
    el.loading.classList.add('hide');
  }

  MI.ui = { init: init, refreshStats: refreshStats, hideLoading: hideLoading };
})();
