// One private library snapshot per account. Local saves stay synchronous; cloud
// writes are debounced, serialized, and checked against the last server revision.
(function () {
  var client, userId, metaKey, unsubscribe, timer, pending;
  var revision = 0, dirty = false, conflict = false, sequence = 0;
  var deviceSaved = true;
  var state = { kind: 'guest', message: 'Saved on this device' };
  var listeners = [];

  function emit(kind, message) {
    state = { kind: kind, message: message };
    listeners.forEach(function (fn) { fn(state); });
  }
  function metadata() {
    try { localStorage.setItem(metaKey, JSON.stringify({ revision: revision, dirty: dirty })); }
    catch (_) { deviceSaved = false; }
  }
  function disconnect() {
    clearTimeout(timer);
    if (unsubscribe) unsubscribe();
    unsubscribe = null;
    userId = null;
  }
  function changed(persisted) {
    if (persisted === false) deviceSaved = false;
    dirty = true;
    sequence++;
    metadata();
    if (conflict) return;
    emit('pending', 'Saving your journals…');
    clearTimeout(timer);
    timer = setTimeout(function () { flush().catch(function () {}); }, 800);
  }
  function flush() {
    clearTimeout(timer);
    if (pending) return pending.then(function () { return dirty ? flush() : undefined; });
    if (!userId || !dirty) return Promise.resolve();
    if (conflict) return Promise.reject(new Error('A newer cloud save needs your attention.'));
    var owner = userId, sent = sequence;
    var snapshot = MI.store.exportLibrary();
    emit('pending', 'Saving your journals…');
    pending = Promise.resolve(client.rpc('save_memory_planet', {
      expected_revision: revision, new_snapshot: snapshot
    })).then(function (result) {
      if (result.error) throw result.error;
      if (owner !== userId) return;
      revision = Number(result.data);
      dirty = sent !== sequence;
      metadata();
      emit(dirty ? 'pending' : 'saved', dirty ? 'Saving your journals…' : 'Saved to your account');
    }).catch(function (err) {
      if (owner === userId) {
        conflict = err.code === '40001';
        emit(conflict ? 'conflict' : 'error', conflict
          ? 'Another device saved changes. Your edits are kept on this device.'
          : deviceSaved ? 'Cloud save failed. Your edits are kept on this device; retry when connected.'
          : 'Cloud and device saves failed. Keep this page open and download a device backup.');
      }
      throw err;
    }).finally(function () { pending = null; });
    return pending.then(function () { return dirty && userId ? flush() : undefined; });
  }
  async function connect(supabase, user) {
    disconnect();
    client = supabase;
    userId = user.id;
    metaKey = 'memory-planet.account.' + userId + ':cloud.v1';
    MI.store.setAccount(userId);
    MI.store.boot();
    var meta;
    try { meta = JSON.parse(localStorage.getItem(metaKey)); } catch (_) {}
    revision = meta && Number(meta.revision) || 0;
    dirty = !!(meta && meta.dirty);
    conflict = false;
    deviceSaved = true;
    sequence = 0;
    emit('loading', 'Opening your saved journals…');
    var result = await client.from('memory_planet_saves').select('snapshot,revision').eq('user_id', userId).maybeSingle();
    if (result.error) {
      var error = new Error('Could not load your saved journals. Check your connection and try again.');
      emit('error', error.message);
      throw error;
    }
    var remoteRevision = result.data ? Number(result.data.revision) : 0;
    if (dirty) {
      conflict = revision !== remoteRevision;
    } else {
      if (result.data) MI.store.restoreLibrary(result.data.snapshot);
      else MI.store.restoreLibrary({ version: 1, library: { version: 1, currentId: null, journals: [] }, worlds: [] });
      revision = remoteRevision;
      metadata();
    }
    unsubscribe = MI.store.subscribe(changed);
    if (conflict) emit('conflict', 'Another device saved changes. Your edits are kept on this device.');
    else if (dirty) await flush();
    else emit('saved', 'Saved to your account');
  }
  async function useCloudCopy() {
    if (!userId) return;
    var result = await client.from('memory_planet_saves').select('snapshot,revision').eq('user_id', userId).maybeSingle();
    if (result.error) throw result.error;
    if (!result.data) throw new Error('No cloud copy is available yet.');
    // The caller asks before replacing pending local edits and offers a backup.
    MI.store.restoreLibrary(result.data.snapshot);
    revision = Number(result.data.revision);
    dirty = false; conflict = false;
    metadata();
  }
  function download() {
    var blob = new Blob([JSON.stringify(MI.store.exportLibrary(), null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = 'memory-planet-journals.json'; a.click();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }
  window.addEventListener('online', function () { flush().catch(function () {}); });
  window.addEventListener('beforeunload', function (event) {
    if (!userId || !dirty) return;
    event.preventDefault(); event.returnValue = '';
  });
  MI.cloud = {
    connect: connect, flush: flush, disconnect: disconnect, download: download,
    useCloudCopy: useCloudCopy,
    guest: function () { disconnect(); dirty = false; conflict = false; MI.store.setAccount(null); emit('guest', 'Saved on this device'); },
    hasPending: function () { return dirty; },
    status: function () { return state; },
    subscribe: function (fn) { listeners.push(fn); fn(state); }
  };
})();
