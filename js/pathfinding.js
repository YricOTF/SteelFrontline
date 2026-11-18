"use strict";

const WALK_STEPS = [
  [-1, 0, 1], [1, 0, 1], [0, -1, 1], [0, 1, 1],
  [-1, -1, Math.SQRT2], [1, -1, Math.SQRT2],
  [-1, 1, Math.SQRT2], [1, 1, Math.SQRT2],
];

class PathQueue {
  constructor() {
    this.items = [];
  }

  push(item) {
    const items = this.items;
    let i = items.length;
    items.push(item);
    while (i > 0) {
      const parent = (i - 1) >>> 1;
      if (items[parent].priority <= item.priority) break;
      items[i] = items[parent];
      i = parent;
    }
    items[i] = item;
  }

  pop() {
    const items = this.items;
    const first = items[0];
    const last = items.pop();
    if (!items.length) return first;
    let i = 0;
    while (2 * i + 1 < items.length) {
      const left = 2 * i + 1;
      const right = left + 1;
      const child = right < items.length && items[right].priority < items[left].priority ? right : left;
      if (last.priority <= items[child].priority) break;
      items[i] = items[child];
      i = child;
    }
    items[i] = last;
    return first;
  }
}

function cellWalkable(g, x, y, type) {
  if (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H) return false;
  const terrain = g.terrain[y * MAP_W + x];
  return Boolean(TERRAIN[terrain].pass || (terrain === T_MOUNT && type && type !== 'arm'));
}

function nearestWalkableCell(x, y, walkable) {
  if (walkable(x, y)) return { x, y };
  for (let r = 1; r < 8; r++) {
    let closest = null;
    let best = Infinity;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        if (!walkable(x + dx, y + dy)) continue;
        const distance = dx * dx + dy * dy;
        if (distance >= best) continue;
        best = distance;
        closest = { x: x + dx, y: y + dy };
      }
    }
    if (closest) return closest;
  }
  return null;
}

function movementCost(g, x, y, type) {
  const wx = (x + 0.5) * CELL;
  const wy = (y + 0.5) * CELL;
  const terrain = g.terrain[y * MAP_W + x];
  let speed = speedAt(g, wx, wy, type);
  if (type === 'arm' && terrain === T_FOREST) speed *= 0.5;
  if (terrain !== T_ROAD && terrain !== T_BRIDGE) speed *= g.weather.offRoadSpeed;
  return battlefieldRoutePenalty(g, wx, wy, terrain) / speed;
}

function findPath(g, sx, sy, tx, ty, type, side) {
  const walkable = (x, y) => cellWalkable(g, x, y, type) &&
    (side !== 'def' || !isDefForbiddenArea(g, (x + 0.5) * CELL, (y + 0.5) * CELL));
  const startX = clamp(Math.floor(sx / CELL), 0, MAP_W - 1);
  const startY = clamp(Math.floor(sy / CELL), 0, MAP_H - 1);
  const targetX = clamp(Math.floor(tx / CELL), 0, MAP_W - 1);
  const targetY = clamp(Math.floor(ty / CELL), 0, MAP_H - 1);
  const goal = nearestWalkableCell(targetX, targetY, walkable);
  if (!goal) return null;
  const goalPoint = walkable(Math.floor(tx / CELL), Math.floor(ty / CELL)) &&
    (side !== 'def' || !isDefForbiddenArea(g, tx, ty))
    ? { x: tx, y: ty }
    : { x: (goal.x + 0.5) * CELL, y: (goal.y + 0.5) * CELL };
  const start = startY * MAP_W + startX;
  const end = goal.y * MAP_W + goal.x;
  if (start === end) return [goalPoint];

  const scores = new Float64Array(g.terrain.length).fill(Infinity);
  const cameFrom = new Int32Array(g.terrain.length).fill(-1);
  const open = new PathQueue();
  const heuristic = (x, y) => {
    const dx = Math.abs(x - goal.x);
    const dy = Math.abs(y - goal.y);
    return (Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy)) / TERRAIN[T_ROAD].spd;
  };
  scores[start] = 0;
  open.push({ cell: start, cost: 0, priority: heuristic(startX, startY) });

  while (open.items.length) {
    const current = open.pop();
    if (current.cost !== scores[current.cell]) continue;
    if (current.cell === end) {
      const path = [goalPoint];
      for (let cell = cameFrom[end]; cell !== start; cell = cameFrom[cell]) {
        path.push({ x: (cell % MAP_W + 0.5) * CELL, y: (Math.floor(cell / MAP_W) + 0.5) * CELL });
      }
      return path.reverse();
    }
    const x = current.cell % MAP_W;
    const y = Math.floor(current.cell / MAP_W);
    for (const [dx, dy, distance] of WALK_STEPS) {
      const nx = x + dx;
      const ny = y + dy;
      if (!walkable(nx, ny)) continue;
      if (dx && dy && (!walkable(nx, y) || !walkable(x, ny))) continue;
      const i = ny * MAP_W + nx;
      const cost = current.cost + distance * movementCost(g, nx, ny, type);
      if (cost >= scores[i]) continue;
      scores[i] = cost;
      cameFrom[i] = current.cell;
      open.push({ cell: i, cost, priority: cost + heuristic(nx, ny) });
    }
  }
  return null;
}

/* Visit each cell along a segment, including the two sides of an exact corner. */
function traceCells(x1, y1, x2, y2, visit) {
  let x = Math.floor(x1 / CELL);
  let y = Math.floor(y1 / CELL);
  const endX = Math.floor(x2 / CELL);
  const endY = Math.floor(y2 / CELL);
  const dx = x2 - x1;
  const dy = y2 - y1;
  const stepX = Math.sign(dx);
  const stepY = Math.sign(dy);
  const dtX = dx ? CELL / Math.abs(dx) : Infinity;
  const dtY = dy ? CELL / Math.abs(dy) : Infinity;
  let nextX = dx ? (((x + (dx > 0 ? 1 : 0)) * CELL) - x1) / dx : Infinity;
  let nextY = dy ? (((y + (dy > 0 ? 1 : 0)) * CELL) - y1) / dy : Infinity;
  while (x !== endX || y !== endY) {
    if (x === endX) nextX = Infinity;
    if (y === endY) nextY = Infinity;
    if (Math.abs(nextX - nextY) < 1e-9) {
      if (!visit(x + stepX, y) || !visit(x, y + stepY)) return false;
      x += stepX;
      y += stepY;
      nextX += dtX;
      nextY += dtY;
    } else if (nextX < nextY) {
      x += stepX;
      nextX += dtX;
    } else {
      y += stepY;
      nextY += dtY;
    }
    if (!visit(x, y)) return false;
  }
  return true;
}

function hasLOS(g, x1, y1, x2, y2) {
  const goalX = Math.floor(x2 / CELL);
  const goalY = Math.floor(y2 / CELL);
  return traceCells(x1, y1, x2, y2, (x, y) => {
    if (x === goalX && y === goalY) return true;
    const terrain = g.terrain[y * MAP_W + x];
    return terrain !== T_MOUNT && terrain !== T_BUILDING;
  });
}

function smoothPath(g, path, sx, sy, type, side) {
  if (!path || path.length < 2) return path;
  const result = [];
  let x = sx;
  let y = sy;
  for (let i = 0; i < path.length;) {
    let last = i;
    const terrain = terrainAt(g, path[i].x, path[i].y);
    const routePenalty = battlefieldRoutePenalty(g,
      (Math.floor(path[i].x / CELL) + 0.5) * CELL,
      (Math.floor(path[i].y / CELL) + 0.5) * CELL, terrain);
    for (let j = i + 1; j < Math.min(path.length, i + 14); j++) {
      const point = path[j];
      if (terrainAt(g, point.x, point.y) !== terrain) break;
      const clear = traceCells(x, y, point.x, point.y, (cx, cy) =>
        cellWalkable(g, cx, cy, type) && g.terrain[cy * MAP_W + cx] === terrain &&
          battlefieldRoutePenalty(g, (cx + 0.5) * CELL, (cy + 0.5) * CELL, terrain) === routePenalty
      );
      if (!clear) continue;
      if (side === 'def') {
        const dx = point.x - x;
        const dy = point.y - y;
        const protectedPath = g.forbiddenCenters.some(center => {
          const t = clamp(((center.x - x) * dx + (center.y - y) * dy) / Math.max(dx * dx + dy * dy, 1), 0, 1);
          const radius = g.forbiddenRadius || DEF_FORBIDDEN_RADIUS;
          return dist2(x + t * dx, y + t * dy, center.x, center.y) < radius ** 2;
        });
        if (protectedPath) continue;
      }
      last = j;
    }
    const point = path[last];
    result.push(point);
    x = point.x;
    y = point.y;
    i = last + 1;
  }
  return result;
}
