// MI.app — orchestration (owner D, per docs/CONTRACT.md).
// addEntry is the one path that turns text into a thing on the planet:
// classify -> resolve/create people -> assign slot/asset/placement -> store -> spawn -> focus.
(function () {
  window.MI = window.MI || {};

  function nowISO() {
    return new Date().toISOString();
  }

  // Everything random-ish is decided ONCE here and persisted on the record, so replaying a
  // stored world reproduces it exactly instead of re-rolling (CLAUDE.md).
  function makePlacement(slot, seed) {
    return {
      slot: slot,
      dir: MI.world.sphere.slotToDir(slot),
      rotY: (seed % 6) * (Math.PI / 3), // snap to hex symmetry so buildings sit square on tiles
      scale: 1
    };
  }

  function resolvePeople(classified, memoryId) {
    var world = MI.store.get();
    var ids = [];
    var created = [];

    (classified.people || []).forEach(function (candidate) {
      // A candidate picked from the tag row carries the person it means, so there is nothing
      // to match on and no chance of two Sams. A typed name still falls back to the name.
      var existing = candidate.personId
        ? world.people.filter(function (p) { return p.id === candidate.personId; })[0]
        : MI.store.findPerson(candidate.name);
      if (existing) {
        if (existing.memoryIds.indexOf(memoryId) === -1) existing.memoryIds.push(memoryId);
        ids.push(existing.id);
        return;
      }
      var person = {
        id: MI.store.newId('person'),
        name: candidate.name,
        relationship: candidate.relationship || 'friend',
        memoryIds: [memoryId],
        firstMemoryId: memoryId,
        appearance: { color: MI.world.personColor(world.people.length) },
        placement: null // filled in below, once the memory's slot is known
      };
      MI.store.addPerson(person);
      created.push(person);
      ids.push(person.id);
    });

    return { ids: ids, created: created };
  }

  // Where the next memory lands: the free tile nearest home that joins the existing land and
  // touches no other building (the house included), so the land grows as a compact blob with
  // terrain or road between buildings (MI.placement.choose, node scripts/test-placement.js).
  function chooseSlot(world) {
    var buildings = new Set(MI.store.takenSlots());
    if (world.house && typeof world.house.slot === 'number') buildings.add(world.house.slot);
    var found = MI.placement.choose(MI.world.currentTiles(), {
      home: world.home,
      buildings: buildings,
      land: MI.growth.landSlots(world),
      taken: MI.store.occupiedSlots(),
      count: world.memories.length
    });
    return found === null ? null : { slot: found.slot, via: found.via };
  }

  // Dress a few tiles around a new memory so the island grows as a landscape with the
  // building as its landmark. Choices are made once and persisted — replaying a saved
  // world must reproduce the same island, so nothing here may re-roll at spawn time.
  function seedLandscape(memory, via) {
    var slot = memory.placement.slot;
    var tile = MI.world.sphere.tile(slot);
    if (!tile) return [];

    var occupied = MI.store.occupiedSlots();
    var wanted = MI.world.landscapeCountFor(memory.importance, slot);
    var created = [];

    // When the building could not be placed beside existing land (the first memory beside
    // the house, or a nearly full planet), the tile placement picked to join it comes first
    // and is not optional, or the island would split.
    if (via !== null && via !== undefined && !occupied.has(via)) {
      var bridgeTile = MI.world.sphere.tile(via);
      if (bridgeTile && bridgeTile.sides === 6) {
        var link = {
          slot: via,
          asset: MI.world.pickTerrainFor(memory.category, memory.importance, slot, 0),
          fromMemoryId: memory.id
        };
        MI.store.addLandscape(link);
        occupied.add(via);
        created.push(link);
      }
    }

    // Walk the neighbours in their stored cyclic order, offset by the slot, so different
    // memories spread in different directions without needing randomness.
    var start = slot % tile.sides;
    for (var step = 0; step < tile.sides && created.length < wanted; step++) {
      var neighborId = tile.neighbors[(start + step) % tile.sides];
      var neighbor = MI.world.sphere.tile(neighborId);
      if (!neighbor || neighbor.sides === 5) continue; // pentagons stay water
      if (occupied.has(neighborId)) continue;

      var entry = {
        slot: neighborId,
        asset: MI.world.pickTerrainFor(memory.category, memory.importance, slot, created.length),
        fromMemoryId: memory.id
      };
      MI.store.addLandscape(entry);
      occupied.add(neighborId);
      created.push(entry);
    }
    return created;
  }

  // --- Progress events (shards earned, planet grew) for the UI -------------------------
  var listeners = [];
  function onEvent(cb) { listeners.push(cb); }
  function emit(event) { listeners.forEach(function (cb) { cb(event); }); }

  function currentFrequency() {
    return MI.store.get().planet.frequency;
  }

  function wait(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  // The planet grows when enough of it is land (MI.growth.shouldGrow). Before growing it
  // gets a beat to finish building the new memory, so you see it land first.
  // What the memory is actually filed as. The tag row beside the entry box wins wherever the
  // writer touched it; the keyword guess only fills the gaps. No network, so this can never
  // hang or need a key.
  function fieldsFor(text, tags) {
    var guess = MI.ai.guess(text);
    if (!tags) return guess;
    return {
      title: guess.title,
      category: tags.category || guess.category,
      mood: tags.mood || guess.mood,
      people: tags.people && tags.people.length ? tags.people : guess.people,
      importance: tags.importance || guess.importance
    };
  }

  function addEntry(text, options) {
    var opts = options || {};
    var animated = opts.animate !== false;

    return Promise.resolve(fieldsFor(text, opts.tags)).then(function (classified) {
      var placement = chooseSlot(MI.store.get());
      if (placement !== null) return placeMemory(text, classified, placement, opts);
      // Out of room before the planet had a chance to grow — grow first, then place.
      if (MI.growth.nextFrequency(currentFrequency()) === null) return null; // truly full
      return growPlanet({ animate: animated }).then(function () {
        var retry = chooseSlot(MI.store.get());
        return retry === null ? null : placeMemory(text, classified, retry, opts);
      });
    }).then(function (memory) {
      if (!memory) return memory;
      if (!MI.growth.shouldGrow(MI.store.get(), MI.world.currentTiles(), currentFrequency())) return memory;
      return wait(animated ? 1800 : 0)
        .then(function () { return growPlanet({ animate: animated, focus: opts.focus !== false ? memory : null }); })
        .then(function () { return memory; });
    });
  }

  // Writing and editing read the tag row differently, and it matters for exactly one field.
  // When you write, an empty who row means "you didn't say", so the keyword guess fills it
  // in. When you EDIT, an empty who row means "nobody was there" — you just took the last
  // chip off. Falling back to the guess there would read the name straight back out of the
  // sentence and the person would never leave.
  function fieldsForEdit(text, tags) {
    var guess = MI.ai.guess(text);
    if (!tags) return guess;
    return {
      title: guess.title,
      category: tags.category || guess.category,
      mood: tags.mood || guess.mood,
      people: tags.people || guess.people,
      importance: tags.importance || guess.importance
    };
  }

  // --- Editing a memory ---------------------------------------------------------------
  // Rewriting an entry has to keep the world honest about what is now written down. The
  // rules here are all the same rule: the planet shows what the journal says, so anything
  // derived from the entry follows the entry, and anything you chose by hand is yours and
  // is left alone.

  // Was this title just the opening sentence, or did someone rename it? A derived title
  // should follow the text; a chosen one should not be thrown away.
  function titleWasDerived(memory) {
    if (!memory.text) return true;
    return memory.title === MI.ai.guess(memory.text).title;
  }

  // Likewise for the building: a swap made in the detail card is a choice, and only an
  // untouched auto-pick should follow the category. A hand-picked building that the new
  // category has no room for is re-picked anyway — the swap row could not offer it back.
  function assetFor(memory, oldCategory, newCategory) {
    var current = memory.asset && memory.asset.key;
    var slot = memory.placement.slot;
    var wasAuto = current === MI.world.pickAssetFor(oldCategory, slot).key;
    var stillOffered = MI.world.buildingsFor(newCategory).indexOf(current) !== -1;
    if (wasAuto || !stillOffered) return MI.world.pickAssetFor(newCategory, slot);
    return memory.asset;
  }

  // Everyone this memory still mentions, matched the same way writing one does: a chip from
  // the tag row carries its person, a typed name falls back to matching on the name.
  function peopleForEdit(candidates, memory) {
    var world = MI.store.get();
    var ids = [];
    var created = [];
    (candidates || []).forEach(function (candidate) {
      var existing = candidate.personId
        ? world.people.filter(function (p) { return p.id === candidate.personId; })[0]
        : MI.store.findPerson(candidate.name);
      if (existing) {
        if (ids.indexOf(existing.id) === -1) ids.push(existing.id);
        return;
      }
      var person = {
        id: MI.store.newId('person'),
        name: candidate.name,
        relationship: candidate.relationship || 'friend',
        memoryIds: [],
        firstMemoryId: memory.id,
        appearance: { color: MI.world.personColor(world.people.length + created.length) },
        // Someone introduced by an edit stands where that memory stands, exactly as they
        // would have if they had been named when it was written.
        placement: { slot: memory.placement.slot, dir: memory.placement.dir, rotY: memory.placement.rotY }
      };
      MI.store.addPerson(person);
      created.push(person);
      ids.push(person.id);
    });
    return { ids: ids, created: created };
  }

  // Re-file everyone's memory list around this edit, and decide who is left standing.
  function refilePeople(memory, nextIds) {
    var world = MI.store.get();
    var previous = (memory.people || []).slice();
    var departed = [];

    world.people.forEach(function (person) {
      var mentioned = nextIds.indexOf(person.id) !== -1;
      var listed = person.memoryIds.indexOf(memory.id) !== -1;
      if (mentioned && !listed) person.memoryIds.push(memory.id);
      if (!mentioned && listed) {
        person.memoryIds = person.memoryIds.filter(function (id) { return id !== memory.id; });
      }
    });

    previous.forEach(function (id) {
      if (nextIds.indexOf(id) !== -1) return;
      var person = world.people.filter(function (p) { return p.id === id; })[0];
      if (!person) return;
      if (person.memoryIds.length === 0) {
        // The only memory that ever mentioned them just stopped doing so. Nobody has
        // written about this person, so there is no one for the planet to show.
        MI.store.removePerson(person.id);
        MI.world.despawnPerson(person.id);
        departed.push(person);
        return;
      }
      if (person.firstMemoryId === memory.id) {
        // They were introduced here but are still in other memories. Move them on to the
        // earliest one that does still mention them, so they are not left standing beside
        // an entry they have been written out of.
        var order = {};
        world.memories.forEach(function (m, i) { order[m.id] = i; });
        var stillIn = person.memoryIds.slice().sort(function (a, b) {
          return (order[a] === undefined ? 1e9 : order[a]) - (order[b] === undefined ? 1e9 : order[b]);
        });
        var home = world.memories.filter(function (m) { return m.id === stillIn[0]; })[0];
        person.firstMemoryId = stillIn[0];
        if (home && home.placement) {
          person.placement = { slot: home.placement.slot, dir: home.placement.dir, rotY: home.placement.rotY };
          MI.world.spawnPerson(person, { animate: false });
        }
      }
    });
    return departed;
  }

  function updateEntry(memoryId, text, options) {
    var opts = options || {};
    var world = MI.store.get();
    var memory = world.memories.filter(function (m) { return m.id === memoryId; })[0];
    if (!memory) return Promise.resolve(null);
    var clean = (text || '').trim();
    if (!clean) return Promise.resolve(null);

    var classified = fieldsForEdit(clean, opts.tags);
    var retitle = titleWasDerived(memory);
    var oldCategory = memory.category;
    var oldAsset = memory.asset && memory.asset.key;

    var resolved = peopleForEdit(classified.people, memory);
    var departed = refilePeople(memory, resolved.ids);

    memory.text = clean;
    if (retitle) memory.title = classified.title;
    memory.category = classified.category;
    memory.mood = classified.mood;
    memory.importance = classified.importance;
    memory.people = resolved.ids;
    memory.asset = assetFor(memory, oldCategory, memory.category);
    memory.editedAt = nowISO();
    MI.store.save();

    var jobs = [];
    // The building only goes up again if it actually changed — a swap animation for an edit
    // that only fixed a typo would be noise.
    if ((memory.asset && memory.asset.key) !== oldAsset) jobs.push(MI.world.respawnMemory(memory));
    resolved.created.forEach(function (person) {
      jobs.push(MI.world.spawnPerson(person, { animate: opts.animate !== false }));
    });

    return Promise.all(jobs).then(function () {
      // Editing never pays: shards are for writing something down, not for going back over
      // it. `departed` and `arrived` let the UI say what quietly changed on the planet.
      emit({ type: 'edited', memory: memory, departed: departed, arrived: resolved.created });
      return { memory: memory, departed: departed, arrived: resolved.created };
    });
  }

  function placeMemory(text, classified, placement, opts) {
    var world = MI.store.get();
    var slot = placement.slot;

    if (world.home === null || world.home === undefined) {
      world.home = slot; // first memory anchors where the continent grows from
    }

    var memoryId = MI.store.newId('memory');
    var seed = world.memories.length + 1;
    var people = resolvePeople(classified, memoryId);

    var memory = {
      id: memoryId,
      createdAt: nowISO(),
      occurredOn: opts.occurredOn || nowISO().slice(0, 10),
      text: text,
      title: classified.title,
      category: classified.category,
      mood: classified.mood,
      people: people.ids,
      importance: classified.importance,
      placement: makePlacement(slot, seed),
      asset: MI.world.pickAssetFor(classified.category, slot),
      source: opts.source || 'user'
    };

    // New people stand on the tile of the memory that introduced them.
    people.created.forEach(function (person) {
      person.placement = { slot: slot, dir: memory.placement.dir, rotY: memory.placement.rotY };
    });

    MI.store.addMemory(memory);
    var seeded = seedLandscape(memory, placement.via);
    MI.store.save();
    emit({ type: 'reward', memory: memory,
      reward: MI.economy.rewardMemory(memory, { newPeople: people.created.length }) });

    var spawns = [MI.world.spawnMemory(memory, { animate: opts.animate !== false })];
    seeded.forEach(function (entry) {
      MI.world.spawnLandscape(entry, { animate: opts.animate !== false });
    });
    people.created.forEach(function (person) {
      spawns.push(MI.world.spawnPerson(person, { animate: opts.animate !== false }));
    });

    return Promise.all(spawns).then(function () {
      if (opts.focus !== false) MI.world.focus(slot, { instant: opts.instant === true });
      return memory;
    });
  }

  // Replays everything already stored — used on page load, with no animation or camera moves.
  // The main house. A brand-new planet is all ocean, so your character would have nowhere
  // to stand: this claims one hexagon up front, as land with a house on it, and points
  // `home` at it. Worlds that already have a home (their first memory set it) are left
  // alone, so this never moves an existing island.
  var HOUSE_ASSET = 'building-house.glb';

  function ensureHome() {
    var world = MI.store.get();
    if (world.home !== null && world.home !== undefined) return false;
    var slot = MI.world.sphere.firstHexagon();
    if (typeof slot !== 'number') return false;
    world.home = slot;
    // Terrain first, so the tile is raised out of the sea and themed like any other land.
    MI.store.addLandscape({ slot: slot, asset: 'grass.glb', fromMemoryId: null, source: 'home' });
    world.house = { slot: slot, asset: HOUSE_ASSET };
    MI.store.save();
    return true;
  }

  function restore() {
    ensureHome();
    var world = MI.store.get();
    world.landscape.forEach(function (entry) {
      MI.world.spawnLandscape(entry, { animate: false });
    });
    var spawns = world.memories.map(function (memory) {
      return MI.world.spawnMemory(memory, { animate: false });
    });
    if (world.house) spawns.push(MI.world.spawnHouse(world.house, { animate: false }));
    world.people.forEach(function (person) {
      if (person.placement) spawns.push(MI.world.spawnPerson(person, { animate: false }));
    });
    return Promise.all(spawns).then(function () {
      MI.world.rebuildRoads(); // draw the network once everything is on the planet
    });
  }

  // One size up the ladder: carry every saved slot onto the bigger grid (MI.growth.remap),
  // swap the planet, and replay the world on it. Slots and planet.frequency are saved
  // together, so a reload mid-way can't pair old slots with the new grid.
  // options: { animate, focus: memory to look at afterwards }
  function growPlanet(options) {
    var opts = options || {};
    var world = MI.store.get();
    var from = currentFrequency();
    var to = MI.growth.nextFrequency(from);
    if (to === null) return Promise.resolve(false);
    var oldTiles = MI.world.currentTiles();
    var tileCount = 0;

    // Growing is a planet moment — leave the flat map so you can watch it.
    var ready = MI.world.isFlatView() ? MI.world.setFlatView(false) : Promise.resolve();
    return ready.then(function () {
      return MI.world.loadGrid(to);
    }).then(function (grid) {
      tileCount = grid.tiles.length;
      MI.growth.remap(world, oldTiles, grid.tiles, from, to);
      world.planet.frequency = to;
      MI.store.save();
      return MI.world.setPlanet(to, { animate: opts.animate !== false });
    }).then(restore).then(function () {
      if (opts.focus && opts.focus.placement) MI.world.focus(opts.focus.placement.slot);
      emit({
        type: 'grew', from: from, to: to, tiles: tileCount,
        size: MI.growth.tierIndex(to) + 1, sizes: MI.growth.LADDER.length,
        reward: MI.economy.rewardGrowth(MI.growth.tierIndex(to))
      });
      return true;
    });
  }

  // Unlock-aware equip: records it (MI.economy) and shows it on the planet.
  function equip(kind, id) {
    if (!MI.economy.equip(kind, id)) return false;
    if (kind === 'themes') MI.world.setTheme(id);
    else if (kind === 'pets') MI.world.setPet(id);
    else if (kind === 'satellites') MI.world.setSatellite(id);
    else if (kind === 'skins') MI.world.setSkin(id);
    return true;
  }

  // Replay a stored world onto the scene: swap the grid, cosmetics and character, then
  // restore everything that stands on it. Used after start-over and when opening a journal.
  function rebuildScene(opts) {
    opts = opts || {};
    var world = MI.store.get();
    var ready = Promise.resolve();
    if (MI.world.isGroundView()) ready = Promise.resolve(MI.world.setGroundView(false));
    return ready.then(function () {
      return MI.world.isFlatView() ? MI.world.setFlatView(false, { instant: true }) : Promise.resolve();
    }).then(function () {
      return MI.world.setPlanet(world.planet.frequency, {
        animate: false,
        keepCamera: !!opts.keepCamera
      });
    }).then(function () {
      MI.world.setTheme(world.equipped.theme);
      MI.world.setPet(world.equipped.pet);
      MI.world.setSatellite(world.equipped.satellite);
      MI.world.setSkin(world.equipped.skin);
      // A wiped or brand-new world is all ocean, so claim the home tile and put the house
      // back on it before anything is replayed — without this a started-over planet came
      // back empty and your character had nowhere to stand until the next reload, which is
      // when restore() would have called ensureHome.
      ensureHome();
      return MI.world.setCharacter(world.player && world.player.character);
    }).then(restore).then(function () {
      if (opts.keepCamera) return;
      if (world.home !== null && world.home !== undefined) {
        MI.world.focus(world.home, { instant: true });
      }
    });
  }

  function enterJournal(id, opts) {
    if (!MI.store.openJournal(id)) return Promise.resolve(false);
    return rebuildScene(opts).then(function () { return true; });
  }

  function createJournal(opts) {
    opts = opts || {};
    MI.store.createJournal(opts);
    return rebuildScene({ keepCamera: !!opts.keepCamera }).then(function () { return true; });
  }

  // Wipe this journal's memories, shards and unlocks — back to the smallest planet.
  // The journal's name and character stay; it is still the same book.
  function startOver() {
    MI.store.reset();
    return rebuildScene();
  }

  MI.app = {
    addEntry: addEntry, updateEntry: updateEntry, restore: restore, growPlanet: growPlanet,
    equip: equip, startOver: startOver, onEvent: onEvent, ensureHome: ensureHome,
    rebuildScene: rebuildScene, enterJournal: enterJournal, createJournal: createJournal
  };
})();
