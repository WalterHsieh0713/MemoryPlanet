// One-time offline generator — NOT loaded by the app. Run with:
//   node scripts/generate-hexgrid.js [frequency] [outputPath]
// Produces data/hexgrid.json (or outputPath) — a fixed hex/pentagon tiling of a sphere, baked once so
// MI.world can just look up tile centers/corners/neighbors at runtime instead of computing
// (or worse, solving) any geometry itself.
//
// How it works: subdividing an icosahedron's 20 triangular faces at "frequency" f gives a
// geodesic sphere with 10*f*f + 2 vertices. The dual of that mesh (a Goldberg polyhedron) is
// exactly the hex/pentagon planet we want:
//   - a dual FACE's center is a geodesic-sphere VERTEX (what we call a tile)
//   - a dual FACE's CORNERS are the centroids of the geodesic sphere's triangles around that
//     vertex, in cyclic order — this is what actually lets tiles share edges with zero seams
//   - two tiles are neighbors exactly when their vertices share a mesh edge
// Every vertex has 6 neighbors (hexagon) except the original 12 icosahedron corners, which
// always have exactly 5 (pentagon) — a topological necessity for any sphere tiling.

var fs = require('fs');
var path = require('path');

var freq = parseInt(process.argv[2], 10) || 6; // 10*6*6+2 = 362 tiles
var outputArg = process.argv[3];

function normalize(v) {
  var len = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
  return [v[0] / len, v[1] / len, v[2] / len];
}

var t = (1 + Math.sqrt(5)) / 2;
var icoVerts = [
  [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0],
  [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t],
  [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]
].map(normalize);

var icoFaces = [
  [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
  [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
  [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
  [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]
];

var vertexIdByKey = new Map();
var tileDirs = [];
var neighborSets = [];
var triangles = []; // [v0,v1,v2] ids — every small triangle of the subdivided icosahedron

function keyFor(p) {
  return p[0].toFixed(8) + ',' + p[1].toFixed(8) + ',' + p[2].toFixed(8);
}

function getOrCreateVertex(p) {
  var key = keyFor(p);
  var id = vertexIdByKey.get(key);
  if (id === undefined) {
    id = tileDirs.length;
    vertexIdByKey.set(key, id);
    tileDirs.push(p);
    neighborSets.push(new Set());
  }
  return id;
}

function addEdge(a, b) {
  neighborSets[a].add(b);
  neighborSets[b].add(a);
}

icoFaces.forEach(function (face) {
  var a = icoVerts[face[0]];
  var b = icoVerts[face[1]];
  var c = icoVerts[face[2]];

  var grid = [];
  for (var i = 0; i <= freq; i++) {
    grid[i] = [];
    for (var j = 0; j <= freq - i; j++) {
      var k = freq - i - j;
      var p = normalize([
        (a[0] * i + b[0] * j + c[0] * k) / freq,
        (a[1] * i + b[1] * j + c[1] * k) / freq,
        (a[2] * i + b[2] * j + c[2] * k) / freq
      ]);
      grid[i][j] = getOrCreateVertex(p);
    }
  }

  for (i = 0; i < freq; i++) {
    for (j = 0; j <= freq - i - 1; j++) {
      var v00 = grid[i][j];
      var v10 = grid[i + 1][j];
      var v01 = grid[i][j + 1];
      addEdge(v00, v10);
      addEdge(v10, v01);
      addEdge(v01, v00);
      triangles.push([v00, v10, v01]);
      if (j < freq - i - 1) {
        var v11 = grid[i + 1][j + 1];
        addEdge(v10, v11);
        addEdge(v11, v01);
        addEdge(v01, v10);
        triangles.push([v10, v11, v01]);
      }
    }
  }
});

function edgeKey(a, b) {
  return a < b ? a + '_' + b : b + '_' + a;
}

var edgeTriangles = new Map();
triangles.forEach(function (tri, ti) {
  [[tri[0], tri[1]], [tri[1], tri[2]], [tri[2], tri[0]]].forEach(function (e) {
    var k = edgeKey(e[0], e[1]);
    if (!edgeTriangles.has(k)) edgeTriangles.set(k, []);
    edgeTriangles.get(k).push(ti);
  });
});

function triCentroid(tri) {
  var a = tileDirs[tri[0]], b = tileDirs[tri[1]], c = tileDirs[tri[2]];
  return normalize([
    (a[0] + b[0] + c[0]) / 3,
    (a[1] + b[1] + c[1]) / 3,
    (a[2] + b[2] + c[2]) / 3
  ]);
}

function otherTriangleOnEdge(edgeTris, currentIdx) {
  return edgeTris[0] === currentIdx ? edgeTris[1] : edgeTris[0];
}

// Walk the triangles around each vertex V to produce a cyclic neighbor order and the matching
// cyclic corner-position list — corners[k] is the shared dual-vertex between edges to
// neighbors[k] and neighbors[(k+1) % sides].
var tiles = tileDirs.map(function (dir, V) {
  var sides = neighborSets[V].size;
  var startNeighbor = Array.from(neighborSets[V])[0];
  var startTri = edgeTriangles.get(edgeKey(V, startNeighbor))[0];

  var orderedNeighbors = [startNeighbor];
  var orderedCorners = [];
  var currentTriIdx = startTri;
  var prevNeighbor = startNeighbor;

  for (var step = 0; step < sides; step++) {
    var tri = triangles[currentTriIdx];
    var thirdVertex = tri.filter(function (v) { return v !== V && v !== prevNeighbor; })[0];
    orderedCorners.push(triCentroid(tri));
    orderedNeighbors.push(thirdVertex);
    currentTriIdx = otherTriangleOnEdge(edgeTriangles.get(edgeKey(V, thirdVertex)), currentTriIdx);
    prevNeighbor = thirdVertex;
  }
  orderedNeighbors.pop(); // last equals startNeighbor (loop closed) — drop the duplicate

  // Ensure corners wind counter-clockwise as seen from outside the sphere (outward normal),
  // so every tile can be fan-triangulated the same way at render time.
  var c0 = orderedCorners[0], c1 = orderedCorners[1];
  var cross = [
    c0[1] * c1[2] - c0[2] * c1[1],
    c0[2] * c1[0] - c0[0] * c1[2],
    c0[0] * c1[1] - c0[1] * c1[0]
  ];
  var outward = cross[0] * dir[0] + cross[1] * dir[1] + cross[2] * dir[2];
  if (outward < 0) {
    // Reversing neighbor order shifts which corner sits "between" each consecutive pair by
    // one position — reverse then rotate by 1 to keep corners[k] between neighbors[k] and
    // neighbors[(k+1)%sides] true under the new order too.
    orderedNeighbors.reverse();
    var revCorners = orderedCorners.slice().reverse();
    orderedCorners = revCorners.slice(1).concat(revCorners.slice(0, 1));
  }

  return { id: V, dir: dir, neighbors: orderedNeighbors, corners: orderedCorners, sides: sides };
});

// --- Verification -----------------------------------------------------------------------

function dist(a, b) {
  var dx = a[0] - b[0], dy = a[1] - b[1], dz = a[2] - b[2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

var expectedCount = 10 * freq * freq + 2;
var pentagons = tiles.filter(function (tl) { return tl.sides === 5; }).length;
var hexagons = tiles.filter(function (tl) { return tl.sides === 6; }).length;
var other = tiles.length - pentagons - hexagons;

var errors = [];
if (tiles.length !== expectedCount) errors.push('tile count ' + tiles.length + ' !== expected ' + expectedCount);
if (pentagons !== 12) errors.push('pentagon count ' + pentagons + ' !== 12');
if (other > 0) errors.push(other + ' tiles have neither 5 nor 6 neighbors');

// Watertight check: every shared edge's corner must coincide exactly with the matching
// corner in the neighbor's own polygon (this is what "no cracks" actually means numerically).
var edgeChecks = 0, maxMismatch = 0, mismatchedTiles = 0;
tiles.forEach(function (t) {
  var tileBad = false;
  for (var k = 0; k < t.sides; k++) {
    var neighborTile = tiles[t.neighbors[k]];
    var myCorner = t.corners[k];
    var best = Infinity;
    neighborTile.corners.forEach(function (c) { var d = dist(c, myCorner); if (d < best) best = d; });
    edgeChecks++;
    if (best > maxMismatch) maxMismatch = best;
    if (best > 1e-6) tileBad = true;
  }
  if (tileBad) mismatchedTiles++;
});
if (mismatchedTiles > 0) errors.push(mismatchedTiles + ' tiles have a non-matching shared corner (crack) — max mismatch ' + maxMismatch.toExponential(3));

// Winding check: every tile's fan-triangulation (dir -> corners[0] -> corners[1]) must face
// outward, or it renders as a flipped/inverted polygon.
var flippedTiles = 0;
tiles.forEach(function (t) {
  var d = t.dir, c0 = t.corners[0], c1 = t.corners[1];
  var e0 = [c0[0] - d[0], c0[1] - d[1], c0[2] - d[2]];
  var e1 = [c1[0] - d[0], c1[1] - d[1], c1[2] - d[2]];
  var cross = [e0[1] * e1[2] - e0[2] * e1[1], e0[2] * e1[0] - e0[0] * e1[2], e0[0] * e1[1] - e0[1] * e1[0]];
  var outwardDot = cross[0] * d[0] + cross[1] * d[1] + cross[2] * d[2];
  if (outwardDot <= 0) flippedTiles++;
});
if (flippedTiles > 0) errors.push(flippedTiles + ' tiles have flipped (inward-facing) winding');

// Duplicate/disconnected check: neighbor ids must be unique per tile and reciprocal.
var badReciprocity = 0;
tiles.forEach(function (t) {
  var uniqueNeighbors = new Set(t.neighbors);
  if (uniqueNeighbors.size !== t.sides) badReciprocity++;
  t.neighbors.forEach(function (nId) {
    if (tiles[nId].neighbors.indexOf(t.id) === -1) badReciprocity++;
  });
});
if (badReciprocity > 0) errors.push(badReciprocity + ' neighbor-relationship inconsistencies (duplicate or non-reciprocal)');

console.log('--- Geometry statistics ---');
console.log('frequency:', freq);
console.log('tiles:', tiles.length, '(expected ' + expectedCount + ')');
console.log('pentagons (5 neighbors):', pentagons, '(expected 12)');
console.log('hexagons (6 neighbors):', hexagons, '(expected ' + (expectedCount - 12) + ')');
console.log('shared-edge corner checks:', edgeChecks, 'max mismatch:', maxMismatch.toExponential(3));
console.log('flipped-winding tiles:', flippedTiles);
console.log('neighbor-consistency issues:', badReciprocity);

if (errors.length > 0) {
  console.error('--- FAILED verification ---');
  errors.forEach(function (e) { console.error('  - ' + e); });
  process.exit(1);
}
console.log('--- All verification checks passed ---');

var outPath = outputArg
  ? path.resolve(process.cwd(), outputArg)
  : path.join(__dirname, '..', 'data', 'hexgrid.json');
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify({ frequency: freq, tiles: tiles }, null, 2));
console.log('wrote', outPath);
