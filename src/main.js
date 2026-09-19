// SMOKE TEST ONLY — proves the split pipeline works (three r128 + vendor GLTFLoader +
// GLB loaded from assets/ with its relative Textures/colormap.png). Replace with the real
// boot sequence (MI.world.init, store.load, spawn) once modules exist.
(function () {
  var canvas = document.getElementById('scene-canvas');
  var status = document.getElementById('status');
  var renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  var scene = new THREE.Scene();
  scene.background = new THREE.Color(0xdff1f7);
  var camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.1, 100);
  camera.position.set(3, 3, 5);
  camera.lookAt(0, 1, 0);
  scene.add(new THREE.HemisphereLight(0xcfe9f5, 0x6f9c5e, 1.1));
  var sun = new THREE.DirectionalLight(0xfff1d6, 1.1);
  sun.position.set(4, 8, 5);
  scene.add(sun);

  new THREE.GLTFLoader().load('assets/kenney-city-commercial/building-skyscraper-c.glb', function (gltf) {
    scene.add(gltf.scene);
    status.textContent = 'OK: GLB + colormap loaded from assets/';
  }, undefined, function (err) {
    status.textContent = 'FAILED to load GLB: ' + (err && err.message ? err.message : err);
  });

  (function loop() {
    requestAnimationFrame(loop);
    scene.rotation.y += 0.005;
    renderer.render(scene, camera);
  })();
})();
