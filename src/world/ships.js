// MI.ships — the pirate fleet: which ships exist, what each one wants, and whether you have
// given it yet. Pure: no THREE, no DOM, no MI.store. It takes a world and returns facts about
// it, so `node scripts/test-ships.js` can check the whole progression without a browser.
// world.js owns the sailing (they walk water tiles through the same FSM as the pets) and
// app.js owns the moment a goal is met.
//
// The design in one line: a ship is won by WRITING, not by paying. Shards already buy pets,
// themes and skins; a ship is the one thing on this planet you cannot shop for, which is why
// it is worth having.
(function () {
  window.MI = window.MI || {};

  var MAX_SHIPS = 4;

  // Hostile hulls, and the same hull once it strikes its flag. Claiming swaps the model, so a
  // claimed ship is legible across the ocean without reading anything — and the pairs are the
  // same size, so nothing jumps.
  var HULLS = ['small', 'medium', 'large'];

  function hostileModel(hull) { return 'ship-pirate-' + hull + '.glb'; }
  function claimedModel(hull) { return 'ship-' + hull + '.glb'; }

  // What a ship asks for. Every one is something a journal keeper does anyway — the ship is a
  // reason to notice you did it. Keep them small: a demo planet has a handful of entries.
  var GOALS = [
    { id: 'voyages', target: 3, title: 'Three journeys',
      ask: 'Log 3 travel memories', unit: 'journeys' },
    { id: 'company', target: 2, title: 'Good company',
      ask: 'Write one day with 2 people in it', unit: 'people in a day' },
    { id: 'streak', target: 3, title: 'Three days running',
      ask: 'Write on 3 days in a row', unit: 'days' },
    { id: 'chronicle', target: 6, title: 'A full log',
      ask: 'Write 6 memories', unit: 'memories' },
    { id: 'crowd', target: 4, title: 'A crew',
      ask: 'Meet 4 people', unit: 'people' }
  ];

  // Ship names, picked deterministically. A ship you can name is a ship you remember.
  var NAMES = [
    'The Gull', 'Saltwhistle', 'The Long Morning', 'Petrel', 'The Wandering Hour',
    'Cormorant', 'The Tin Compass', 'Marigold', 'The Quiet Mutiny', 'Halyard',
    'The Second Tide', 'Kestrel'
  ];

  // Same mixer world.js uses, kept local so this file depends on nothing.
  function hash(n) {
    return ((n * 2654435761) >>> 0) / 4294967296;
  }

  function pick(list, n) {
    return list[Math.floor(hash(n) * list.length) % list.length];
  }

  // How many ships a world should have. They arrive as the planet grows rather than all at
  // once, so an early world has one thing to want and a late one has a horizon with sails on
  // it. `sizeIndex` is the planet's place on the growth ladder (0 = the smallest).
  function fleetSize(sizeIndex) {
    return Math.max(1, Math.min(MAX_SHIPS, 1 + (sizeIndex || 0)));
  }

  // The ship at position `index` of a world's fleet. Everything about it comes from the
  // world's own seed, so it is the same ship on every reload without being stored first
  // (CLAUDE.md: nothing is re-rolled at spawn time). `taken` skips goals and names already
  // on the water, so two ships in one fleet never ask for the same thing.
  function makeShip(seed, index, taken) {
    var n = (seed || 0) + index * 7919;
    var hull = pick(HULLS, n);
    var usedGoals = (taken && taken.goals) || [];
    var usedNames = (taken && taken.names) || [];
    var goals = GOALS.filter(function (goal) { return usedGoals.indexOf(goal.id) === -1; });
    if (!goals.length) goals = GOALS;
    var names = NAMES.filter(function (name) { return usedNames.indexOf(name) === -1; });
    if (!names.length) names = NAMES;
    return {
      id: 'ship-' + index,
      hull: hull,
      name: pick(names, n + 31),
      goal: pick(goals, n + 101).id,
      claimed: false
    };
  }

  // Brings `world.ships` up to the size the planet has earned, leaving the ships already
  // there (and their claimed flags) exactly as they are. Returns the ships it added.
  function ensureFleet(world, sizeIndex) {
    if (!world.ships) world.ships = [];
    var want = fleetSize(sizeIndex);
    var added = [];
    while (world.ships.length < want) {
      added.push(makeShip(world.seed, world.ships.length, {
        goals: world.ships.map(function (ship) { return ship.goal; }),
        names: world.ships.map(function (ship) { return ship.name; })
      }));
      world.ships.push(added[added.length - 1]);
    }
    return added;
  }

  function goalFor(ship) {
    var id = ship && ship.goal;
    for (var i = 0; i < GOALS.length; i++) if (GOALS[i].id === id) return GOALS[i];
    return GOALS[0];
  }

  // How far along this world is toward one goal. Counted from the world itself rather than
  // tallied as things happen, so it stays right however a memory got there — a demo seed, an
  // import, or an entry written three sessions ago.
  function countFor(world, goalId) {
    var memories = world.memories || [];
    if (goalId === 'voyages') {
      return memories.filter(function (m) { return m.category === 'travel'; }).length;
    }
    if (goalId === 'company') {
      // The fullest single day, not the total: this asks for one memory with company in it.
      return memories.reduce(function (most, m) {
        return Math.max(most, (m.people || []).length);
      }, 0);
    }
    if (goalId === 'streak') return (world.wallet && world.wallet.streak) || 0;
    if (goalId === 'chronicle') return memories.length;
    if (goalId === 'crowd') return (world.people || []).length;
    return 0;
  }

  // -> { done, target, complete, title, ask, unit }
  function progressFor(world, ship) {
    var goal = goalFor(ship);
    var done = Math.min(countFor(world, goal.id), goal.target);
    return {
      done: done, target: goal.target, complete: done >= goal.target,
      title: goal.title, ask: goal.ask, unit: goal.unit
    };
  }

  function find(world, shipId) {
    var ships = world.ships || [];
    for (var i = 0; i < ships.length; i++) if (ships[i].id === shipId) return ships[i];
    return null;
  }

  // Every unclaimed ship whose goal is now met — the ones waiting for the player to go and
  // take them. Claiming is deliberate rather than automatic: a ship that flips by itself while
  // you are writing is a notification, and a ship you sail over and claim is a moment.
  function claimable(world) {
    return (world.ships || []).filter(function (ship) {
      return !ship.claimed && progressFor(world, ship).complete;
    });
  }

  function claim(world, shipId) {
    var ship = find(world, shipId);
    if (!ship || ship.claimed || !progressFor(world, ship).complete) return false;
    ship.claimed = true;
    return true;
  }

  function modelFor(ship) {
    return ship.claimed ? claimedModel(ship.hull) : hostileModel(ship.hull);
  }

  MI.ships = {
    MAX_SHIPS: MAX_SHIPS,
    GOALS: GOALS,
    fleetSize: fleetSize,
    makeShip: makeShip,
    ensureFleet: ensureFleet,
    goalFor: goalFor,
    progressFor: progressFor,
    claimable: claimable,
    claim: claim,
    find: find,
    modelFor: modelFor,
    hostileModel: hostileModel,
    claimedModel: claimedModel
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = MI.ships;
})();
