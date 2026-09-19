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
      var existing = MI.store.findPerson(candidate.name);
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

  // Deterministic 0..1 from an integer — the same trick the world module uses, so nothing
  // here has to call Math.random() and a replayed world comes out identical.
  function wobbleFor(step) {
    var h = ((step * 2654435761) >>> 0) / 4294967296;
    return (h - 0.5) * 1.15; // up to about +/-33 degrees of drift per memory
  }

  // Where the next memory lands. Rather than filling outward from home as a blob, each
  // memory steps two tiles along a drifting heading, so the island grows as a meandering
  // chain — which is what gives it one main road with room for branches, instead of a web.
  function chooseSlot(world) {
    var occupied = MI.store.occupiedSlots();
    var last = world.memories[world.memories.length - 1];

    if (last && last.placement) {
      var step = MI.world.sphere.walkFrom(
        last.placement.slot, world.heading, occupied, wobbleFor(world.memories.length)
      );
      if (step) {
        world.heading = step.heading; // carry the direction to the next memory
        return { slot: step.slot, via: step.via };
      }
    }
    // First memory, or the chain painted itself into a corner: fall back to the nearest
    // free tile that isn't touching another building.
    var slot = MI.world.sphere.nextFreeSlot(occupied, world.home, MI.store.takenSlots());
    return slot === null ? null : { slot: slot, via: null };
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

    // The tile the chain stepped over comes first and is not optional — it's what keeps
    // this memory joined to the previous one by land.
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

  function addEntry(text, options) {
    var opts = options || {};
    var world = MI.store.get();

    return MI.ai.classify(text).then(function (classified) {
      var placement = chooseSlot(world);
      if (placement === null) return null; // planet full — nothing sensible to do
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
    });
  }

  // Replays everything already stored — used on page load, with no animation or camera moves.
  function restore() {
    var world = MI.store.get();
    world.landscape.forEach(function (entry) {
      MI.world.spawnLandscape(entry, { animate: false });
    });
    var spawns = world.memories.map(function (memory) {
      return MI.world.spawnMemory(memory, { animate: false });
    });
    world.people.forEach(function (person) {
      if (person.placement) spawns.push(MI.world.spawnPerson(person, { animate: false }));
    });
    return Promise.all(spawns).then(function () {
      MI.world.rebuildRoads(); // draw the network once everything is on the planet
    });
  }

  MI.app = { addEntry: addEntry, restore: restore };
})();
