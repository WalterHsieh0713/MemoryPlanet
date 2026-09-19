// MI.world.themes — whole-planet looks (CLAUDE.md planned item 3). Pure data plus one pixel
// transform; world.js applies them (lights, sky, water, land tints, building atlas, foliage).
// The shop's names and prices live in src/game/economy.js, keyed by the same ids.
(function () {
  window.MI = window.MI || {};
  MI.world = MI.world || {};

  // HSL helpers for recolouring the Kenney atlas per theme — no new assets needed.
  function rgbToHsl(r, g, b) {
    var max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, h = 0, s = 0;
    if (max !== min) {
      var d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h /= 6;
    }
    return [h, s, l];
  }
  function hslToRgb(h, s, l) {
    if (s === 0) return [l, l, l];
    function hue(p, q, t) {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    }
    var q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
    return [hue(p, q, h + 1 / 3), hue(p, q, h), hue(p, q, h - 1 / 3)];
  }

  var THEMES = {
    meadow: {
      land: 0x8fc75a, landSide: 0x8a6239, water: 0x3f8fc4, waterSide: 0x24668c,
      deep: '#167faa', shallow: '#45c6cf', foam: '#d6fff0',
      sky: 0xdff1f7, flatSky: 0xdff3fb, skyTop: 0x7ec8f0, skyBottom: 0xe4f5fc, clouds: true,
      hemi: [0xcfe9f5, 0x6f9c5e, 1.1], sun: [0xfff1d6, 1.3],
      foliage: '#92bf65', ground: '#92bf65',
      tint: {
        'grass.glb': 0x8fc75a, 'grass-forest.glb': 0x6da844, 'grass-hill.glb': 0x7cb850,
        'sand.glb': 0xdcc27a, 'sand-desert.glb': 0xe2cd8a, 'sand-rocks.glb': 0xd0b66c,
        'stone.glb': 0x99a2aa, 'stone-hill.glb': 0x8c959d, 'stone-rocks.glb': 0x8f989f,
        'stone-mountain.glb': 0xa9b3bb, 'dirt.glb': 0xa8794e, 'dirt-lumber.glb': 0x95693f
      },
      atlas: null // the kit as shipped
    },

    frostfall: {
      land: 0xeef4f8, landSide: 0x9fb6c8, water: 0x6fb7d6, waterSide: 0x3d7fa3,
      deep: '#2d7fa6', shallow: '#a4e6f0', foam: '#ffffff',
      sky: 0xe6edf6, flatSky: 0xeef5fb, skyTop: 0x9dc0e4, skyBottom: 0xeef5fb, clouds: true,
      hemi: [0xeaf3ff, 0x9fb3c7, 1.15], sun: [0xf4f8ff, 1.1],
      foliage: '#dcebe6', ground: '#eef4f8', // frosted trees on snow, pale ice below
      tint: {
        'grass.glb': 0xf1f6fa, 'grass-forest.glb': 0xdfe9ef, 'grass-hill.glb': 0xe7eff5,
        'sand.glb': 0xe3eaee, 'sand-desert.glb': 0xe9eff2, 'sand-rocks.glb': 0xd5dee4,
        'stone.glb': 0xb7c4cf, 'stone-hill.glb': 0xaebccb, 'stone-rocks.glb': 0xb2bfca,
        'stone-mountain.glb': 0xc8d3dc, 'dirt.glb': 0xc9d3db, 'dirt-lumber.glb': 0xbfcad3
      },
      // Cold and pale: pull saturation down, lift the darks, lean a touch blue.
      atlas: function (h, s, l) {
        return [h, s * 0.35, l * 0.72 + 0.26, 0.02];
      }
    },

    blossom: {
      land: 0x9fcf8a, landSide: 0x7a5a4a, water: 0x3fa39a, waterSide: 0x1f6f68,
      deep: '#2f8f86', shallow: '#74d6c4', foam: '#fff0f5',
      sky: 0xfbe9ef, flatSky: 0xfdf0f4, skyTop: 0xf3b8d0, skyBottom: 0xfdf0f4, clouds: true,
      hemi: [0xffe6ef, 0x7fae6e, 1.1], sun: [0xfff0e6, 1.25],
      foliage: '#f2a9c4', ground: '#a8d48f', // cherry trees on green grass
      tint: {
        'grass.glb': 0x9fcf8a, 'grass-forest.glb': 0xf2b6cb, 'grass-hill.glb': 0x93c47f,
        'sand.glb': 0xefe3cc, 'sand-desert.glb': 0xf3e8d4, 'sand-rocks.glb': 0xe6d6ba, // raked sand
        'stone.glb': 0xa7a9a4, 'stone-hill.glb': 0x9c9e99, 'stone-rocks.glb': 0xa3a59f,
        'stone-mountain.glb': 0xb9bab4, 'dirt.glb': 0xb58a6a, 'dirt-lumber.glb': 0xa47c5e
      },
      // True reds (roofs, flags) turn sakura pink; orange and brown (dirt roads) stay put.
      atlas: function (h, s, l) {
        if (s > 0.25 && (h < 0.035 || h > 0.94)) return [0.94, s * 0.62, Math.min(0.9, l * 0.7 + 0.3), 0];
        return [h, s, l, 0];
      }
    },

    starlight: {
      land: 0x5b4fb8, landSide: 0x2b2466, water: 0x1a2a6c, waterSide: 0x0d1640,
      deep: '#0d1b4a', shallow: '#2de2e6', foam: '#b9fbff',
      sky: 0x0f1330, flatSky: 0x0d1130, skyTop: 0x070a1e, skyBottom: 0x1e2352, clouds: false,
      hemi: [0x8fa0ff, 0x2a1f5c, 0.95], sun: [0xd8e2ff, 1.25],
      foliage: '#4fe3c1', ground: '#6a5acd', // neon alien flora on violet ground
      stars: true,
      tint: {
        'grass.glb': 0x6a5acd, 'grass-forest.glb': 0x3fd6b5, 'grass-hill.glb': 0x7b6be0,
        'sand.glb': 0xc9a6ff, 'sand-desert.glb': 0xd6b8ff, 'sand-rocks.glb': 0xb896f0,
        'stone.glb': 0x6f7fa8, 'stone-hill.glb': 0x6878a0, 'stone-rocks.glb': 0x7385b0,
        'stone-mountain.glb': 0x8a9bd1, 'dirt.glb': 0x8e6fc9, 'dirt-lumber.glb': 0x7d61b5
      },
      // Warm colours swing to cyan and violet, and everything dims a little — sci-fi panels.
      atlas: function (h, s, l) {
        if (s > 0.2) return [(h + 0.55) % 1, Math.min(1, s * 1.1), l * 0.82, 0];
        return [h, s, l * 0.85, 0.03];
      }
    }
  };

  // Recolour an atlas image with a theme's transform. Returns a canvas the same size.
  // `blueShift` (4th value from the transform) nudges the result toward blue.
  function recolorAtlas(image, transform) {
    var canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    var ctx = canvas.getContext('2d');
    ctx.drawImage(image, 0, 0);
    if (!transform) return canvas;
    var data = ctx.getImageData(0, 0, canvas.width, canvas.height);
    var px = data.data;
    for (var i = 0; i < px.length; i += 4) {
      var hsl = rgbToHsl(px[i] / 255, px[i + 1] / 255, px[i + 2] / 255);
      var out = transform(hsl[0], hsl[1], hsl[2]);
      var rgb = hslToRgb(out[0], Math.max(0, Math.min(1, out[1])), Math.max(0, Math.min(1, out[2])));
      var blue = out[3] || 0;
      px[i] = Math.round(255 * Math.max(0, rgb[0] - blue));
      px[i + 1] = Math.round(255 * rgb[1]);
      px[i + 2] = Math.round(255 * Math.min(1, rgb[2] + blue));
    }
    ctx.putImageData(data, 0, 0);
    return canvas;
  }

  function get(id) {
    return THEMES[id] || THEMES.meadow;
  }

  MI.world.themes = { get: get, ids: Object.keys(THEMES), recolorAtlas: recolorAtlas };
})();
