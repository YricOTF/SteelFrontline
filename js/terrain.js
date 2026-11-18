"use strict";

const TERRAIN_PALETTES = TERRAIN.map(({ c1, c2 }) => {
  const unpack = color => [1, 3, 5].map(offset => parseInt(color.slice(offset, offset + 2), 16));
  const dark = unpack(c1);
  const light = unpack(c2);
  return Array.from({ length: 17 }, (_, i) =>
    'rgb(' + dark.map((channel, n) => Math.round(lerp(channel, light[n], i / 16))).join(',') + ')'
  );
});

function terrainColor(type, x, y) {
  const value = vnoise(x * 0.19, y * 0.19, type + 17) * 0.85 + hash2(x, y, type + 31) * 0.15;
  return TERRAIN_PALETTES[type][Math.round(value * 16)];
}

function invalidateTerrain(g) {
  g.terrainCanvas = null;
  g.terrainRevision++;
}

function paintTerrainBase(painter, terrain, width, height) {
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      painter.fillStyle = terrainColor(terrain[y * width + x], x, y);
      painter.fillRect(x * CELL, y * CELL, CELL, CELL);
    }
  }
}

function paintTerrainDetails(painter, terrain, width, height) {
  const high = CFG.quality === 'high';
  const tileAt = (x, y) => x >= 0 && y >= 0 && x < width && y < height ? terrain[y * width + x] : -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const type = tileAt(x, y);
      const px = x * CELL;
      const py = y * CELL;
      if (type !== T_WATER && type !== T_BRIDGE) {
        painter.fillStyle = 'rgba(183,169,122,.30)';
        if (tileAt(x - 1, y) === T_WATER) painter.fillRect(px, py, 3, CELL);
        if (tileAt(x + 1, y) === T_WATER) painter.fillRect(px + CELL - 3, py, 3, CELL);
        if (tileAt(x, y - 1) === T_WATER) painter.fillRect(px, py, CELL, 3);
        if (tileAt(x, y + 1) === T_WATER) painter.fillRect(px, py + CELL - 3, CELL, 3);
      }
      if (type === T_FOREST) {
        for (let i = 0; i < (high ? 5 : 3); i++) {
          const tx = px + 3 + hash2(x * 5 + i, y, 31) * (CELL - 6);
          const ty = py + 3 + hash2(x, y * 5 + i, 47) * (CELL - 6);
          const radius = 4 + hash2(x * 7 + i, y * 3, 73) * 6;
          painter.beginPath();
          painter.ellipse(tx + 4, ty + 4, radius * 1.25, radius * 0.8, 0.55, 0, Math.PI * 2);
          painter.fillStyle = 'rgba(12,22,17,.45)';
          painter.fill();
          painter.beginPath();
          painter.arc(tx, ty, radius, 0, Math.PI * 2);
          painter.fillStyle = hash2(x + i, y, 36) > 0.5 ? '#30493a' : '#3c5140';
          painter.fill();
          painter.beginPath();
          painter.ellipse(tx - 2, ty - 2, radius * 0.62, radius * 0.47, -0.4, 0, Math.PI * 2);
          painter.fillStyle = 'rgba(141,155,105,.20)';
          painter.fill();
        }
      } else if (type === T_MOUNT) {
        const peakX = px + 9 + hash2(x, y, 21) * 13;
        const peakY = py + 2 + hash2(x, y, 43) * 7;
        painter.beginPath();
        painter.moveTo(px, py + CELL - 3);
        painter.lineTo(peakX, peakY);
        painter.lineTo(px + CELL + 2, py + CELL);
        painter.closePath();
        painter.fillStyle = '#555950';
        painter.fill();
        painter.beginPath();
        painter.moveTo(px + 2, py + CELL - 5);
        painter.lineTo(peakX, peakY);
        painter.lineTo(peakX + 3, py + CELL - 2);
        painter.closePath();
        painter.fillStyle = hash2(x, y, 50) > 0.55 ? '#898576' : '#747567';
        painter.fill();
      } else if (type === T_BUILDING) {
        const insetX = 3 + hash2(x, y, 11) * 6;
        const insetY = 3 + hash2(x, y, 29) * 5;
        const w = CELL - insetX * 2;
        const h = CELL - insetY * 2;
        painter.fillStyle = 'rgba(18,22,18,.44)';
        painter.fillRect(px + insetX + 5, py + insetY + 5, w, h);
        painter.fillStyle = hash2(x, y, 52) > 0.5 ? '#727469' : '#7d7465';
        painter.fillRect(px + insetX, py + insetY, w, h);
        painter.fillStyle = 'rgba(236,231,199,.20)';
        painter.fillRect(px + insetX, py + insetY, w, 2);
        painter.fillStyle = 'rgba(26,30,24,.33)';
        painter.fillRect(px + insetX + w * 0.55, py + insetY + 2, w * 0.45, h - 2);
      } else if (type === T_BRIDGE || type === T_ROAD) {
        const bridge = type === T_BRIDGE;
        painter.fillStyle = bridge ? 'rgba(24,30,24,.38)' : 'rgba(44,38,26,.22)';
        if (tileAt(x - 1, y) !== type) painter.fillRect(px, py, bridge ? 3 : 2, CELL);
        if (tileAt(x + 1, y) !== type) painter.fillRect(px + CELL - 2, py, 2, CELL);
        if (tileAt(x, y - 1) !== type) painter.fillRect(px, py, CELL, 2);
        if (tileAt(x, y + 1) !== type) painter.fillRect(px, py + CELL - 2, CELL, 2);
        painter.fillStyle = bridge ? 'rgba(35,29,23,.28)' : 'rgba(230,209,157,.18)';
        if (bridge) {
          for (let k = 4; k < CELL; k += 8) painter.fillRect(px + 2, py + k, CELL - 4, 1);
        } else {
          const horizontal = tileAt(x - 1, y) === T_ROAD || tileAt(x + 1, y) === T_ROAD;
          if (horizontal) painter.fillRect(px + 9, py + 15, 14, 1);
          else painter.fillRect(px + 15, py + 9, 1, 14);
        }
      } else if (type === T_WATER) {
        const glint = hash2(x, y, 12);
        painter.fillStyle = 'rgba(153,203,199,.12)';
        painter.fillRect(px + 4 + glint * 11, py + 5 + hash2(x, y, 34) * 21, 4 + glint * 13, 1);
      } else if (type === T_CRATER) {
        painter.beginPath();
        painter.ellipse(px + 16, py + 16, 15, 10, hash2(x, y, 97), 0, Math.PI * 2);
        painter.fillStyle = 'rgba(27,24,20,.34)';
        painter.fill();
      } else if (type === T_RUBBLE || type === T_PLAIN || high) {
        painter.fillStyle = type === T_RUBBLE ? 'rgba(172,156,127,.32)' : 'rgba(218,208,158,.12)';
        for (let i = 0; i < (type === T_RUBBLE ? 7 : (high ? 5 : 3)); i++) {
          const tx = px + hash2(x * 11 + i, y, 79) * (CELL - 3);
          const ty = py + hash2(x, y * 13 + i, 31) * (CELL - 3);
          painter.fillRect(tx, ty, 2 + hash2(x, y, i) * 4, 1.2);
        }
      }
    }
  }
}

function buildTerrainCanvas(g) {
  g._lastTerrainTry = g.time;
  try {
    const canvas = document.createElement('canvas');
    const width = MAP_W * CELL;
    const height = MAP_H * CELL;
    const scale = Math.min(CFG.quality === 'low' ? 0.5 : 1, 4096 / Math.max(width, height));
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    const painter = canvas.getContext('2d', { alpha: false });
    if (!painter) return;
    painter.scale(scale, scale);
    paintTerrainBase(painter, g.terrain, MAP_W, MAP_H);
    if (CFG.quality !== 'low') paintTerrainDetails(painter, g.terrain, MAP_W, MAP_H);
    g.terrainCanvas = canvas;
  } catch (error) {
    console.warn('战场纹理缓存无法建立', error);
    g.terrainCanvas = null;
  }
}
