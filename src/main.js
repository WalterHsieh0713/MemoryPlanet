// Start the game only after leaving the decorative cover, avoiding two render loops.
(function () {
  var started;
  function openJournals() {
    if (started) return started;
    started = Promise.resolve().then(function () {
      MI.store.boot();
      return MI.world.init(document.getElementById('scene-canvas'), {
        frequency: MI.growth.LADDER[0],
        theme: 'meadow',
        pet: null,
        satellite: null,
        character: null,
        skin: 'classic'
      });
    }).then(function () {
      MI.ui.init();
      MI.ui.hideLoading();
      MI.ui.showGate('shelf');
    });
    return started;
  }
  MI.landing.init({ openJournals: openJournals });
  MI.auth.init({ enter: MI.landing.enter });
})();
