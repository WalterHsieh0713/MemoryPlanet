// MI.connectors — picks which path/river tile to place and how far to spin it, given the
// set of tile edges the road has to reach.
//
// The edge sets below were MEASURED from the kit's GLBs, not guessed: the road surface uses
// a different atlas column than the grass, so the road vertices can be isolated and tested
// against each of the six edge midpoints (scratchpad/analyze-paths.js). Rivers turned out
// to use exactly the same configurations, so one table drives both.
//
// Edge k sits at angle k*60 degrees from the tile's local +X. Rotating a tile by r*60
// degrees maps its model edge k onto tile edge (k - r) mod 6 — verified against three.js
// rather than derived on paper, because a sign error here shows up as roads that don't
// meet at tile boundaries.
(function () {
  window.MI = window.MI || {};

  var PIECE_EDGES = {
    'end': [3],
    'straight': [0, 3],
    'corner': [3, 5],
    'corner-sharp': [3, 4],
    'intersectionA': [3, 4, 5],
    'intersectionB': [0, 3, 5],
    'intersectionC': [0, 1, 3],
    'intersectionF': [1, 3, 5],
    'intersectionD': [0, 1, 3, 5],
    'intersectionE': [0, 1, 3, 4],
    'intersectionH': [0, 3, 4, 5],
    'intersectionG': [0, 1, 3, 4, 5],
    'crossing': [0, 1, 2, 3, 4, 5]
  };

  function key(edges) {
    return edges.slice().sort(function (a, b) { return a - b; }).join(',');
  }

  // Every piece at every rotation, indexed by the edge set it ends up covering. 13 pieces
  // times 6 rotations is small enough to just enumerate at load.
  var LOOKUP = {};
  Object.keys(PIECE_EDGES).forEach(function (piece) {
    for (var r = 0; r < 6; r++) {
      var rotated = PIECE_EDGES[piece].map(function (k) { return ((k - r) % 6 + 6) % 6; });
      var k = key(rotated);
      // First match wins, and pieces are declared simplest-first, so a straight run picks
      // 'straight' rather than some intersection that happens to cover the same edges.
      if (!LOOKUP[k]) LOOKUP[k] = { piece: piece, rotation: r };
    }
  });

  // edges: array of tile-edge indices (0-5) the connector must reach.
  // kind: 'path' or 'river'.
  function connectorFor(edges, kind) {
    if (!edges || !edges.length) return null;
    var match = LOOKUP[key(edges)];
    if (!match) return null; // no piece covers this shape — caller should skip the tile
    return {
      file: (kind === 'river' ? 'river-' : 'path-') + match.piece + '.glb',
      rotation: match.rotation * Math.PI / 3
    };
  }

  // Is every possible edge set coverable? Used by the tests; also documents that the kit
  // genuinely covers all 63 non-empty subsets.
  function coverage() {
    var total = 0, covered = 0;
    for (var mask = 1; mask < 64; mask++) {
      var edges = [];
      for (var b = 0; b < 6; b++) if (mask & (1 << b)) edges.push(b);
      total++;
      if (LOOKUP[key(edges)]) covered++;
    }
    return { total: total, covered: covered };
  }

  MI.connectors = { connectorFor: connectorFor, coverage: coverage, PIECE_EDGES: PIECE_EDGES };
})();
