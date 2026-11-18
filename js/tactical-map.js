"use strict";

const minimap = document.getElementById('minimap');
const miniCtx = minimap.getContext('2d', { alpha: false });
const mapControl = document.getElementById('minimapControl');

function terrainOverview(terrain, width, height) {
  const image = document.createElement('canvas');
  image.width = width;
  image.height = height;
  const painter = image.getContext('2d');
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      painter.fillStyle = terrainColor(terrain[y * width + x], x, y);
      painter.fillRect(x, y, 1, 1);
    }
  }
  return image;
}

function fogLayer(g) {
  const visibility = g.vis[g.playerSide];
  if (g.fog?.visibility === visibility) return g.fog.canvas;
  const canvas = g.fog?.canvas ?? document.createElement('canvas');
  canvas.width = MAP_W;
  canvas.height = MAP_H;
  const painter = canvas.getContext('2d');
  const pixels = painter.createImageData(MAP_W, MAP_H);
  const explored = g.explored[g.playerSide];
  for (let i = 0; i < visibility.length; i++) {
    const offset = i * 4;
    pixels.data[offset] = 7;
    pixels.data[offset + 1] = 14;
    pixels.data[offset + 2] = 18;
    pixels.data[offset + 3] = visibility[i] ? 0 : (explored[i] ? 64 : 112);
  }
  painter.putImageData(pixels, 0, 0);
  g.fog = { visibility, canvas };
  return canvas;
}

function drawTacticalMap(g) {
  if (mapControl.closest('.tactical-map').classList.contains('collapsed')) return;
  const width = minimap.clientWidth;
  const height = minimap.clientHeight;
  if (!width || !height) return;
  const dw = Math.round(width * DPR);
  const dh = Math.round(height * DPR);
  if (minimap.width !== dw || minimap.height !== dh) {
    minimap.width = dw;
    minimap.height = dh;
  }
  if (g.overview?.revision !== g.terrainRevision) {
    g.overview = {
      revision: g.terrainRevision,
      canvas: terrainOverview(g.terrain, MAP_W, MAP_H),
    };
  }
  const worldWidth = MAP_W * CELL;
  const worldHeight = MAP_H * CELL;
  const sx = dw / worldWidth;
  const sy = dh / worldHeight;

  miniCtx.drawImage(g.overview.canvas, 0, 0, dw, dh);
  miniCtx.drawImage(fogLayer(g), 0, 0, dw, dh);
  for (const post of g.posts) {
    const x = post.x * sx;
    const y = post.y * sy;
    const radius = (post.type === 'hq' ? 3.5 : 2.1) * DPR;
    miniCtx.fillStyle = post._disabled ? '#6d6d62' : TEAM_COLORS[post.owner];
    miniCtx.strokeStyle = '#111714';
    miniCtx.lineWidth = DPR;
    miniCtx.beginPath();
    miniCtx.rect(x - radius, y - radius, radius * 2, radius * 2);
    miniCtx.fill();
    miniCtx.stroke();
  }

  for (const unit of g.units) {
    if (!unit.alive || (unit.side !== g.playerSide && !visible(g, g.playerSide, unit.x, unit.y))) continue;
    miniCtx.fillStyle = TEAM_COLORS[unit.side];
    miniCtx.beginPath();
    miniCtx.arc(unit.x * sx, unit.y * sy, (unit.side === g.playerSide ? 1.25 : 1.45) * DPR, 0, Math.PI * 2);
    miniCtx.fill();
  }

  const x = g.cam.x * sx;
  const y = g.cam.y * sy;
  const boxWidth = W * sx / g.cam.zoom;
  const boxHeight = H * sy / g.cam.zoom;
  miniCtx.strokeStyle = '#e9d9a8';
  miniCtx.lineWidth = DPR;
  miniCtx.strokeRect(x - boxWidth / 2, y - boxHeight / 2, boxWidth, boxHeight);
}

function focusBattleStart(g) {
  const point = g.playerSide === 'atk' ? g.atkSpawnPoints[0] :
    g.posts.find(post => post.type === 'hq' && post.owner === 'def');
  if (!point) return;
  g.cam.x = point.x;
  g.cam.y = point.y;
}

function setupTacticalMap() {
  new ResizeObserver(() => {
    document.getElementById('hud').style.setProperty('--deck-offset', (el.bottomBar.offsetHeight + 36) + 'px');
  }).observe(el.bottomBar);
  const pan = event => {
    if (G?.state !== 'playing') return;
    const bounds = minimap.getBoundingClientRect();
    G.cam.x = clamp((event.clientX - bounds.left) / bounds.width, 0, 1) * MAP_W * CELL;
    G.cam.y = clamp((event.clientY - bounds.top) / bounds.height, 0, 1) * MAP_H * CELL;
    clampCam(G);
    if (G.tutorial) G.tutorial.lastEv = { type: 'cam' };
  };
  mapControl.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    mapControl.setPointerCapture(event.pointerId);
    pan(event);
  });
  mapControl.addEventListener('pointermove', event => {
    if (mapControl.hasPointerCapture(event.pointerId)) pan(event);
  });
  mapControl.addEventListener('click', event => {
    if (event.detail === 0 && G?.state === 'playing') {
      focusBattleStart(G);
      clampCam(G);
    }
  });
  document.getElementById('mapToggle').addEventListener('click', event => {
    const collapsed = mapControl.closest('.tactical-map').classList.toggle('collapsed');
    event.currentTarget.setAttribute('aria-expanded', String(!collapsed));
    event.currentTarget.lastElementChild.textContent = collapsed ? '+' : '−';
  });
  document.getElementById('supplyToggle').addEventListener('click', event => {
    if (!G?.frontline) return;
    G.showSupply = !G.showSupply;
    event.currentTarget.setAttribute('aria-pressed', String(G.showSupply));
  });
  document.getElementById('rtSupply').addEventListener('click', () => {
    if (G) requestResupply(G);
  });
}

function drawMapPreview(canvas, mapDef) {
  const map = generateMap(mapDef, 2417);
  const painter = canvas.getContext('2d', { alpha: false });
  const terrain = terrainOverview(map.terrain, map.mapW, map.mapH);
  const width = canvas.width;
  const height = canvas.height;
  painter.imageSmoothingEnabled = false;
  painter.drawImage(terrain, 0, 0, width, height);
  for (const point of [...map.posts, ...map.spawns]) {
    const x = (point.x + 0.5) * width / map.mapW;
    const y = (point.y + 0.5) * height / map.mapH;
    const radius = point.type === 'hq' ? 10 : 5;
    painter.fillStyle = point.type ? TEAM_COLORS.def : TEAM_COLORS.atk;
    painter.strokeStyle = '#161b17';
    painter.lineWidth = 2;
    painter.beginPath();
    painter.rect(x - radius, y - radius, radius * 2, radius * 2);
    painter.fill();
    painter.stroke();
  }
}
