"use strict";

const BATTLEFIELD_EVENTS = {
  volcano: {
    name: '火山喷发', hint: '灰区视野缩短，内圈灼伤', brief: '灰区视野缩短，内圈持续受灼伤。可沿另一侧鞍道和环岸公路绕行。',
    warning: 30, duration: 54, speed: 0.83, visibility: 0.62, dps: 2.5, core: 0.46,
    color: '#eea377', scar: 'crater', smoke: true,
  },
  rockfall: {
    name: '山谷落石', hint: '隘口减速，内圈受伤', brief: '碎石拖慢隘口通行，落石内圈会造成伤害。谷底横路可转向另一侧隘口。',
    warning: 25, duration: 39, speed: 0.5, visibility: 0.92, dps: 1.45, core: 0.38,
    color: '#e2bd88', scar: 'debris',
  },
  wildfire: {
    name: '林带山火', hint: '烟区视野缩短，内圈林地灼伤', brief: '烟区视野缩短，内圈林地持续受灼伤。沿开阔道路可越过火线。',
    warning: 30, duration: 60, speed: 0.88, visibility: 0.69, dps: 2.65, core: 0.76,
    color: '#ed985f', scar: 'forest', fireOnForest: true, smoke: true,
  },
  oilfire: {
    name: '储油区事故', hint: '内圈起火，烟区视野缩短', brief: '油罐受波及时会提前预警。储油区内圈起火，部队可撤入街巷或转入外环。',
    warning: 24, duration: 46, speed: 0.77, visibility: 0.67, dps: 3.2, core: 0.64,
    color: '#f3a473', scar: 'industrial', smoke: true,
  },
  flood: {
    name: '上游涨水', hint: '漫滩、引道和浅滩减速', brief: '漫滩与引道通行变慢，架高桥面可照常通过。水位回落后恢复速度。',
    warning: 32, duration: 55, speed: 0.52, visibility: 0.96, dps: 0,
    color: '#83c4ed', bridgeShelter: true,
  },
  storm: {
    name: '河谷风暴', hint: '风暴移动，越野与视野受限', brief: '风暴沿河谷移动，压低视野并拖慢越野。可沿干线继续转移。',
    warning: 32, duration: 85, speed: 0.72, visibility: 0.58, dps: 0,
    color: '#a7b9ef', roadShelter: true, smoke: true,
  },
};

const EVENT_STORE_FIELDS = ['kind', 'phase', 'name', 'x', 'y', 'radius', 'destination', 'warnAt', 'startsAt', 'endsAt'];

function prepareBattlefieldEvent(g, map) {
  const kind = g.mapDef.event;
  const sites = map.eventSites;
  const profile = BATTLEFIELD_EVENTS[kind];
  if (!profile || !sites?.length) return null;
  const seed = g.cfg.seed;
  const site = sites[Math.floor(hash2(seed, map.mapW, 8107) * sites.length)];
  const warnAt = Math.round(g.duration * lerp(kind === 'oilfire' ? 0.50 : 0.31, kind === 'oilfire' ? 0.63 : 0.48,
    hash2(map.mapH, seed, 12503)));
  const startsAt = warnAt + profile.warning;
  const endsAt = startsAt + profile.duration * (kind === 'wildfire' && g.cfg.weather === 'rain' ? 0.75 : 1);
  return {
    kind, phase: 'scheduled', name: site.name,
    x: (site.x + 0.5) * CELL, y: (site.y + 0.5) * CELL, radius: site.radius * CELL,
    destination: site.to ? { x: (site.to[0] + 0.5) * CELL, y: (site.to[1] + 0.5) * CELL } : null,
    warnAt, startsAt, endsAt,
  };
}

function battlefieldEventArea(event, time) {
  const progress = event.destination && event.phase === 'active'
    ? clamp((time - event.startsAt) / (event.endsAt - event.startsAt), 0, 1) : 0;
  return {
    x: lerp(event.x, event.destination?.x ?? event.x, progress),
    y: lerp(event.y, event.destination?.y ?? event.y, progress),
    r: event.radius,
    profile: BATTLEFIELD_EVENTS[event.kind],
  };
}

function syncBattlefieldEventArea(g) {
  const event = g.battlefieldEvent;
  g.eventArea = event?.phase === 'active' ? battlefieldEventArea(event, g.time) : null;
}

function withinEventArea(area, x, y, scale = 1) {
  return area && dist2(x, y, area.x, area.y) < (area.r * scale) ** 2;
}

function battlefieldSpeed(g, x, y, terrain) {
  const area = g.eventArea;
  if (!withinEventArea(area, x, y)) return 1;
  const profile = area.profile;
  if ((profile.roadShelter || profile.bridgeShelter) && terrain === T_BRIDGE) return 1;
  if (profile.roadShelter && terrain === T_ROAD) return 1;
  return profile.speed;
}

function battlefieldVisibility(g, x, y) {
  return withinEventArea(g.eventArea, x, y) ? g.eventArea.profile.visibility : 1;
}

function eventDamageAt(area, x, y, terrain) {
  if (!area?.profile.dps || !withinEventArea(area, x, y, area.profile.core)) return 0;
  if (area.profile.fireOnForest && terrain !== T_FOREST) return 0;
  const distanceRatio = dist(x, y, area.x, area.y) / (area.r * area.profile.core);
  return area.profile.dps * lerp(1, 0.45, distanceRatio);
}

function battlefieldRoutePenalty(g, x, y, terrain) {
  return 1 / battlefieldSpeed(g, x, y, terrain) + eventDamageAt(g.eventArea, x, y, terrain) * 0.45;
}

function announceBattlefieldEvent(g) {
  const event = g.battlefieldEvent;
  const profile = event && BATTLEFIELD_EVENTS[event.kind];
  if (!profile) return;
  if (event.phase === 'warning') {
    toast(g, event.name + ' · ' + profile.name + '预警', 'bad');
    Snd.eventAlert();
  } else if (event.phase === 'active') {
    toast(g, event.name + ' · ' + profile.name + '发生', 'bad');
  } else if (event.phase === 'ended') {
    toast(g, profile.name + '结束 · ' + event.name + '险情解除', 'good');
  }
}

function checkOilTankImpact(g, x, y, radius) {
  const event = g.battlefieldEvent;
  if (event?.kind !== 'oilfire' || event.phase !== 'scheduled') return;
  if (!g._oilTanks.some(tank => tank.alive && dist2(tank.x, tank.y, x, y) <= (radius + tank.r) ** 2)) return;
  const profile = BATTLEFIELD_EVENTS.oilfire;
  event.warnAt = g.time;
  event.startsAt = g.time + profile.warning;
  event.endsAt = event.startsAt + profile.duration;
  event.phase = 'warning';
  announceBattlefieldEvent(g);
}

function affectEventTerrain(g, event, area) {
  const profile = BATTLEFIELD_EVENTS[event.kind];
  if (!profile.scar) return;
  let changed = false;
  const tx = Math.floor(area.x / CELL);
  const ty = Math.floor(area.y / CELL);
  const cells = Math.ceil(area.r / CELL);
  for (let y = Math.max(0, ty - cells); y < Math.min(MAP_H, ty + cells + 1); y++) {
    for (let x = Math.max(0, tx - cells); x < Math.min(MAP_W, tx + cells + 1); x++) {
      const i = y * MAP_W + x;
      const before = g.terrain[i];
      if (isWaterway(before) || before === T_ROAD || before === T_MOUNT) continue;
      const wx = (x + 0.5) * CELL;
      const wy = (y + 0.5) * CELL;
      const core = withinEventArea(area, wx, wy, profile.core || 0.4);
      if (!core || inAtkSafeZone(g, wx, wy) || g.posts.some(post => dist2(post.x, post.y, wx, wy) < (2.5 * CELL) ** 2)) continue;
      if (profile.scar === 'forest' && before !== T_FOREST) continue;
      const after = profile.scar === 'crater' && before !== T_BUILDING ? T_CRATER : T_RUBBLE;
      if (after === before) continue;
      g.terrain[i] = after;
      changed = true;
    }
  }
  if (changed) invalidateTerrain(g);
}

function rerouteNearEvent(g, area) {
  for (const unit of g.units) {
    if (!unit.alive || !unit.path) continue;
    if (withinEventArea(area, unit.x, unit.y, 1.6) ||
        unit.path.slice(unit.pathI).some(point => withinEventArea(area, point.x, point.y, 1.6))) {
      unit.path = null;
      unit.pathI = 0;
    }
  }
}

function activateBattlefieldEvent(g, event) {
  event.phase = 'active';
  syncBattlefieldEventArea(g);
  rerouteNearEvent(g, g.eventArea);
  announceBattlefieldEvent(g);
  if (event.kind === 'oilfire') {
    for (const tank of g._oilTanks) {
      if (!tank.alive || !withinEventArea(g.eventArea, tank.x, tank.y)) continue;
      tank.alive = false;
      addEffect(g, { type: 'boom', x: tank.x, y: tank.y, r: 72, life: 1.5, max: 1.5, public: true });
      Snd.boom(g, tank.x, tank.y, true, g.playerSide);
    }
  } else if (event.kind === 'volcano' || event.kind === 'rockfall') {
    addEffect(g, {
      type: 'boom', x: event.x, y: event.y,
      r: event.radius * g.eventArea.profile.core, life: 1.6, max: 1.6, public: true,
    });
    Snd.boom(g, event.x, event.y, true, g.playerSide);
  }
}

function updateBattlefieldEvent(g, dt) {
  const event = g.battlefieldEvent;
  if (event?.phase === 'scheduled' && g.time >= event.warnAt) {
    event.phase = 'warning';
    announceBattlefieldEvent(g);
  }
  if (event?.phase === 'warning' && g.time >= event.startsAt) activateBattlefieldEvent(g, event);
  if (event?.phase === 'active') {
    if (g.time >= event.endsAt) {
      const area = g.eventArea || battlefieldEventArea(event, g.time);
      affectEventTerrain(g, event, area);
      rerouteNearEvent(g, area);
      event.phase = 'ended';
      g.eventArea = null;
      announceBattlefieldEvent(g);
    } else {
      if (event.destination || !g.eventArea) syncBattlefieldEventArea(g);
      if (g.eventArea.profile.dps) {
        for (const unit of g.units) {
          if (!unit.alive || !withinEventArea(g.eventArea, unit.x, unit.y, g.eventArea.profile.core)) continue;
          const damage = eventDamageAt(g.eventArea, unit.x, unit.y, terrainAt(g, unit.x, unit.y));
          if (damage > 0) applyDamage(g, unit, damage * dt);
        }
      }
    }
  }

  if (g.legacyFire.length) {
    g.legacyFire = g.legacyFire.filter(zone => zone.until > g.time);
    for (const unit of g.units) {
      if (!unit.alive) continue;
      let damage = 0;
      for (const zone of g.legacyFire) {
        if (withinEventArea(zone, unit.x, unit.y)) damage = Math.max(damage, zone.dps);
      }
      if (damage > 0) applyDamage(g, unit, damage * dt);
    }
  }
}

function normalizeBattlefieldEvent(record) {
  if (!record || !Object.hasOwn(BATTLEFIELD_EVENTS, record.kind) ||
      !['scheduled', 'warning', 'active', 'ended'].includes(record.phase) || typeof record.name !== 'string' ||
      ![record.x, record.y, record.radius, record.warnAt, record.startsAt, record.endsAt].every(Number.isFinite) ||
      record.radius <= 0 || record.startsAt < record.warnAt || record.endsAt <= record.startsAt) return null;
  const event = Object.fromEntries(EVENT_STORE_FIELDS.map(field => [field, record[field]]));
  const point = event.destination;
  if (point && ![point.x, point.y].every(Number.isFinite)) event.destination = null;
  return event;
}

function readLegacyFire(g, zones) {
  if (!Array.isArray(zones)) return [];
  return zones.filter(zone => zone && [zone.x, zone.y, zone.r, zone.dps].every(Number.isFinite) && zone.r > 0)
    .map(zone => ({
      x: zone.x, y: zone.y, r: zone.r,
      dps: clamp(zone.dps, 0, 5),
      until: Number.isFinite(zone.until) ? zone.until : g.time + 35,
    }))
    .filter(zone => zone.until > g.time);
}
