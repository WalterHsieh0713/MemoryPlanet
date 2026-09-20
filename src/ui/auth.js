// Supabase owns passwords and sessions. This module owns the account UI only.
(function () {
  var client, session, ready, options, dialog, form, mode, busy = false;
  var activeId = null, recovering = false, leaving = false;
  function el(id) { return document.getElementById('auth-' + id); }
  function message(text, error) { el('message').textContent = text || ''; el('message').classList.toggle('error', !!error); }
  function lock(value) {
    busy = value;
    dialog.setAttribute('aria-busy', String(value));
    dialog.querySelectorAll('button').forEach(function (button) { button.disabled = value; });
  }
  function field(name, visible) {
    el(name + '-field').hidden = !visible;
    el(name).disabled = !visible;
    el(name).required = visible;
  }
  function show(nextMode) {
    if (busy) return;
    mode = nextMode;
    var account = mode === 'account', reset = mode === 'reset', recovery = mode === 'recovery', signup = mode === 'signup';
    form.reset();
    message('');
    el('title').textContent = account ? 'Your account' : recovery ? 'A fresh password' : reset ? 'Find your way back' : signup ? 'Start your story' : 'Welcome back';
    el('description').textContent = account ? (session && session.user.email || '') : recovery ? 'Choose a new password for your account.' : reset ? 'We’ll email you a link to reset your password.' : signup ? 'Keep your journals and little worlds together, wherever you are.' : 'Log in to open your journals on any device.';
    form.hidden = account;
    field('email', !account && !recovery);
    field('password', !account && !reset);
    field('confirm', signup || recovery);
    el('password').minLength = signup || recovery ? 8 : 1;
    el('password').autocomplete = signup || recovery ? 'new-password' : 'current-password';
    el('submit').textContent = signup ? 'Sign up' : recovery ? 'Save new password' : reset ? 'Send reset link' : 'Log in';
    el('forgot').hidden = mode !== 'login';
    el('switch').hidden = account || recovery;
    el('switch').textContent = signup || reset ? 'Already have an account? Log in' : 'New here? Sign up';
    el('account-actions').hidden = !account;
    el('open').hidden = !!activeId;
    el('backup').hidden = !activeId;
    el('retry').hidden = !activeId;
    el('use-cloud').hidden = !activeId || MI.cloud.status().kind !== 'conflict';
    if (account && activeId) message(MI.cloud.status().message);
    if (!dialog.open) dialog.showModal();
    (account ? el(activeId ? 'signout' : 'open') : el(recovery ? 'password' : 'email')).focus();
    ready.then(function () {
      if (!client && mode === nextMode && dialog.open) message('Accounts aren’t connected yet. You can still continue locally.', true);
    });
  }
  async function configured() {
    await ready;
    if (!client) throw new Error('Accounts aren’t connected yet. You can still continue locally.');
  }
  async function enterAccount() {
    await configured();
    // Validate the stored session with Auth before reading any account data.
    var result = await client.auth.getUser();
    if (result.error || !result.data.user) throw new Error('Please log in again to open your journals.');
    message('Opening your saved journals…');
    await MI.cloud.connect(client, result.data.user);
    activeId = result.data.user.id;
    session = { user: result.data.user };
    dialog.close();
    el('password').value = ''; el('confirm').value = '';
    document.getElementById('account-bar').hidden = false;
    options.enter();
  }
  async function run(action) {
    if (busy) return;
    lock(true); message('One moment…');
    try { await action(); }
    catch (err) { message(err.message || 'Something went wrong. Please try again.', true); }
    finally { lock(false); }
  }
  function redirectUrl() { return location.origin + location.pathname; }
  async function submit(event) {
    event.preventDefault();
    if (!form.reportValidity()) return;
    if (!el('confirm').disabled && el('password').value !== el('confirm').value) {
      message('The passwords don’t match yet.', true); el('confirm').focus(); return;
    }
    var submittedMode = mode, email = el('email').value.trim(), password = el('password').value;
    await run(async function () {
      await configured();
      var result;
      if (submittedMode === 'reset') {
        result = await client.auth.resetPasswordForEmail(email, { redirectTo: redirectUrl() });
        if (result.error) throw result.error;
        message('If there’s an account for that email, a reset link is on its way.');
        return;
      }
      if (submittedMode === 'recovery') {
        result = await client.auth.updateUser({ password: password });
        if (result.error) throw result.error;
        recovering = false;
        await enterAccount();
        return;
      }
      result = submittedMode === 'signup'
        ? await client.auth.signUp({ email: email, password: password, options: { emailRedirectTo: redirectUrl() } })
        : await client.auth.signInWithPassword({ email: email, password: password });
      if (result.error) throw result.error;
      el('password').value = ''; el('confirm').value = '';
      if (!result.data.session) {
        message('Check your email to confirm your account, then come back and log in.');
        return;
      }
      session = result.data.session;
      await enterAccount();
    });
  }
  function login() {
    show('login');
    ready.then(function () {
      if (session && !recovering && mode === 'login') show('account');
    });
  }
  function signup() {
    show('signup');
    ready.then(function () { if (session && mode === 'signup') show('account'); });
  }
  async function signOut() {
    await run(async function () {
      if (activeId && MI.cloud.hasPending()) {
        try { await MI.cloud.flush(); }
        catch (_) { if (!window.confirm('Some edits are only on this device. Sign out and keep them here for your next login?')) return; }
      }
      leaving = true;
      var result = await client.auth.signOut({ scope: 'local' });
      if (result.error) { leaving = false; throw result.error; }
      MI.cloud.disconnect();
      location.reload();
    });
  }
  async function init(config) {
    options = config;
    dialog = el('dialog'); form = el('form');
    form.addEventListener('submit', submit);
    el('close').addEventListener('click', function () { dialog.close(); });
    dialog.addEventListener('cancel', function (event) { if (busy) event.preventDefault(); });
    dialog.addEventListener('close', function () { el('password').value = ''; el('confirm').value = ''; });
    el('switch').addEventListener('click', function () { show(mode === 'login' ? 'signup' : 'login'); });
    el('forgot').addEventListener('click', function () { show('reset'); });
    el('open').addEventListener('click', function () { run(enterAccount); });
    el('signout').addEventListener('click', signOut);
    el('backup').addEventListener('click', MI.cloud.download);
    el('retry').addEventListener('click', function () { run(async function () { await MI.cloud.flush(); message(MI.cloud.status().message); }); });
    el('use-cloud').addEventListener('click', function () {
      if (!window.confirm('Replace this device’s pending edits with the cloud copy? Download a device backup first if you want to keep both.')) return;
      run(async function () { await MI.cloud.useCloudCopy(); MI.cloud.disconnect(); location.reload(); });
    });
    ['account-bar', 'account-settings'].forEach(function (id) {
      document.getElementById(id).addEventListener('click', function () {
        if (activeId) show('account');
        else location.reload();
      });
    });
    MI.cloud.subscribe(function (state) {
      var bar = document.getElementById('account-bar');
      bar.textContent = state.kind === 'guest' ? 'Local journal · Home' : state.kind === 'saved' ? 'Account · Saved' : state.kind === 'pending' ? 'Account · Saving…' : 'Account · Check sync';
      bar.dataset.state = state.kind;
      bar.title = state.message;
      var settings = document.getElementById('account-settings');
      settings.textContent = bar.textContent;
      settings.title = state.message;
      if (mode === 'account' && dialog.open) {
        message(state.message, state.kind === 'error' || state.kind === 'conflict');
        el('use-cloud').hidden = state.kind !== 'conflict';
      }
    });
    ready = (async function () {
      try {
        var response = await fetch('/api/config', { cache: 'no-store' });
        if (!response.ok) return;
        var config = await response.json();
        if (!config.url || !config.key || !window.supabase) return;
        client = window.supabase.createClient(config.url, config.key, {
          auth: { storageKey: 'memory-planet.auth', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
        });
        client.auth.onAuthStateChange(function (event, nextSession) {
          session = nextSession;
          // Do not await Auth calls inside this callback (the SDK holds a session lock).
          if (event === 'PASSWORD_RECOVERY') {
            recovering = true;
            setTimeout(function () { show('recovery'); }, 0);
          }
          if (activeId && (!nextSession || nextSession.user.id !== activeId) && !leaving) {
            MI.cloud.disconnect();
            location.reload();
          }
        });
        var result = await client.auth.getSession();
        session = result.data.session;
        if (session && !recovering) document.getElementById('landing-login').textContent = 'Open my journals';
      } catch (_) { /* Guest mode remains available if configuration cannot load. */ }
    })();
  }
  MI.auth = {
    init: init, login: login, signup: signup,
    continueLocally: function () {
      MI.cloud.guest();
      document.getElementById('account-bar').hidden = false;
      options.enter();
    }
  };
})();
