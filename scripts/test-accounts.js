// Offline persistence/sync checks. The Supabase transport is faked; RLS is tested
// separately by supabase/tests/ownership.sql against a configured project.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
function device(storage = new Map()) {
  const ctx = vm.createContext({ console, setTimeout, clearTimeout, Promise, Set, Map,
    addEventListener() {},
    localStorage: {
      getItem: k => storage.get(k) || null,
      setItem: (k, v) => storage.set(k, String(v)),
      removeItem: k => storage.delete(k)
    }
  });
  ctx.window = ctx;
  for (const file of ['src/store/store.js', 'src/store/cloud.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), ctx);
  }
  return { ...ctx.MI, storage };
}
const copy = value => JSON.parse(JSON.stringify(value));
const rows = new Map();
let offline = false, duringWrite;
function transport(owner) {
  return {
    from() { return { select() { return this; }, eq(field, id) { assert.equal(id, owner); return this; },
      async maybeSingle() { return { data: rows.has(owner) ? copy(rows.get(owner)) : null }; }
    }; },
    async rpc(name, args) {
      assert.equal(name, 'save_memory_planet');
      if (offline) return { error: { message: 'Network unavailable' } };
      if (duringWrite) { const fn = duringWrite; duringWrite = null; fn(); }
      const revision = rows.get(owner)?.revision || 0;
      if (revision !== args.expected_revision) return { error: { code: '40001' } };
      rows.set(owner, { revision: revision + 1, snapshot: copy(args.new_snapshot) });
      return { data: revision + 1 };
    }
  };
}
(async () => {
  const a = device();
  a.store.boot();
  const guest = a.store.createJournal({ name: 'Guest keeps this' });
  await a.cloud.connect(transport('alice'), { id: 'alice' });
  assert.equal(a.store.listJournals().length, 0, 'account must not import guest journals');
  a.store.createJournal({ name: 'Alice' });
  a.store.addMemory({ id: 'm1', text: 'A private memory', photo: 'data:image/png;base64,test' });
  await a.cloud.flush();
  assert.equal(rows.get('alice').snapshot.worlds[0].memories[0].photo, 'data:image/png;base64,test');
  await a.cloud.connect(transport('bob'), { id: 'bob' });
  assert.equal(a.store.listJournals().length, 0, 'Bob cannot see Alice');
  a.store.createJournal({ name: 'Bob' }); await a.cloud.flush();
  await a.cloud.connect(transport('alice'), { id: 'alice' });
  assert.equal(a.store.listJournals()[0].name, 'Alice');
  const second = device();
  await second.cloud.connect(transport('alice'), { id: 'alice' });
  assert.equal(second.store.journalWorld(second.store.listJournals()[0].id).memories[0].text, 'A private memory');
  a.store.createJournal({ name: 'New on device one' }); await a.cloud.flush();
  second.store.createJournal({ name: 'Unsent on device two' });
  await assert.rejects(second.cloud.flush());
  assert.equal(second.cloud.status().kind, 'conflict');
  assert.equal(rows.get('alice').snapshot.library.journals[0].name, 'New on device one');
  assert.equal(second.store.listJournals()[0].name, 'Unsent on device two');
  await second.cloud.useCloudCopy();
  assert.equal(second.store.listJournals()[0].name, 'New on device one');
  second.cloud.disconnect();

  offline = true;
  a.store.createJournal({ name: 'Offline edits' });
  await assert.rejects(a.cloud.flush());
  assert.equal(a.cloud.hasPending(), true);
  a.cloud.disconnect();
  offline = false;
  const reload = device(a.storage);
  await reload.cloud.connect(transport('alice'), { id: 'alice' });
  assert.equal(rows.get('alice').snapshot.library.journals[0].name, 'Offline edits');
  assert.equal(reload.cloud.hasPending(), false);

  const id = reload.store.listJournals()[0].id;
  reload.store.openJournal(id);
  duringWrite = () => reload.store.addMemory({ id: 'late', text: 'Edited during upload' });
  await reload.cloud.flush();
  assert.equal(rows.get('alice').snapshot.worlds.find(w => w.id === id).memories[0].text, 'Edited during upload');
  reload.store.deleteJournal(id); await reload.cloud.flush();
  assert.equal(rows.get('alice').snapshot.worlds.some(w => w.id === id), false);
  const order = reload.store.listJournals().map(j => j.id);
  reload.store.reorderJournal(order[0], 1); await reload.cloud.flush();
  assert.equal(rows.get('alice').snapshot.library.journals[1].id, order[0]);
  reload.cloud.guest(); reload.store.boot();
  assert.equal(reload.store.listJournals()[0].id, guest.id, 'original guest journal survives account switching');
  assert.equal(rows.get('bob').snapshot.library.journals[0].name, 'Bob');
  assert.throws(() => reload.store.restoreLibrary({ version: 1, library: { journals: [{ id: 'missing' }] }, worlds: [] }));
  assert.equal(reload.store.listJournals()[0].id, guest.id, 'invalid snapshot must not replace the shelf');

  const config = require('../api/config.js');
  const oldEnv = { url: process.env.SUPABASE_URL, key: process.env.SUPABASE_PUBLISHABLE_KEY, anon: process.env.SUPABASE_ANON_KEY };
  function readConfig(key) {
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_PUBLISHABLE_KEY = key;
    delete process.env.SUPABASE_ANON_KEY;
    let out;
    config({ method: 'GET' }, { setHeader() {}, end(body) { out = JSON.parse(body); } });
    return out;
  }
  try {
    assert.equal(readConfig('sb_secret_never_expose').configured, false);
    const token = 'x.' + Buffer.from(JSON.stringify({ role: 'service_role' })).toString('base64url') + '.x';
    assert.equal(readConfig(token).configured, false);
    assert.equal(readConfig('sb_publishable_test').key, 'sb_publishable_test');
  } finally {
    for (const [name, value] of Object.entries({ SUPABASE_URL: oldEnv.url, SUPABASE_PUBLISHABLE_KEY: oldEnv.key, SUPABASE_ANON_KEY: oldEnv.anon })) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  }
  console.log('ok — account isolation, cloud restore, photos, offline retry, conflict protection, concurrent edits, deletion, reorder, guest preservation, public config');
})().catch(error => { console.error(error); process.exitCode = 1; });
