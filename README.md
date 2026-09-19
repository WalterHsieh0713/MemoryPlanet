# Memory Planet

A journal that turns memories into buildings on a small, explorable planet. Memories, terrain, and people persist in your browser's local storage.

## Run

Requires Node.js 18 or newer. From this folder, run `node server.js` and open http://localhost:8000. The scene and classification fallback work offline; the font falls back to the system font.

The optional Claude classifier needs `ANTHROPIC_API_KEY` in a local `.env` file (see `.env.example`). Without it, entries use the built-in keyword classifier. The key stays on the server.

Write a memory and press Enter. Click a land tile to read its memory and change its building. Use **see your land flat** for the map view. **Start over** clears browser storage after a second click.

You start on a small 42-tile planet. Once half of it is land, it grows to the next size, up to 1002 tiles. Every memory earns shards (✦). You get more for big days, new friends and daily streaks, plus a bonus each time the planet grows. Spend shards in the **Shop** on themes, pets and character skins.

The 3D models are from Kenney's CC0 Hexagon Kit. The app loads Three.js r128 from the included local file and has no build step.

## Asset packs

`assets/` also holds six more Kenney packs (fantasy town, factory, holiday, castle, pirate, cube pets) and `assets/standalone/`, a sorted staging area of individual objects. Nothing loads them yet — the app only reads `kenney-hexagon-kit`.

**If you start using a pack, delete its line from `.vercelignore`.** Those packs are listed there so deploys stay small, so a pack that is still listed will load locally and 404 in production. Each pack has its own texture atlas, so it also needs its own `LoadingManager` and will not pick up the runtime theme recolouring.

## Deploying

Vercel serves the static files and runs `api/` as serverless functions, so `server.js` is for local use only. Set `ANTHROPIC_API_KEY` in the project's environment variables to enable the Claude classifier in production; without it the keyword classifier takes over.
