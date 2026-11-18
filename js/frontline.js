"use strict";

const WEATHER = {
  clear: { name: '晴朗', visibility: 1, offRoadSpeed: 1 },
  overcast: { name: '阴天', visibility: 0.95, offRoadSpeed: 1 },
  rain: { name: '阵雨', visibility: 0.88, offRoadSpeed: 0.86 },
  fog: { name: '低雾', visibility: 0.75, offRoadSpeed: 1 },
};

const SUPPLY_RADIUS = { hq: 325, branch: 270, point: 225, landing: 285 };

function updateSupplyNodes(g) {
  if (!g.frontline) return;
  const nodes = { atk: [], def: [] };
  for (const point of g.deployPoints) {
    const post = g.posts[point.postId];
    if (post) {
      const attackers = post._atkP || 0;
      const defenders = post._defP || 0;
      const friendly = point.side === 'atk' ? attackers : defenders;
      const hostile = point.side === 'atk' ? defenders : attackers;
      if (hostile > 0 && hostile >= friendly) continue;
    }
    nodes[point.side].push({
      x: point.x,
      y: point.y,
      radius: SUPPLY_RADIUS[post?.type || 'landing'],
    });
  }
  g.supplies = nodes;
}

function supplyAt(g, unit) {
  const terrain = terrainAt(g, unit.x, unit.y);
  const roadBonus = terrain === T_ROAD || terrain === T_BRIDGE ? 1.2 : 1;
  return g.supplies[unit.side].some(node =>
    dist2(unit.x, unit.y, node.x, node.y) <= (node.radius * roadBonus) ** 2
  );
}

function updateReadiness(g, unit, dt) {
  if (!g.frontline) return;
  const supplied = supplyAt(g, unit);
  if (supplied) {
    unit.supply = Math.min(1, unit.supply + dt * 0.085);
    if (unit.supply >= 0.85) unit._resupplying = false;
    if (unit.order?.resupply) {
      unit.order = null;
      unit.path = null;
    }
  } else if (unit.order?.type === 'move') {
    const consumption = unit.type === 'arm' ? 0.0055 : 0.0035;
    unit.supply = Math.max(0, unit.supply - dt * consumption);
  }

  const inCover = coverAt(g, unit.x, unit.y) > 0 ||
    g.trenches.some(trench =>
      trench.side === unit.side &&
      dist2(trench.x, trench.y, unit.x, unit.y) < trench.r ** 2
    );
  const recovery = (inCover ? 0.18 : 0.10) + (unit.holdPost ? 0.035 : 0);
  unit.suppression = Math.max(0, unit.suppression - recovery * dt);
}

function resupplyUnits(g, units) {
  let assigned = 0;
  for (const unit of units) {
    if (!unit.alive) continue;
    if (supplyAt(g, unit)) {
      unit.order = null;
      unit.path = null;
      unit.tid = 0;
      unit._resupplying = true;
      assigned++;
      continue;
    }
    const nodes = g.supplies[unit.side].slice().sort((a, b) =>
      dist2(unit.x, unit.y, a.x, a.y) - dist2(unit.x, unit.y, b.x, b.y)
    );
    for (const node of nodes) {
      const route = findPath(g, unit.x, unit.y, node.x, node.y, unit.type, unit.side);
      if (!route) continue;
      const goal = route.at(-1);
      if (dist2(goal.x, goal.y, node.x, node.y) > node.radius ** 2) continue;
      unit.order = { type: 'move', x: goal.x, y: goal.y, resupply: true };
      unit.path = smoothPath(g, route, unit.x, unit.y, unit.type, unit.side);
      unit.pathI = 0;
      unit.holdPost = 0;
      unit.tid = 0;
      unit._resupplying = true;
      assigned++;
      break;
    }
  }
  return assigned;
}

function readyToResume(g, unit) {
  if (!g.frontline || !unit._resupplying) return true;
  const supplied = supplyAt(g, unit);
  if ((supplied && unit.supply >= 0.85) || (!supplied && !unit.order?.resupply)) {
    unit._resupplying = false;
  }
  return !unit._resupplying;
}

function requestResupply(g) {
  if (!g.frontline || g.state !== 'playing') return;
  const units = g.selection.filter(unit => unit.alive);
  if (!units.length) {
    toast(g, '请先选中需要补给的部队', 'bad');
    return;
  }
  const assigned = resupplyUnits(g, units);
  if (assigned) {
    Snd.order();
    toast(g, assigned + ' 支部队正在补给', 'good');
  } else {
    toast(g, '没有可抵达的补给点', 'bad');
  }
}

function crossesSmoke(g, x1, y1, x2, y2) {
  if (!g.smokes.length) return false;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= 26 ** 2) return false;
  return g.smokes.some(smoke => {
    const t = clamp(((smoke.x - x1) * dx + (smoke.y - y1) * dy) / lengthSquared, 0, 1);
    return dist2(smoke.x, smoke.y, x1 + t * dx, y1 + t * dy) < smoke.radius ** 2;
  });
}
