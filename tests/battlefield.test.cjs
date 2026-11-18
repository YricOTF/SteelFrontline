"use strict";

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');

const scripts = ['core', 'legacy-maps', 'maps', 'frontline', 'events', 'pathfinding', 'simulation', 'unit-icons']
  .map(name => new vm.Script(readFileSync(join(__dirname, '..', 'js', name + '.js'), 'utf8'), {
    filename: 'js/' + name + '.js',
  }));

function runBattlefieldCheck(check) {
  const context = vm.createContext({
    assert,
    localStorage: { getItem: () => null },
    buildTerrainCanvas() {},
    invalidateTerrain(game) { game.terrainRevision++; },
    Snd: { fire() {}, boom() {}, eventAlert() {} },
    toast() {},
  });
  for (const script of scripts) script.runInContext(context);
  vm.runInContext('(' + check.toString() + ')()', context);
}

test('every landing zone reaches every objective by vehicle on each seeded battlefield', () => {
  runBattlefieldCheck(() => {
    for (const definition of MAPS.filter(map => !map.tutorial)) {
      for (const seed of [0, 19, 2417, 19843, 4294967295]) {
        const map = generateMap(definition, seed);
        const repeat = generateMap(definition, seed);
        assert.equal(String(map.terrain), String(repeat.terrain));
        const index = ({ x, y }) => y * map.mapW + x;
        for (const site of [...map.posts, ...map.spawns, ...map.turrets]) {
          assert.ok(TERRAIN[map.terrain[index(site)]].pass, definition.id + ' has a blocked position');
        }
        for (const spawn of map.spawns) {
          const seen = new Uint8Array(map.terrain.length);
          const queue = [index(spawn)];
          seen[queue[0]] = 1;
          for (let i = 0; i < queue.length; i++) {
            const cell = queue[i];
            const x = cell % map.mapW;
            const y = Math.floor(cell / map.mapW);
            for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
              const nx = x + dx;
              const ny = y + dy;
              if (nx < 0 || nx >= map.mapW || ny < 0 || ny >= map.mapH) continue;
              const next = ny * map.mapW + nx;
              if (seen[next] || !TERRAIN[map.terrain[next]].pass) continue;
              seen[next] = 1;
              queue.push(next);
            }
          }
          for (const post of map.posts) {
            assert.equal(seen[index(post)], 1, definition.id + ' cannot reach ' + post.name);
          }
        }
      }
    }
  });
});

test('rivers require designated crossings and offer another bridge when one lane is closed', () => {
  runBattlefieldCheck(() => {
    for (const id of ['plain', 'river', 'grand']) {
      const game = makeGame({ mapId: id, side: 'atk', diff: 'normal', seed: 19 });
      const home = game.spawnPoint;
      const hq = game.posts.find(post => post.type === 'hq');
      const firstBridge = game.landmarks.find(mark => mark.kind === 'bridge');
      const path = () => findPath(game, home.x, home.y, hq.x, hq.y, 'arm', 'atk');
      assert.ok(path(), id);
      for (let i = 0; i < game.terrain.length; i++) {
        const tile = game.terrain[i];
        const wx = (i % MAP_W + .5) * CELL;
        if (tile === T_FORD || (tile === T_BRIDGE && Math.abs(wx - firstBridge.x) < CELL * 3)) {
          game.terrain[i] = T_WATER;
        }
      }
      assert.ok(path(), id + ' alternate bridge');
      for (let i = 0; i < game.terrain.length; i++) {
        if (game.terrain[i] === T_BRIDGE) game.terrain[i] = T_WATER;
      }
      assert.equal(path(), null, id + ' unintended river crossing');
    }
  });
});

test('all six events warn, take effect and end without disabling objectives', () => {
  runBattlefieldCheck(() => {
    for (const definition of MAPS.filter(map => !map.tutorial)) {
      const game = makeGame({ mapId: definition.id, side: 'atk', diff: 'normal', seed: 2417,
        duration: 900, rules: 'frontline', weather: 'rain' });
      const initial = game.posts.map(post => [post.owner, post.cap]);
      const event = game.battlefieldEvent;
      assert.equal(event.kind, definition.event);
      assert.ok(event.endsAt < game.duration);
      const sameSchedule = prepareBattlefieldEvent(game, generateMap(definition, game.cfg.seed));
      assert.equal(JSON.stringify(event), JSON.stringify(sameSchedule));
      game.time = event.warnAt - TICK;
      updateBattlefieldEvent(game, TICK);
      assert.equal(event.phase, 'scheduled');
      game.time = event.warnAt;
      updateBattlefieldEvent(game, TICK);
      assert.equal(event.phase, 'warning');
      assert.equal(game.eventArea, null);
      game.time = event.startsAt;
      updateBattlefieldEvent(game, TICK);
      assert.equal(event.phase, 'active');
      const { x, y, profile } = game.eventArea;
      assert.ok(battlefieldSpeed(game, x, y, T_PLAIN) < 1);
      assert.ok(battlefieldVisibility(game, x, y) < 1);
      assert.equal(Boolean(eventDamageAt(game.eventArea, x, y, T_FOREST)), Boolean(profile.dps));
      if (event.kind === 'wildfire') {
        assert.equal(eventDamageAt(game.eventArea, x, y, T_ROAD), 0);
        assert.equal(event.endsAt - event.startsAt, 45);
      }
      if (event.kind === 'flood') {
        assert.equal(battlefieldSpeed(game, x, y, T_BRIDGE), 1);
        assert.ok(battlefieldSpeed(game, x, y, T_FORD) < 1);
      }
      if (event.kind === 'storm') {
        assert.equal(battlefieldSpeed(game, x, y, T_ROAD), 1);
        game.time = (event.startsAt + event.endsAt) / 2;
        updateBattlefieldEvent(game, TICK);
        assert.notEqual(game.eventArea.x, x);
      }
      const waterways = game.terrain.map(isWaterway);
      game.time = event.endsAt;
      updateBattlefieldEvent(game, TICK);
      assert.equal(event.phase, 'ended');
      assert.equal(game.eventArea, null);
      assert.equal(String(game.terrain.map(isWaterway)), String(waterways));
      assert.equal(JSON.stringify(game.posts.map(post => [post.owner, post.cap])), JSON.stringify(initial));
      assert.ok(game.posts.every(post => !post._disabled));
    }
  });
});

test('a projectile impact warns before the city accident and damage is localized', () => {
  runBattlefieldCheck(() => {
    const game = makeGame({ mapId: 'city', side: 'atk', diff: 'normal', seed: 19 });
    const event = game.battlefieldEvent;
    const tank = game._oilTanks[0];
    const shell = (x, y) => ({ tx: x, ty: y, t: 0.7, flight: 0.7, dmg: 0, splash: 26, side: 'atk' });
    game.projectiles.push(shell(tank.x - 100, tank.y));
    updateProjectiles(game, TICK);
    assert.equal(event.phase, 'scheduled');
    game.projectiles.push(shell(tank.x, tank.y));
    updateProjectiles(game, TICK);
    assert.equal(event.phase, 'warning');
    assert.ok(tank.alive);
    const inside = spawnUnit(game, 'atk', 'inf', event.x, event.y);
    const outside = spawnUnit(game, 'atk', 'inf', game.spawnPoint.x, game.spawnPoint.y);
    const cp = game.cp.def;
    const insideHp = inside.hp;
    const outsideHp = outside.hp;
    game.time = event.startsAt;
    updateBattlefieldEvent(game, TICK);
    assert.ok(!tank.alive);
    assert.ok(inside.hp < insideHp && inside.alive);
    assert.equal(outside.hp, outsideHp);
    assert.equal(game.cp.def, cp);
  });
});

test('legacy layouts and combat progress retain their expected representations', () => {
  runBattlefieldCheck(() => {
    const legacy = makeGame({ mapId: 'city', side: 'atk', diff: 'normal', seed: 2417, mapRevision: 1 });
    assert.equal(legacy.posts[0].x, 56.5 * CELL);
    assert.equal(legacy.posts[0].y, 42.5 * CELL);
    assert.ok(!legacy.terrain.includes(T_FORD));
    const recent = { ...(legacy.units[0]), _combatTarget: 2, _combatTime: OBSERVE_TIME / 2 };
    assert.equal(unitCombatCue(recent), -50);
    const artillery = { type: 'art', _engaged: true, aimTarget: 2, aimTimer: UNITS.art.aim / 2 };
    assert.equal(unitCombatCue(artillery), 50);
    assert.equal(unitCombatStatus({ ...artillery, _netCombatCue: -34 }), '索敌 34%');
  });
});
