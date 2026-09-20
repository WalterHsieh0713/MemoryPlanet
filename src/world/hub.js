// MI.world.hub — who stands in the friend hub, and the plaza they stand on.
// Pure data + math (no THREE, no DOM): node scripts/test-hub.js.
//
// The hub is a dressing-room and a people-yard. Every Mini Character look stands on the
// plaza; walking up and clicking one either takes a free look or swaps with the friend
// already wearing it. Layout is a hex disk (house in the middle, looks on the outer ring)
// so world.js can build the 3D scene from cells and spots without inventing positions.
(function () {
  var root = typeof window !== 'undefined' ? window : globalThis;
  root.MI = root.MI || {};
  root.MI.world = root.MI.world || {};

  // Same axial basis as src/world/island.js, so a cell here lands on the same XZ as an
  // island cell with the same (i, j). Ring 0 is the house, ring 1 the path around it,
  // ring 2 the twelve looks (one per Kenney Mini Character).
  var DIRS = [[1, 0], [0, 1], [-1, 1], [-1, 0], [0, -1], [1, -1]];
  var PLAZA_RING = 2;

  function looks() {
    return (MI.world.player && MI.world.player.looks)
      ? MI.world.player.looks()
      : (MI.world.player ? MI.world.player.list() : []);
  }

  function getLook(id) {
    var list = looks();
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  function lookForModel(model) {
    var list = looks();
    for (var i = 0; i < list.length; i++) if (list[i].model === model) return list[i];
    return null;
  }

  function playerLook(world) {
    var id = world && world.player && world.player.character;
    return getLook(id) || looks()[0] || null;
  }

  function occupantFor(people, model) {
    if (!people || !model) return null;
    for (var i = 0; i < people.length; i++) {
      var person = people[i];
      var worn = MI.world.walkers && MI.world.walkers.residentModelFor
        ? MI.world.walkers.residentModelFor(person)
        : (person.appearance && person.appearance.model);
      if (worn === model) return person;
    }
    return null;
  }

  function memoryTitles(world, person, limit) {
    if (!world || !person) return [];
    var ids = person.memoryIds || [];
    var cap = limit || 3;
    var out = [];
    (world.memories || []).forEach(function (m) {
      if (out.length >= cap) return;
      var tagged = m.people && m.people.indexOf(person.id) !== -1;
      var listed = ids.indexOf(m.id) !== -1;
      if (tagged || listed) out.push(m.title || m.text || '');
    });
    return out;
  }

  // What clicking a look on the plaza should show, and whether Swap is on.
  function inspect(world, lookId) {
    var look = getLook(lookId);
    if (!look) return null;
    var yours = playerLook(world);
    var you = !!(yours && yours.id === look.id);
    var person = occupantFor(world && world.people, look.model);
    return {
      look: look,
      you: you,
      person: person,
      titles: person ? memoryTitles(world, person, 3) : [],
      canSwap: !you
    };
  }

  // Mutates `world`. Free look: you take it. Taken look: you and that person trade models.
  function swap(world, lookId) {
    var look = getLook(lookId);
    var yours = playerLook(world);
    if (!look || !yours) return { ok: false, reason: 'unknown' };
    if (look.id === yours.id) return { ok: false, reason: 'same' };
    world.player = world.player || {};
    var person = occupantFor(world.people, look.model);
    world.player.character = look.id;
    if (person) {
      person.appearance = person.appearance || {};
      person.appearance.model = yours.model;
    }
    return { ok: true, playerCharacter: look.id, person: person || null, look: look };
  }

  function plazaCells() {
    var cells = [{ i: 0, j: 0, ring: 0 }];
    for (var r = 1; r <= PLAZA_RING; r++) {
      var i = DIRS[4][0] * r;
      var j = DIRS[4][1] * r;
      for (var d = 0; d < 6; d++) {
        for (var s = 0; s < r; s++) {
          cells.push({ i: i, j: j, ring: r });
          i += DIRS[d][0];
          j += DIRS[d][1];
        }
      }
    }
    return cells;
  }

  function toXZ(cell, spacing) {
    return MI.island.toXZ(cell, spacing);
  }

  // One spot per look, on the outer ring, facing the house. Deterministic order.
  function figureSpots(count, spacing) {
    var outer = plazaCells().filter(function (c) { return c.ring === PLAZA_RING; });
    outer.sort(function (a, b) {
      var pa = toXZ(a, 1), pb = toXZ(b, 1);
      return Math.atan2(pa.x, pa.z) - Math.atan2(pb.x, pb.z);
    });
    var n = Math.min(count, outer.length);
    var spots = [];
    for (var i = 0; i < n; i++) {
      var xz = toXZ(outer[i], spacing);
      spots.push({
        x: xz.x,
        z: xz.z,
        yaw: Math.atan2(-xz.x, -xz.z),
        i: outer[i].i,
        j: outer[i].j
      });
    }
    return spots;
  }

  // South of the house on ring 1, facing in, so the first thing you see is the gathering house.
  function playerStart(spacing) {
    var cell = { i: 0, j: -1 };
    var xz = toXZ(cell, spacing);
    return { x: xz.x, z: xz.z, heading: Math.atan2(-xz.x, -xz.z) };
  }

  root.MI.world.hub = {
    looks: looks,
    getLook: getLook,
    lookForModel: lookForModel,
    inspect: inspect,
    swap: swap,
    occupantFor: occupantFor,
    plazaCells: plazaCells,
    figureSpots: figureSpots,
    playerStart: playerStart,
    PLAZA_RING: PLAZA_RING
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = root.MI.world.hub;
})();
