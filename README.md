# Memory Planet

A journal that turns memories into buildings on a small, explorable planet. Memories, terrain, and people persist in your browser's local storage.

## Run

Requires Node.js 18 or newer. From this folder, run `node server.js` and open http://localhost:8000. The scene and classification fallback work offline; the font falls back to the system font.

The optional Claude classifier needs `ANTHROPIC_API_KEY` in a local `.env` file (see `.env.example`). Without it, entries use the built-in keyword classifier. The key stays on the server.

Open the journal with the rotating book labeled **Write a memory** on the left. Write on the lined page, add people and tags if you like, then choose **Plant it on my planet**. Enter adds a new line; Ctrl/Cmd+Enter submits. On a phone, switch between writing and past entries with the tabs in the book. Click a land tile to read its memory and change its building. Use **island view** for the flat map. **Start over** clears browser storage after a second click.

You start on a small 42-tile planet. Once half of it is land, it grows to the next size, up to 1002 tiles. Every memory earns shards (✦). You get more for big days, new friends and daily streaks, plus a bonus each time the planet grows. Spend shards in the **Shop** on themes, pets (they walk around your island), satellites (they orbit above it) and character skins.

Your character lives on the planet. In **island view** the **arrow keys** walk them around, and buildings are solid (they walk round them). Press the **footprints** button at the right edge to follow them in third person: the camera glides in over their shoulder, moving the mouse turns you, **WASD** walks, and **Esc** (or the button) brings you back up. Follow mode is island-only; on the planet you just watch them.

The 3D models are from Kenney's CC0 Hexagon Kit. The app loads Three.js r128 from the included local file and has no build step.

## Asset packs

`assets/` also holds six more Kenney packs (fantasy town, factory, holiday, castle, pirate, cube pets) and `assets/standalone/`, a sorted staging area of individual objects. The app reads `kenney-hexagon-kit` for the world itself and `assets/standalone/animals/cube-pets/` for the walking pets; nothing loads the rest yet.

**If you start using a pack, delete its line from `.vercelignore`.** Those packs are listed there so deploys stay small, so a pack that is still listed will load locally and 404 in production. Each pack has its own texture atlas, so it also needs its own `LoadingManager` and will not pick up the runtime theme recolouring.

## Deploying

Vercel serves the static files and runs `api/` as serverless functions, so `server.js` is for local use only. Set `ANTHROPIC_API_KEY` in the project's environment variables to enable the Claude classifier in production; without it the keyword classifier takes over.
