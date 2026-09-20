// Boot sequence: quiet ocean first, then the journal shelf. A world is only replayed
// once someone opens a journal they already keep, or names a new one.
(function () {
  var canvas = document.getElementById('scene-canvas');

  MI.store.boot();
  MI.world.init(canvas, {
    frequency: MI.growth.LADDER[0],
    theme: 'meadow',
    pet: null,
    satellite: null,
    character: null,
    skin: 'classic'
  })
    .then(function () {
      MI.ui.init();
      MI.ui.hideLoading();
      MI.ui.showGate();
    })
    .catch(function (err) {
      console.error('[main] failed to start', err);
      var loading = document.getElementById('loading');
      if (loading) loading.textContent = 'Could not load the planet — check the console.';
    });
})();
