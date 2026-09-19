# Memory Planet

A journal that turns memories into buildings on a small, explorable planet. Memories, terrain, and people persist in your browser's local storage.

## Run

Requires Node.js 18 or newer. From this folder, run `node server.js` and open http://localhost:8000. The scene and classification fallback work offline; the font falls back to the system font.

The optional Claude classifier needs `ANTHROPIC_API_KEY` in a local `.env` file (see `.env.example`). Without it, entries use the built-in keyword classifier. The key stays on the server.

Write a memory and press Enter. Click a land tile to read its memory and change its building. Use **see your land flat** for the map view. **Start over** clears browser storage after a second click.

The 3D models are from Kenney's CC0 Hexagon Kit. The app loads Three.js r128 from the included local file and has no build step.
