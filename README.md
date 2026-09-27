# Memory Planet

A journal that turns what you write into a tiny world. Every memory becomes a building or a
feature on a low-poly hex planet you can spin around and walk on; everyone you write about
becomes a little character who lives there. Write enough and the planet grows, up to six sizes;
open a second journal and it becomes a second planet, floating in space beside the first.

No build step, no framework — a static page and vanilla Three.js, so it runs by opening one
file and stays legible in an afternoon.

## Why

Most people who try journaling quit for one of three reasons: it's hard to start (a blank page
asks a lot for no visible payoff), hard to keep up (nothing marks the days you skip or the days
you don't), and once you've written a hundred entries, there's no good way to actually go back
through them — they're just a scroll of text in date order.

Memory Planet answers each of those with something you can see. Starting is just one sentence
about your day — the app figures out who was in it, how it felt, and what kind of memory it is,
and turns it into a building on your planet before you've had time to overthink it. Consistency
is rewarded, not nagged: streaks and daily writing earn coins, and the planet visibly grows every
so many entries, so the habit has a payoff you can watch happen. And organization stops being a
list — your memories live in *space*: a trip is a cluster of buildings you can walk between, a
friend is a character standing near everything you've written about them, and revisiting a good
memory means flying over to it and clicking on it, not scrolling back through months of text.

It's meant to make the parts of journaling that usually cause people to quit — the blank page,
the missed days, the pile of old entries nobody reopens — into the reason to keep going instead.

## Features

- **Journal → world.** Writing an entry classifies it (Claude, with a keyword fallback), picks
  who was there, how it felt, and what kind of day it was, then plants a building for it on the
  planet — placed and chosen once and persisted, never re-rolled on reload.
- **A living planet.** A hex-sphere with terrain, roads, weather-appropriate themes, wandering
  pets, orbiting satellites, and a resident for every person in your journal, each ambling
  around near the memories they're actually in.
- **Two views, one world.** Spin the sphere from orbit, or fold it into an **island view** — the
  same land coiled into a walkable island where your character moves on arrow keys and buildings
  are solid.
- **Follow mode.** On the island, a footprints button drops you into third person over your
  character's shoulder — mouse to look, WASD to walk — for actually exploring the place you built.
- **Growth and a shop.** Memories earn coins; coins buy planet themes, pets, sky satellites, food
  to feed the pets, and character skins. The planet itself grows from 42 tiles up to 1002 once
  half of it is claimed.
- **A pirate fleet you win by writing.** Ships start hostile on the open sea and turn friendly
  only when you hit real journaling milestones (a travel entry, a day with two people in it, a
  streak) — the one thing on this planet that can't be bought.
- **A galaxy of journals.** Keep more than one journal; switch between them from a starfield view
  where every planet you own floats and can be flown up to.
- **Optional accounts.** Sign in with email (via Supabase) to sync your journals to the cloud
  across devices, or skip it entirely and journal as a guest in local storage.
- **Works offline.** The Claude classifier is a nice-to-have, not a dependency: no API key, no
  network, no problem — a keyword heuristic takes over invisibly.

## Quick start

Requires Node.js 18+.

```
node server.js
```

Then open **http://localhost:8000**. (It must be served over HTTP — opening `index.html`
directly as a `file://` URL blocks the 3D models from loading.)

That's it — the planet, the journal, and the shop all work with zero configuration. Two things
are optional and layered on top:

- **Claude-powered classification.** Copy `.env.example` to `.env` and set `ANTHROPIC_API_KEY` to
  have entries classified by Claude instead of the keyword heuristic. The key never leaves the
  server.
- **Accounts and cloud sync.** Set `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` in `.env` to turn
  on email sign-in and cross-device journals. See [`docs/ACCOUNTS.md`](docs/ACCOUNTS.md) for the
  one-time Supabase project setup. Without these, the app runs entirely in guest mode.

## Using it

Open the journal with the rotating book labeled **Write a memory** on the left. Write on the
lined page, tag who was there and how it felt if you like (or leave it to the classifier), then
choose **Plant it on my planet**. Enter adds a new line; Ctrl/Cmd+Enter submits.

- Click any tile to read its memory and swap its building.
- Toggle **island view** to fold the planet into a walkable island; arrow keys move your
  character there, and the **footprints** button starts follow mode (mouse to look, WASD to
  walk, Esc to leave).
- **Settings** holds **Themes**, **Pets**, **Satellites** and character skins — anything you've
  unlocked. An empty section links straight to the **Shop**.
- **Start over** wipes the current journal's planet, coins, and unlocks after a second click (it
  keeps the journal's name and character).
- Create additional journals from the cover screen; each is its own planet, and switching between
  them flies out to a starfield view of all of them.

## How it works

Everything hangs off one global namespace, `window.MI = { ai, store, world, app, config }`, with
one owner per module and no cross-file poking — the full interface contract, including the exact
shape of a saved world, lives in [`docs/CONTRACT.md`](docs/CONTRACT.md).

```
journal text
     │
     ▼
MI.ai.classify()        Claude, or a keyword fallback — never rejects
     │
     ▼
MI.app.addEntry()       resolve/create people → pick a tile & asset → persist
     │
     ▼
MI.store                one JSON world per journal, in localStorage (or Supabase, if signed in)
     │
     ▼
MI.world                spawns it on the hex-sphere / island and keeps it in sync on reload
```

Placement and asset choice are decided once and saved on the memory itself — never re-randomized
— so reloading always reproduces the same world. The planet's shape, sphere math, growth ladder,
island layout, and character movement are all pure, dependency-free modules under `src/world/`
with matching `node scripts/test-*.js` checks; see the `scripts/` folder for the full list.

## Project layout

```
index.html          entry point — plain <script> tags, no bundler
server.js           local dev server (static files + the classify endpoint); not deployed
api/                Vercel serverless functions (classify, config) for production
src/
  ai/               classification (Claude call + keyword fallback)
  app.js            the app layer: journal entries → world state
  store/            persistence: local journals + optional Supabase sync
  ui/               journal UI, auth UI, landing page
  world/            the 3D world: sphere, island, growth, placement, walkers, ships, themes...
  game/             coins and the shop catalog
assets/             Kenney CC0 model packs (see below)
data/, tools/       hex-grid data and the generator that produced it
docs/               CONTRACT.md (interfaces), ACCOUNTS.md (Supabase setup), HANDOFF.md
scripts/            node test scripts for the pure logic modules
```

## Tech stack & conventions

- **Vanilla Three.js r128**, loaded from the vendored `three-r128.min.js` — no bundler, no ES
  modules, no npm packages, no React/R3F. `vendor/GLTFLoader.js` supplies the GLTF loader r128's
  CDN build omits.
- **3D assets** are Kenney's CC0 packs (`assets/<pack>/`), primarily the Hexagon Kit for the
  world itself, plus Mini Characters, Cube Pets, and a handful of hand-picked standalone models.
  Only the packs actually loaded ship to production — see `.vercelignore` before wiring up a new
  one.
- **Style**: toy-diorama, low-poly, flat shading, warm palette, Quicksand/Architects Daughter
  fonts — charm over realism.
- Built for a 24-hour hackathon and meant to keep working on one laptop, offline: every networked
  feature (classification, cloud sync) degrades to a local fallback instead of breaking.

## Testing

The 3D scene itself isn't unit-tested, but every piece of pure logic underneath it is — sphere
math, growth/remapping, island layout and roads, placement, player movement, walkers, ships, the
economy, and account/journal persistence:

```
node scripts/test-growth.js
node scripts/test-placement.js
node scripts/test-island.js
node scripts/test-player.js
node scripts/test-walkers.js
node scripts/test-ships.js
node scripts/test-economy.js
node scripts/test-journals.js
node scripts/test-accounts.js
```

## Deploying

Live on Vercel from `main`. Vercel serves the repo as static files and runs `api/` as serverless
functions — `server.js` is local-only and is not deployed, and `vercel.json` deliberately declares
no framework/build/install step. Set `ANTHROPIC_API_KEY` (and, for accounts, `SUPABASE_URL` /
`SUPABASE_PUBLISHABLE_KEY`) in the Vercel project's environment variables; without them the app
falls back to the keyword classifier and guest-only journals respectively.

## Credits

3D models and textures from [Kenney](https://kenney.nl) (CC0) — the Hexagon Kit, Mini
Characters, Cube Pets, and several smaller packs. Fonts via Google Fonts. Accounts and sync
powered by [Supabase](https://supabase.com).
