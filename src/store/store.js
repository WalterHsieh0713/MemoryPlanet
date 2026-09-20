// MI.store — world data + persistence (owner C, per docs/CONTRACT.md).
// Placement and asset choices are persisted, never recomputed at spawn time, so a reload
// reproduces the exact same planet (CLAUDE.md: no Math.random() at spawn time).
//
// A person can keep more than one journal. The shelf lives in memory-planet.journals.v1;
// each world's full save is memory-planet.journal.<id>. The active world's v4 key is kept
// as an alias so an older build still finds the last planet it opened.
(function () {
  window.MI = window.MI || {};

  var STORAGE_KEY = 'memory-planet.world.v4';
  var LIBRARY_KEY = 'memory-planet.journals.v1';
  var JOURNAL_PREFIX = 'memory-planet.journal.';
  // Older worlds are migrated on first load, newest first. Each old copy is left where it
  // is, so an older build of the app still finds the save it expects.
  var LEGACY_KEYS = ['memory-planet.world.v3', 'memory-planet.world.v2'];
  var DEFAULT_NAME = 'My journal';
  var NAME_MAX = 32;
  var world = null;
  var library = null;

  function firstFrequency() {
    return MI.growth ? MI.growth.LADDER[0] : 2;
  }

  function emptyWorld() {
    return {
      version: 4, nextSlot: null, home: null, seed: Date.now(),
      // Set once the journal is created on the shelf. An empty ocean used as a boot backdrop
      // has neither, and save() refuses to write it over a real journal.
      id: null, name: null,
      // The direction the island is currently growing in, as a tangent vector. Persisted so
      // the chain keeps heading the same way across reloads.
      heading: null,
      memories: [], people: [],
      // Who your character is (src/world/player.js). null means the first one.
      player: { character: null },
      // The main house: the tile your character starts on, claimed at world creation so a
      // brand-new planet has somewhere to stand. { slot, asset } once MI.app.ensureHome runs.
      house: null,
      // Plain terrain seeded around memories so the island reads as a landscape with
      // buildings in it, rather than a solid block of buildings.
      landscape: [],
      // Planet size: a frequency on MI.growth.LADDER. Every slot above indexes into the grid
      // for this frequency, so it must change together with them (MI.app.growPlanet).
      planet: { frequency: firstFrequency() },
      // Progression — see src/game/economy.js.
      wallet: { shards: 0, lifetime: 0, streak: 0, lastDay: null },
      // Pets walk on the land, satellites orbit in the sky (src/game/economy.js). Separate
      // slots on purpose: a world can have one of each out at once.
      unlocks: { themes: ['meadow'], pets: [], satellites: [], skins: ['classic'] },
      equipped: { theme: 'meadow', pet: null, satellite: null, skin: 'classic' }
    };
  }

  function read(key) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null; // private mode / blocked storage / corrupt JSON
    }
  }

  function write(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      return false; // Storage full or blocked — the in-memory world still works for this session.
    }
  }

  function clampName(name) {
    return String(name || '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);
  }

  // Up to v3, the sky orbiters and the one land walker shared the 'pets' kind and a single
  // equipped slot. v4 splits them, so an older save's pets have to be sorted into the two
  // lists. Deliberately a frozen snapshot of what shipped as a land pet at v4 rather than a
  // read of MI.economy.CATALOG: a migration has to keep meaning the same thing as that
  // catalog grows, and store.js is below economy.js in the load order anyway.
  var LAND_PETS_AT_V4 = { dog: true };

  function splitPets(w) {
    var owned = w.unlocks.pets || [];
    w.unlocks.pets = owned.filter(function (id) { return LAND_PETS_AT_V4[id]; });
    w.unlocks.satellites = owned.filter(function (id) { return !LAND_PETS_AT_V4[id]; });
    // The one equipped id goes to whichever slot it belongs in; the other ends up empty.
    var was = w.equipped.pet || null;
    w.equipped.pet = LAND_PETS_AT_V4[was] ? was : null;
    w.equipped.satellite = was && !LAND_PETS_AT_V4[was] ? was : null;
  }

  // Fill anything an older save is missing, so the rest of the app can rely on the v4 shape.
  function normalize(w) {
    var fresh = emptyWorld();
    if (!w.memories) w.memories = [];
    if (!w.people) w.people = [];
    if (!w.landscape) w.landscape = []; // worlds saved before landscape existed
    if (!w.player) w.player = { character: null }; // worlds saved before the character
    if (w.house === undefined) w.house = null;
    if (!w.planet) {
      // Every v2 world was built on the original 1002-tile grid (frequency 10).
      w.planet = { frequency: w.version >= 3 ? fresh.planet.frequency : 10 };
    }
    ['wallet', 'unlocks', 'equipped'].forEach(function (key) {
      if (!w[key]) w[key] = fresh[key];
      Object.keys(fresh[key]).forEach(function (field) {
        if (w[key][field] === undefined) w[key][field] = fresh[key][field];
      });
    });
    if (!(w.version >= 4)) splitPets(w);
    w.version = 4;
    if (w.name != null) w.name = clampName(w.name) || null;
    return w;
  }

  function newId(prefix) {
    return prefix + '-' + Date.now().toString(36) + '-' + (idCounter++).toString(36);
  }
  var idCounter = 0;

  function emptyLibrary() {
    return { version: 1, currentId: null, journals: [] };
  }

  function summary(w) {
    return {
      id: w.id,
      name: w.name || DEFAULT_NAME,
      character: w.player && w.player.character || null,
      memories: (w.memories || []).length,
      people: (w.people || []).length,
      theme: w.equipped && w.equipped.theme || 'meadow',
      frequency: w.planet && w.planet.frequency || firstFrequency(),
      updatedAt: new Date().toISOString()
    };
  }

  function upsertSummary(w) {
    if (!w || !w.id) return;
    var item = summary(w);
    var found = false;
    library.journals = (library.journals || []).map(function (entry) {
      if (entry.id !== w.id) return entry;
      found = true;
      return item;
    });
    if (!found) library.journals.unshift(item);
  }

  function journalKey(id) {
    return JOURNAL_PREFIX + id;
  }

  function readJournal(id) {
    if (!id) return null;
    var saved = read(journalKey(id));
    return saved ? normalize(saved) : null;
  }

  function persistCurrent() {
    if (world && world.id) save();
  }

  function enrollWorld(w) {
    w = normalize(w);
    if (!w.id) w.id = newId('world');
    if (!w.name) w.name = DEFAULT_NAME;
    write(journalKey(w.id), w);
    library.currentId = w.id;
    upsertSummary(w);
    write(LIBRARY_KEY, library);
    write(STORAGE_KEY, w);
    return w;
  }

  function migrateLibrary() {
    library = read(LIBRARY_KEY);
    if (library && library.journals && library.journals.length) {
      library.version = 1;
      if (!Array.isArray(library.journals)) library.journals = [];
      return library;
    }
    library = emptyLibrary();
    var saved = read(STORAGE_KEY);
    var legacy = null;
    for (var i = 0; !saved && !legacy && i < LEGACY_KEYS.length; i++) legacy = read(LEGACY_KEYS[i]);
    if (saved || legacy) enrollWorld(saved || legacy);
    else write(LIBRARY_KEY, library);
    return library;
  }

  // First thing at boot: fold a lone v4/v3/v2 save onto the shelf, then leave an unsaved
  // empty ocean in memory so the gate can sit over a quiet planet without writing over it.
  function boot() {
    migrateLibrary();
    world = emptyWorld();
    return world;
  }

  function load() {
    return boot();
  }

  function save() {
    if (!world || !world.id) return;
    write(journalKey(world.id), world);
    write(STORAGE_KEY, world);
    if (!library) library = emptyLibrary();
    library.currentId = world.id;
    upsertSummary(world);
    write(LIBRARY_KEY, library);
  }

  function get() {
    return world || boot();
  }

  function listJournals() {
    if (!library) migrateLibrary();
    return (library.journals || []).slice();
  }

  function lastJournalId() {
    if (!library) migrateLibrary();
    return library.currentId || (library.journals[0] && library.journals[0].id) || null;
  }

  function currentId() {
    return world && world.id || null;
  }

  function createJournal(opts) {
    opts = opts || {};
    persistCurrent();
    world = emptyWorld();
    world.id = newId('world');
    world.name = clampName(opts.name) || DEFAULT_NAME;
    world.player = { character: opts.character || null };
    if (!library) library = emptyLibrary();
    library.currentId = world.id;
    library.journals = (library.journals || []).filter(function (j) { return j.id !== world.id; });
    library.journals.unshift(summary(world));
    save();
    return world;
  }

  function deleteJournal(id) {
    if (!id) return { ok: false };
    if (!library) migrateLibrary();
    var wasCurrent = (world && world.id === id) || library.currentId === id;
    if (!(world && world.id === id)) persistCurrent();
    try { localStorage.removeItem(journalKey(id)); } catch (e) {}
    library.journals = (library.journals || []).filter(function (j) { return j.id !== id; });
    if (library.currentId === id) {
      library.currentId = library.journals[0] && library.journals[0].id || null;
    }
    write(LIBRARY_KEY, library);
    if (world && world.id === id) {
      world = emptyWorld();
      var next = library.currentId ? readJournal(library.currentId) : null;
      if (next) write(STORAGE_KEY, next);
      else {
        try { localStorage.removeItem(STORAGE_KEY); } catch (e) {}
      }
    }
    return { ok: true, wasCurrent: wasCurrent };
  }

  // The shelf summary only carries counts. The galaxy draws each world for real, so it needs
  // the saved world itself — the one that is open lives in memory, the rest on disk.
  function journalWorld(id) {
    if (!id) return null;
    if (world && world.id === id) return world;
    return readJournal(id);
  }

  // Move a journal one place along the shelf. The galaxy lays its ring out in shelf order,
  // so this is what reordering the planets writes to.
  function reorderJournal(id, delta) {
    if (!library) migrateLibrary();
    var list = library.journals || [];
    var from = -1;
    for (var i = 0; i < list.length; i++) { if (list[i].id === id) { from = i; break; } }
    if (from < 0) return false;
    var to = from + (delta < 0 ? -1 : 1);
    if (to < 0 || to >= list.length) return false;
    var moved = list[from];
    list[from] = list[to];
    list[to] = moved;
    write(LIBRARY_KEY, library);
    return true;
  }

  function openJournal(id) {
    if (!id) return null;
    if (world && world.id === id) return world;
    persistCurrent();
    var loaded = readJournal(id);
    if (!loaded) return null;
    if (!loaded.name) loaded.name = DEFAULT_NAME;
    world = loaded;
    if (!library) library = emptyLibrary();
    library.currentId = id;
    upsertSummary(world);
    write(LIBRARY_KEY, library);
    write(STORAGE_KEY, world);
    return world;
  }

  function takenSlots() {
    var taken = new Set();
    get().memories.forEach(function (m) {
      if (m.placement && typeof m.placement.slot === 'number') taken.add(m.placement.slot);
    });
    return taken;
  }

  function addMemory(memory) {
    get().memories.push(memory);
    save();
    return memory;
  }

  function addLandscape(entry) {
    get().landscape.push(entry);
    save();
    return entry;
  }

  // Every slot the island occupies — buildings and terrain alike. Used when picking where
  // the next memory goes, so a building never lands on ground that's already dressed.
  function occupiedSlots() {
    var used = takenSlots();
    get().landscape.forEach(function (l) { used.add(l.slot); });
    return used;
  }

  // Drop someone from the world entirely. Only ever right when no memory mentions them any
  // more — a person's whole existence here is the memories they appear in.
  function removePerson(id) {
    var w = get();
    var before = w.people.length;
    w.people = w.people.filter(function (p) { return p.id !== id; });
    return w.people.length !== before;
  }

  function addPerson(person) {
    get().people.push(person);
    save();
    return person;
  }

  function findPerson(name) {
    if (!name) return null;
    var needle = String(name).trim().toLowerCase();
    var found = get().people.filter(function (p) {
      return p.name && p.name.trim().toLowerCase() === needle;
    });
    return found.length ? found[0] : null;
  }

  function findMemoryBySlot(slot) {
    var found = get().memories.filter(function (m) {
      return m.placement && m.placement.slot === slot;
    });
    return found.length ? found[0] : null;
  }

  function reset() {
    var id = world && world.id;
    var name = world && world.name;
    var character = world && world.player && world.player.character;
    world = emptyWorld();
    world.id = id || newId('world');
    world.name = name || DEFAULT_NAME;
    world.player.character = character || null;
    save();
    return world;
  }

  function exportJSON() {
    return JSON.stringify(get(), null, 2);
  }

  function importJSON(str) {
    var id = world && world.id;
    var name = world && world.name;
    var character = world && world.player && world.player.character;
    world = normalize(JSON.parse(str));
    world.id = world.id || id || newId('world');
    if (!world.name) world.name = name || DEFAULT_NAME;
    if (!world.player) world.player = { character: character || null };
    save();
    return world;
  }

  MI.store = {
    load: load,
    boot: boot,
    save: save,
    get: get,
    newId: newId,
    takenSlots: takenSlots,
    occupiedSlots: occupiedSlots,
    addMemory: addMemory,
    addLandscape: addLandscape,
    addPerson: addPerson,
    removePerson: removePerson,
    findPerson: findPerson,
    findMemoryBySlot: findMemoryBySlot,
    reset: reset,
    exportJSON: exportJSON,
    importJSON: importJSON,
    listJournals: listJournals,
    lastJournalId: lastJournalId,
    currentId: currentId,
    createJournal: createJournal,
    openJournal: openJournal,
    deleteJournal: deleteJournal,
    journalWorld: journalWorld,
    reorderJournal: reorderJournal,
    DEFAULT_NAME: DEFAULT_NAME,
    NAME_MAX: NAME_MAX
  };
})();
