// MI.economy — shards: earned by journaling, spent on themes, pets, satellites and skins.
// Reads and writes the wallet/unlocks/equipped fields of the stored world (MI.store); it
// never touches the scene. Applying a purchase to the planet is MI.app.equip's job.
(function () {
  window.MI = window.MI || {};

  // Pets are the ones that walk on the land (ids match src/world/pets.js); satellites are
  // the ones that orbit in the sky (ids match src/world/cosmetics.js, as themes and skins
  // do). They are bought and equipped separately and will grow apart from here — keep new
  // kinds in whichever list matches where the thing actually lives.
  var CATALOG = {
    themes: [
      { id: 'meadow', name: 'Meadow', price: 0, icon: '🌿', blurb: 'Green hills and a bright blue sea.' },
      { id: 'frostfall', name: 'Frostfall', price: 60, icon: '❄️', blurb: 'Snowfields, frosted trees and an icy sea.' },
      { id: 'blossom', name: 'Blossom', price: 90, icon: '🌸', blurb: 'Cherry trees, raked sand and koi-pond water.' },
      { id: 'starlight', name: 'Starlight', price: 140, icon: '🌌', blurb: 'A violet world under a sky full of stars.' }
    ],
    pets: [
      { id: 'dog', name: 'Dog', price: 50, icon: '🐶', blurb: 'Trots around your island on its own four paws.' }
    ],
    satellites: [
      { id: 'moonling', name: 'Moonling', price: 40, icon: '🌙', blurb: 'A sleepy little moon that circles your island.' },
      { id: 'cloud-sheep', name: 'Cloud Sheep', price: 55, icon: '🐑', blurb: 'Fluffy, floaty, always paddling its legs.' },
      { id: 'sky-koi', name: 'Sky Koi', price: 75, icon: '🐟', blurb: 'Swims laps through the air above your roofs.' },
      { id: 'tiny-saucer', name: 'Tiny Saucer', price: 100, icon: '🛸', blurb: 'Blinking lights. Probably friendly.' }
    ],
    skins: [
      { id: 'classic', name: 'Classic', price: 0, icon: '🙂', blurb: 'Your people, just as they are.' },
      { id: 'party', name: 'Party Hats', price: 30, icon: '🥳', blurb: 'Every day is somebody’s birthday.' },
      { id: 'cozy', name: 'Cozy Knits', price: 45, icon: '🧣', blurb: 'Bobble hats and scarves for everyone.' },
      { id: 'explorer', name: 'Explorer', price: 60, icon: '🧭', blurb: 'Sun hats and backpacks, ready to roam.' },
      { id: 'crown', name: 'Star Crowns', price: 90, icon: '👑', blurb: 'Royalty, every one of them.' }
    ]
  };
  var EQUIP_KEY = { themes: 'theme', pets: 'pet', satellites: 'satellite', skins: 'skin' };
  // Kinds you are allowed to have none of. Themes and skins always have one equipped.
  var OPTIONAL = { pets: true, satellites: true };

  // Every earning rule in one place, so balancing is a one-line change.
  var REWARD = {
    memory: 10,           // every entry
    perImportance: 2,     // per importance point above 1 (a landmark day, importance 5, is +8)
    newFriend: 3,         // per person met for the first time
    firstMemory: 20,      // the very first entry on a planet
    daily: 5,             // first entry of a calendar day...
    perStreakDay: 2,      // ...plus this per consecutive day already written
    dailyCap: 20,
    growth: 25            // per size step when the planet grows (x the new size's index)
  };

  function dayKey(date) {
    var m = date.getMonth() + 1, d = date.getDate();
    return date.getFullYear() + '-' + (m < 10 ? '0' : '') + m + '-' + (d < 10 ? '0' : '') + d;
  }

  function daysBetween(fromKey, toKey) {
    var a = fromKey.split('-').map(Number), b = toKey.split('-').map(Number);
    return Math.round((Date.UTC(b[0], b[1] - 1, b[2]) - Date.UTC(a[0], a[1] - 1, a[2])) / 86400000);
  }

  function world() {
    return MI.store.get();
  }

  function balance() {
    return world().wallet.shards;
  }

  function pay(lines) {
    var wallet = world().wallet;
    var total = lines.reduce(function (sum, line) { return sum + line.amount; }, 0);
    wallet.shards += total;
    wallet.lifetime += total;
    MI.store.save();
    return { total: total, lines: lines, balance: wallet.shards };
  }

  // Pays for a memory that has just been stored. `context.newPeople`: people it introduced.
  // `now` is injectable for tests. Returns { total, lines: [{label, amount}], balance }.
  function rewardMemory(memory, context, now) {
    var w = world();
    var wallet = w.wallet;
    var lines = [{ label: 'memory', amount: REWARD.memory }];

    var bigDay = Math.max(0, (memory.importance || 1) - 1) * REWARD.perImportance;
    if (bigDay) lines.push({ label: 'big day', amount: bigDay });

    var met = (context && context.newPeople) || 0;
    if (met) lines.push({ label: met === 1 ? 'new friend' : met + ' new friends', amount: met * REWARD.newFriend });

    if (w.memories.length === 1) lines.push({ label: 'first memory', amount: REWARD.firstMemory });

    var today = dayKey(now || new Date());
    if (wallet.lastDay !== today) {
      var continued = wallet.lastDay && daysBetween(wallet.lastDay, today) === 1;
      wallet.streak = continued ? wallet.streak + 1 : 1;
      wallet.lastDay = today;
      lines.push({
        label: wallet.streak > 1 ? wallet.streak + '-day streak' : 'first today',
        amount: Math.min(REWARD.dailyCap, REWARD.daily + REWARD.perStreakDay * (wallet.streak - 1))
      });
    }
    return pay(lines);
  }

  // Paid when the planet grows; `sizeIndex` is the new size's place on the ladder (1 = second).
  function rewardGrowth(sizeIndex) {
    return pay([{ label: 'planet grew', amount: REWARD.growth * Math.max(1, sizeIndex) }]);
  }

  function find(kind, id) {
    return (CATALOG[kind] || []).filter(function (item) { return item.id === id; })[0] || null;
  }

  function owns(kind, id) {
    var list = world().unlocks[kind];
    return !!list && list.indexOf(id) !== -1;
  }

  // -> { ok: true, item } | { ok: false, reason: 'unknown' | 'short', short: shardsMissing }
  function buy(kind, id) {
    var item = find(kind, id);
    if (!item) return { ok: false, reason: 'unknown' };
    if (owns(kind, id)) return { ok: true, item: item, already: true };
    var wallet = world().wallet;
    if (wallet.shards < item.price) return { ok: false, reason: 'short', short: item.price - wallet.shards };
    wallet.shards -= item.price;
    world().unlocks[kind].push(id);
    MI.store.save();
    return { ok: true, item: item };
  }

  // `id` null puts a pet or satellite away; the two slots are independent, so putting one
  // away leaves the other where it is.
  function equip(kind, id) {
    if (id === null ? !OPTIONAL[kind] : !owns(kind, id)) return false;
    world().equipped[EQUIP_KEY[kind]] = id;
    MI.store.save();
    return true;
  }

  function equipped(kind) {
    return world().equipped[EQUIP_KEY[kind]];
  }

  MI.economy = {
    CATALOG: CATALOG,
    REWARD: REWARD,
    balance: balance,
    rewardMemory: rewardMemory,
    rewardGrowth: rewardGrowth,
    find: find,
    owns: owns,
    buy: buy,
    equip: equip,
    equipped: equipped,
    dayKey: dayKey
  };
})();
