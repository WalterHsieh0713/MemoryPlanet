// Boot sequence: load the saved world, build the scene, replay what's already there.
(function () {
  var canvas = document.getElementById('scene-canvas');

  var saved = MI.store.load();
  MI.world.init(canvas, {
    frequency: saved.planet.frequency,
    theme: saved.equipped.theme,
    pet: saved.equipped.pet,
    satellite: saved.equipped.satellite,
    skin: saved.equipped.skin
  })
    .then(function () {
      MI.ui.init();
      return MI.app.restore();
    })
    .then(function () {
      var world = MI.store.get();
      if (world.home !== null && world.home !== undefined) {
        MI.world.focus(world.home, { instant: true });
      }
      MI.ui.refreshStats();
      MI.ui.hideLoading();
    })
    .catch(function (err) {
      console.error('[main] failed to start', err);
      var loading = document.getElementById('loading');
      if (loading) loading.textContent = 'Could not load the planet — check the console.';
    });
})();
