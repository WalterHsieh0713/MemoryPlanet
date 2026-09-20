// MI.world.cosmetics — satellites and character skins, built from THREE primitives the same
// way world.js builds its minifigure people, so they need no asset packs and match the toy
// style. Satellites are the ones that orbit in the sky; the pets that walk on the land are
// GLB models and live in src/world/walkers.js instead.
// Pure builders: no scene state. world.js decides where they go; src/game/economy.js decides
// what they cost.
(function () {
  window.MI = window.MI || {};
  MI.world = MI.world || {};

  function mat(color, extra) {
    var options = { color: color, flatShading: true, roughness: 0.8 };
    if (extra) Object.keys(extra).forEach(function (k) { options[k] = extra[k]; });
    return new THREE.MeshStandardMaterial(options);
  }

  function add(group, geometry, material, x, y, z) {
    var mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x || 0, y || 0, z || 0);
    mesh.castShadow = true;
    group.add(mesh);
    return mesh;
  }

  function face(group, z, y, spread) {
    var eye = mat(0x2b3440);
    add(group, new THREE.SphereGeometry(0.035, 6, 4), eye, -spread, y, z);
    add(group, new THREE.SphereGeometry(0.035, 6, 4), eye, spread, y, z);
    var blush = mat(0xf7a1b5);
    add(group, new THREE.SphereGeometry(0.03, 6, 4), blush, -spread - 0.06, y - 0.06, z - 0.02);
    add(group, new THREE.SphereGeometry(0.03, 6, 4), blush, spread + 0.06, y - 0.06, z - 0.02);
  }

  // --- Satellites. Built about 1 unit long, facing +Z with +Y up; world.js scales them to the
  // planet's tile size and flies them in a loop above your island. Each may set
  // userData.tick(timeSeconds) for its own little motion.

  function moonling() {
    var sat = new THREE.Group();
    add(sat, new THREE.IcosahedronGeometry(0.42, 1), mat(0xe9e4d6));
    var crater = mat(0xc9c2b0);
    [[0.22, 0.24, 0.26], [-0.28, 0.16, 0.2], [0.3, -0.18, 0.16], [-0.12, -0.3, -0.24], [0.05, 0.36, -0.2]]
      .forEach(function (p) {
        var n = new THREE.Vector3(p[0], p[1], p[2]).normalize();
        var dent = add(sat, new THREE.CylinderGeometry(0.07, 0.07, 0.03, 8), crater);
        dent.position.copy(n.clone().multiplyScalar(0.395));
        dent.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), n);
      });
    face(sat, 0.4, 0.02, 0.11);
    sat.userData.tick = function (t) { sat.rotation.z = Math.sin(t * 1.3) * 0.12; };
    return sat;
  }

  function cloudSheep() {
    var sat = new THREE.Group();
    var wool = mat(0xfbfbf7);
    [[0, 0.02, 0, 0.26], [0.2, 0.06, -0.08, 0.2], [-0.2, 0.05, -0.06, 0.2], [0.02, 0.16, -0.16, 0.2],
      [0.1, -0.04, 0.14, 0.18], [-0.12, -0.02, 0.12, 0.18], [0, 0.02, -0.26, 0.18]]
      .forEach(function (b) { add(sat, new THREE.IcosahedronGeometry(b[3], 0), wool, b[0], b[1], b[2]); });
    var dark = mat(0x4a4f57);
    var head = new THREE.Group();
    head.position.set(0, 0.04, 0.3);
    add(head, new THREE.SphereGeometry(0.14, 8, 6), dark);
    add(head, new THREE.BoxGeometry(0.12, 0.04, 0.06), dark, -0.14, 0.04, -0.02).rotation.z = 0.5;
    add(head, new THREE.BoxGeometry(0.12, 0.04, 0.06), dark, 0.14, 0.04, -0.02).rotation.z = -0.5;
    var eye = mat(0xffffff);
    add(head, new THREE.SphereGeometry(0.03, 6, 4), eye, -0.055, 0.03, 0.12);
    add(head, new THREE.SphereGeometry(0.03, 6, 4), eye, 0.055, 0.03, 0.12);
    sat.add(head);
    var legs = [];
    [[-0.12, 0.12], [0.12, 0.12], [-0.12, -0.14], [0.12, -0.14]].forEach(function (p) {
      legs.push(add(sat, new THREE.CylinderGeometry(0.035, 0.03, 0.18, 5), dark, p[0], -0.24, p[1]));
    });
    sat.userData.tick = function (t) {
      legs.forEach(function (leg, i) { leg.rotation.x = Math.sin(t * 6 + i * Math.PI / 2) * 0.35; });
      head.rotation.y = Math.sin(t * 0.9) * 0.25;
    };
    return sat;
  }

  function skyKoi() {
    var sat = new THREE.Group();
    var white = mat(0xfff7ef), orange = mat(0xff8a3d), fin = mat(0xffb27a);
    var body = add(sat, new THREE.SphereGeometry(0.2, 10, 8), white);
    body.scale.set(1, 0.95, 2.2);
    add(sat, new THREE.SphereGeometry(0.13, 8, 6), orange, 0.06, 0.1, 0.12).scale.set(1, 0.6, 1.4);
    add(sat, new THREE.SphereGeometry(0.11, 8, 6), orange, -0.07, 0.09, -0.16).scale.set(1, 0.6, 1.3);
    var tail = new THREE.Group();
    tail.position.set(0, 0, -0.42);
    var tailFin = add(tail, new THREE.ConeGeometry(0.2, 0.34, 6), fin, 0, 0, -0.1);
    tailFin.rotation.x = -Math.PI / 2;
    tailFin.scale.set(1, 1, 0.25);
    sat.add(tail);
    [-1, 1].forEach(function (side) {
      var f = add(sat, new THREE.ConeGeometry(0.08, 0.2, 5), fin, side * 0.19, -0.05, 0.1);
      f.rotation.z = side * 1.2;
      f.scale.set(1, 1, 0.3);
    });
    var eye = mat(0x2b3440);
    add(sat, new THREE.SphereGeometry(0.03, 6, 4), eye, -0.12, 0.06, 0.34);
    add(sat, new THREE.SphereGeometry(0.03, 6, 4), eye, 0.12, 0.06, 0.34);
    sat.userData.tick = function (t) {
      tail.rotation.y = Math.sin(t * 5) * 0.45;
      sat.rotation.z = Math.sin(t * 2.5) * 0.08;
    };
    return sat;
  }

  function tinySaucer() {
    var sat = new THREE.Group();
    var spin = new THREE.Group();
    sat.add(spin);
    var hull = add(spin, new THREE.SphereGeometry(0.42, 16, 8), mat(0xc9d3e0, { metalness: 0.55, roughness: 0.35 }));
    hull.scale.set(1, 0.26, 1);
    add(spin, new THREE.SphereGeometry(0.19, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2),
      mat(0x7ff3ff, { transparent: true, opacity: 0.75, emissive: 0x1b8f99, emissiveIntensity: 0.5 }), 0, 0.06, 0);
    var colors = [0xff6b9a, 0xffe066, 0x6bf0ff];
    for (var i = 0; i < 9; i++) {
      var a = (i / 9) * Math.PI * 2;
      add(spin, new THREE.SphereGeometry(0.035, 6, 4),
        mat(colors[i % 3], { emissive: colors[i % 3], emissiveIntensity: 0.9 }),
        Math.cos(a) * 0.38, -0.02, Math.sin(a) * 0.38);
    }
    add(sat, new THREE.SphereGeometry(0.06, 6, 4), mat(0x9dff8a, { emissive: 0x3aa02a, emissiveIntensity: 0.6 }), 0, 0.27, 0);
    sat.userData.tick = function (t) {
      spin.rotation.y = t * 1.6;
      sat.rotation.x = Math.sin(t * 1.7) * 0.1;
    };
    return sat;
  }

  var SATELLITES = { moonling: moonling, 'cloud-sheep': cloudSheep, 'sky-koi': skyKoi, 'tiny-saucer': tinySaucer };

  function makeSatellite(id) {
    var build = SATELLITES[id];
    return build ? build() : null;
  }

  // --- Character skins: accessories added to world.js's minifigure (head centre y=0.66,
  // radius 0.16; body top y=0.52; legs along X). Tagged 'skin' so they can be swapped in place.

  var HAT_COLORS = [0xff6b9a, 0x6bb8ff, 0xffd166, 0x8ee07a, 0xc39bff, 0xff9f68];

  function pickFrom(list, colorHex) {
    return list[((colorHex >>> 0) % 997) % list.length];
  }

  function partyHat(group, color) {
    var hat = new THREE.Group();
    var cone = add(hat, new THREE.ConeGeometry(0.1, 0.24, 8), mat(pickFrom(HAT_COLORS, color)), 0, 0.12, 0);
    cone.castShadow = true;
    add(hat, new THREE.SphereGeometry(0.04, 6, 4), mat(0xfff3b0), 0, 0.26, 0);
    hat.position.set(0.02, 0.78, 0);
    hat.rotation.z = -0.22;
    group.add(hat);
  }

  function cozyKnits(group, color) {
    var knit = mat(pickFrom(HAT_COLORS, color + 1));
    var band = mat(0xfaf6ee);
    add(group, new THREE.SphereGeometry(0.17, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), knit, 0, 0.68, 0);
    add(group, new THREE.CylinderGeometry(0.172, 0.172, 0.05, 10), band, 0, 0.69, 0);
    add(group, new THREE.SphereGeometry(0.055, 6, 4), band, 0, 0.87, 0);
    var scarf = add(group, new THREE.TorusGeometry(0.15, 0.045, 6, 12), knit, 0, 0.53, 0);
    scarf.rotation.x = Math.PI / 2;
    add(group, new THREE.BoxGeometry(0.07, 0.17, 0.04), knit, 0.07, 0.44, 0.15);
  }

  function explorer(group) {
    var khaki = mat(0xcbb07a), strap = mat(0x6b4a2b);
    add(group, new THREE.CylinderGeometry(0.27, 0.27, 0.025, 12), khaki, 0, 0.79, 0);
    add(group, new THREE.CylinderGeometry(0.13, 0.16, 0.12, 10), khaki, 0, 0.86, 0);
    add(group, new THREE.CylinderGeometry(0.162, 0.162, 0.03, 10), strap, 0, 0.815, 0);
    add(group, new THREE.BoxGeometry(0.22, 0.24, 0.12), mat(0x8b5e3c), 0, 0.37, -0.22);
  }

  function starCrown(group) {
    var gold = mat(0xffc83d, { metalness: 0.5, roughness: 0.35, emissive: 0x5a3d00, emissiveIntensity: 0.4, side: THREE.DoubleSide });
    add(group, new THREE.CylinderGeometry(0.12, 0.12, 0.07, 10, 1, true), gold, 0, 0.83, 0);
    for (var i = 0; i < 5; i++) {
      var a = (i / 5) * Math.PI * 2;
      add(group, new THREE.ConeGeometry(0.032, 0.08, 4), gold, Math.cos(a) * 0.11, 0.9, Math.sin(a) * 0.11);
    }
    add(group, new THREE.SphereGeometry(0.03, 6, 4), mat(0xff4d6d, { emissive: 0x7a0f24, emissiveIntensity: 0.5 }), 0, 0.83, 0.12);
  }

  var SKINS = { party: partyHat, cozy: cozyKnits, explorer: explorer, crown: starCrown };

  // Replace whatever skin `person` wears with `skinId` ('classic' or unknown = bare).
  function dressPerson(person, skinId, colorHex) {
    var old = person.getObjectByName('skin');
    if (old) person.remove(old);
    var build = SKINS[skinId];
    if (!build) return;
    var outfit = new THREE.Group();
    outfit.name = 'skin';
    build(outfit, colorHex || 0);
    outfit.traverse(function (node) { if (node.isMesh) node.castShadow = true; });
    person.add(outfit);
  }

  MI.world.cosmetics = { makeSatellite: makeSatellite, dressPerson: dressPerson };
})();
