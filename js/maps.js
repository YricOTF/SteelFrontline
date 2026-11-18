"use strict";

const MAP_REVISION = 2;

function makeBattlefield(width, height, terrainAtCell) {
  const terrain = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) terrain[y * width + x] = terrainAtCell(x, y);
  }
  return { mapW: width, mapH: height, terrain };
}

function paintDisc(map, cx, cy, radius, paint) {
  for (let y = Math.max(0, Math.ceil(cy - radius)); y <= Math.min(map.mapH - 1, cy + radius); y++) {
    for (let x = Math.max(0, Math.ceil(cx - radius)); x <= Math.min(map.mapW - 1, cx + radius); x++) {
      if (dist2(x, y, cx, cy) > radius ** 2) continue;
      const i = y * map.mapW + x;
      map.terrain[i] = paint(map.terrain[i], x, y);
    }
  }
}

function layRoute(map, waypoints, width = 1, terrain = T_ROAD) {
  for (let i = 1; i < waypoints.length; i++) {
    const [x1, y1] = waypoints[i - 1];
    const [x2, y2] = waypoints[i];
    const samples = Math.max(1, Math.ceil(dist(x1, y1, x2, y2) * 2));
    for (let j = 0; j <= samples; j++) {
      const x = lerp(x1, x2, j / samples);
      const y = lerp(y1, y2, j / samples);
      paintDisc(map, x, y, width, tile => isWaterway(tile) ? tile : terrain);
    }
  }
}

function layRiver(map, centerline, halfWidth) {
  const channel = Array.from({ length: map.mapW }, (_, x) => ({
    y: Math.round(centerline(x)), halfWidth: halfWidth(x),
  }));
  for (const [x, band] of channel.entries()) {
    for (let dy = -band.halfWidth - 1; dy <= band.halfWidth + 1; dy++) {
      const y = band.y + dy;
      if (y < 0 || y >= map.mapH) continue;
      map.terrain[y * map.mapW + x] = Math.abs(dy) <= band.halfWidth ? T_WATER : T_SAND;
    }
  }
  return channel;
}

function addCrossings(map, river, crossings) {
  for (const { x, name, type, width = 1 } of crossings) {
    for (let column = x - width; column <= x + width; column++) {
      const { y, halfWidth } = river[column];
      for (let dy = -halfWidth - 1; dy <= halfWidth + 1; dy++) {
        map.terrain[(y + dy) * map.mapW + column] = Math.abs(dy) <= halfWidth ? type : T_ROAD;
      }
    }
    map.landmarks.push({ x, y: river[x].y, name, kind: type === T_BRIDGE ? 'bridge' : 'ford' });
  }
}

function addCover(map, x, y, radius, terrain, seed) {
  paintDisc(map, x, y, radius, (tile, col, row) => {
    if (tile !== T_PLAIN && tile !== T_SAND) return tile;
    return dist2(x, y, col, row) < (radius - 1.5) ** 2 || hash2(col, row, seed) > 0.36 ? terrain : tile;
  });
}

function prepareSites(map, layouts) {
  const posts = layouts.posts.map(([x, y, type, name]) => ({ x, y, type, name }));
  const spawns = layouts.spawns.map(([x, y]) => ({ x, y }));
  const turrets = layouts.turrets.map(([x, y, type]) => ({ x, y, type }));
  for (const site of [...posts, ...spawns]) {
    paintDisc(map, site.x, site.y, 3.35, tile =>
      tile === T_MOUNT || tile === T_BUILDING || tile === T_FOREST ? T_PLAIN : tile);
  }
  for (const turret of turrets) {
    paintDisc(map, turret.x, turret.y, 1, tile =>
      tile === T_MOUNT || tile === T_BUILDING || tile === T_FOREST ? T_PLAIN : tile);
  }
  return { ...map, posts, spawns, spawn: spawns[layouts.primarySpawn ?? 0], turrets };
}

function genIsland(seed) {
  const map = makeBattlefield(80, 56, (x, y) => {
    const coast = Math.hypot((x - 40) / 35.5, (y - 27) / 25.8) + (fbm(x * .11, y * .11, seed + 7, 4) - .46) * .32;
    const islets = Math.min(Math.hypot((x - 6) / 4, (y - 38) / 6), Math.hypot((x - 73) / 4.5, (y - 11) / 5));
    if (coast > 1.04 && islets > 1) return T_WATER;
    if (coast > .91) return T_SAND;
    if (Math.hypot((x - 41) / 13, (y - 22) / 10) < 1.03 && fbm(x * .16, y * .16, seed + 23, 3) > .36) return T_MOUNT;
    return fbm(x * .13, y * .13, seed + 37, 3) > .53 ? T_FOREST : T_PLAIN;
  });
  map.landmarks = [
    { x: 41, y: 22, name: '火山口', kind: 'ridge' },
    { x: 33, y: 23, name: '西侧鞍道', kind: 'pass' },
    { x: 50, y: 23, name: '东侧鞍道', kind: 'pass' },
  ];
  layRoute(map, [[22, 48], [25, 40], [17, 35], [15, 29], [21, 19], [29, 13], [40, 10]]);
  layRoute(map, [[58, 48], [56, 41], [64, 34], [65, 27], [60, 19], [51, 13], [40, 10]]);
  layRoute(map, [[25, 40], [31, 35], [41, 33], [51, 37], [56, 41]]);
  layRoute(map, [[41, 33], [34, 29], [33, 22], [35, 16], [40, 10]], 1.05);
  layRoute(map, [[41, 33], [48, 28], [50, 22], [48, 16], [40, 10]], 1.05);
  paintDisc(map, 41, 22, 2.3, () => T_CRATER);

  map.eventSites = [
    { x: 36, y: 22, name: '西侧鞍道', radius: 5.8 },
    { x: 47, y: 22, name: '东侧鞍道', radius: 5.8 },
  ];
  return prepareSites(map, {
    posts: [[40, 10, 'hq', '守军大本营'], [15, 29, 'branch', '西港支部'], [65, 27, 'branch', '东岭支部'],
      [25, 40, 'branch', '南滩支部'], [56, 41, 'branch', '椰林支部'], [41, 33, 'point', '鞍道哨站']],
    spawns: [[22, 48], [58, 48]],
    turrets: [[40, 6, 'fort'], [33, 13, 'mg'], [47, 13, 'mg'], [16, 24, 'at'], [64, 22, 'at'],
      [24, 37, 'mg'], [57, 38, 'mg'], [38, 29, 'bunker'], [45, 30, 'watchtower'], [21, 18, 'watchtower'], [60, 17, 'watchtower']],
  });
}

function genValley(seed) {
  const map = makeBattlefield(72, 56, (x, y) => {
    const center = 36 + 2.25 * Math.sin(y * .16);
    const floor = 13 + Math.max(0, y - 36) * .39 + fbm(x * .09, y * .09, seed + 19, 3) * 5;
    const offset = Math.abs(x - center);
    if (offset > floor || Math.hypot((x - 36) / 5, (y - 28) / 8) < 1) return T_MOUNT;
    if (offset > floor - 2.4) return T_SAND;
    return fbm(x * .12, y * .12, seed + 61, 3) > .55 ? T_FOREST : T_PLAIN;
  });
  map.landmarks = [
    { x: 22, y: 30, name: '西侧隘口', kind: 'pass' },
    { x: 49, y: 30, name: '东侧隘口', kind: 'pass' },
    { x: 36, y: 27, name: '红石断崖', kind: 'ridge' },
  ];
  layRoute(map, [[19, 50], [22, 43], [24, 36], [22, 30], [21, 24], [26, 15], [36, 9]], 1.05);
  layRoute(map, [[53, 50], [51, 43], [48, 36], [49, 29], [51, 24], [46, 16], [36, 9]], 1.05);
  layRoute(map, [[36, 50], [36, 39], [24, 36]], 1.4);
  layRoute(map, [[36, 39], [48, 36]], 1.3);
  layRoute(map, [[26, 15], [35, 17], [46, 16]], 1.14, T_SAND);
  addCover(map, 28, 40, 3, T_RUBBLE, seed + 9);
  addCover(map, 44, 40, 3, T_RUBBLE, seed + 10);
  map.eventSites = [
    { x: 22, y: 30, name: '西侧隘口', radius: 5.2 },
    { x: 49, y: 30, name: '东侧隘口', radius: 5.2 },
  ];
  return prepareSites(map, {
    posts: [[36, 9, 'hq', '守军大本营'], [21, 24, 'branch', '西谷口支部'], [51, 24, 'branch', '东谷口支部']],
    spawns: [[19, 50], [36, 50], [53, 50]], primarySpawn: 1,
    turrets: [[36, 5, 'fort'], [29, 12, 'mg'], [43, 13, 'mg'], [21, 20, 'at'], [50, 20, 'at'],
      [26, 31, 'bunker'], [46, 32, 'bunker'], [27, 40, 'watchtower'], [44, 40, 'watchtower']],
  });
}

function genPlain(seed) {
  const map = makeBattlefield(104, 72, (x, y) => {
    const wood = fbm(x * .075 + 5, y * .075, seed + 91, 4);
    const fields = (x > 44 && x < 62) || Math.hypot((x - 37) / 12, (y - 15) / 8) < 1;
    return wood > (fields ? .67 : .44) ? T_FOREST : T_PLAIN;
  });
  map.landmarks = [
    { x: 33, y: 26, name: '西林带', kind: 'ridge' },
    { x: 70, y: 48, name: '南林带', kind: 'ridge' },
    { x: 53, y: 27, name: '中央农道', kind: 'pass' },
  ];
  const river = layRiver(map, x => 34 + 3.6 * Math.sin(x * .105) + 1.3 * Math.sin(x * .23), () => 1);
  addCrossings(map, river, [
    { x: 21, name: '西林浅滩', type: T_FORD },
    { x: 53, name: '中央板桥', type: T_BRIDGE },
    { x: 82, name: '石桥', type: T_BRIDGE },
  ]);
  layRoute(map, [[38, 64], [26, 53], [21, 42], [21, 30], [16, 22], [29, 14], [53, 11]]);
  layRoute(map, [[53, 65], [54, 45], [53, 36], [53, 25], [53, 11]], 1.3);
  layRoute(map, [[69, 64], [80, 53], [82, 44], [82, 34], [86, 23], [73, 15], [53, 11]]);
  layRoute(map, [[26, 53], [42, 49], [54, 45], [69, 49], [80, 53]], 1.2);
  layRoute(map, [[16, 22], [33, 21], [53, 24], [70, 26], [86, 23]]);
  addCover(map, 33, 26, 5.2, T_FOREST, seed + 15);
  addCover(map, 70, 48, 5.6, T_FOREST, seed + 23);
  map.eventSites = [
    { x: 33, y: 26, name: '西林带', radius: 6.8 },
    { x: 70, y: 48, name: '南林带', radius: 6.8 },
  ];
  return prepareSites(map, {
    posts: [[53, 11, 'hq', '守军大本营'], [16, 22, 'branch', '林场支部'], [86, 23, 'branch', '铁路支部'],
      [26, 53, 'branch', '南村支部'], [80, 53, 'branch', '石桥支部'], [54, 45, 'point', '中央哨站']],
    spawns: [[38, 64], [53, 65], [69, 64]], primarySpawn: 1,
    turrets: [[53, 6, 'fort'], [45, 14, 'mg'], [61, 14, 'mg'], [18, 21, 'at'], [84, 24, 'at'],
      [26, 49, 'mg'], [80, 49, 'mg'], [49, river[49].y - 4, 'bunker'], [56, 38, 'watchtower'], [34, 44, 'watchtower'], [73, river[73].y + 4, 'watchtower']],
  });
}

function buildDistrict(map, x1, y1, x2, y2, spacing, density, seed) {
  for (let y = y1; y <= y2; y++) {
    for (let x = x1; x <= x2; x++) {
      const street = (x - x1) % spacing === 0 || (y - y1) % spacing === 0;
      const lot = hash2(x, y, seed);
      map.terrain[y * map.mapW + x] = street ? T_ROAD :
        lot < density ? T_BUILDING : lot < density + .08 ? T_RUBBLE : T_PLAIN;
    }
  }
}

function genCity(seed) {
  const map = makeBattlefield(112, 84, (x, y) =>
    fbm(x * .09, y * .09, seed + 44, 4) > .64 ? T_FOREST : T_PLAIN);
  buildDistrict(map, 12, 37, 43, 63, 4, .84, seed + 101);
  buildDistrict(map, 40, 15, 72, 46, 6, .78, seed + 103);
  buildDistrict(map, 73, 16, 103, 43, 7, .76, seed + 107);
  buildDistrict(map, 80, 51, 100, 67, 5, .65, seed + 109);
  buildDistrict(map, 13, 15, 30, 29, 5, .71, seed + 113);
  map.landmarks = [
    { x: 44, y: 47, name: '广场弹坑', kind: 'ridge' },
    { x: 56, y: 49, name: '南北大道', kind: 'pass' },
    { x: 88, y: 34, name: '储油区', kind: 'depot' },
  ];
  layRoute(map, [[55, 76], [55, 61], [56, 52], [56, 25], [56, 10]], 1.8);
  layRoute(map, [[38, 75], [33, 66], [27, 53], [20, 44], [23, 23], [40, 23], [56, 25]], 1.18);
  layRoute(map, [[73, 75], [85, 66], [88, 57], [95, 46], [95, 34], [87, 26], [68, 25], [56, 25]], 1.4);
  layRoute(map, [[27, 53], [36, 55], [55, 61], [69, 61], [88, 57]], 1.25);
  layRoute(map, [[20, 44], [35, 40], [56, 39], [69, 49], [95, 46]], 1.1);
  paintDisc(map, 44, 47, 6, tile => tile === T_BUILDING || tile === T_FOREST ? T_RUBBLE : tile);
  paintDisc(map, 44, 47, 4.4, () => T_CRATER);
  map.oilTanks = [[86, 33], [89, 34], [87, 37]].map(([x, y]) => {
    paintDisc(map, x, y, 1.8, tile => tile === T_BUILDING ? T_PLAIN : tile);
    return { x: (x + .5) * CELL, y: (y + .5) * CELL, r: 22, alive: true };
  });

  map.eventSites = [{ x: 88, y: 35, name: '储油区', radius: 5.9 }];
  return prepareSites(map, {
    posts: [[56, 25, 'hq', '市中央指挥部'], [27, 53, 'branch', '老城支部'], [87, 26, 'branch', '工业区支部'],
      [23, 23, 'branch', '西北郊支部'], [88, 57, 'branch', '东南郊支部'], [55, 61, 'point', '南广场哨站']],
    spawns: [[38, 75], [55, 76], [73, 75]], primarySpawn: 1,
    turrets: [[56, 17, 'fort'], [50, 26, 'mg'], [62, 26, 'mg'], [25, 47, 'at'], [87, 21, 'at'],
      [25, 58, 'mg'], [90, 54, 'mg'], [37, 40, 'bunker'], [69, 37, 'bunker'], [55, 56, 'watchtower'],
      [18, 31, 'watchtower'], [97, 47, 'watchtower']],
  });
}

function genRiver(seed) {
  const map = makeBattlefield(84, 58, (x, y) =>
    fbm(x * .11, y * .11, seed + 141, 4) > .56 ? T_FOREST : T_PLAIN);
  map.landmarks = [];
  const river = layRiver(map, x => 28 + 3.7 * Math.sin(x * .15) + 1.25 * Math.sin(x * .3), x => x > 27 && x < 57 ? 3 : 2);
  addCrossings(map, river, [
    { x: 14, name: '西堤桥', type: T_BRIDGE },
    { x: 42, name: '中央铁桥', type: T_BRIDGE },
    { x: 65, name: '东石桥', type: T_BRIDGE },
    { x: 76, name: '下游浅滩', type: T_FORD },
  ]);
  layRoute(map, [[26, 52], [18, 44], [14, 37], [14, 26], [14, 21], [26, 16], [42, 10]], 1.2);
  layRoute(map, [[26, 52], [42, 44], [58, 52]], 1.2);
  layRoute(map, [[42, 44], [42, 38], [42, 26], [42, 10]], 1.3);
  layRoute(map, [[58, 52], [64, 45], [65, 35], [65, 25], [66, 20], [55, 15], [42, 10]], 1.1);
  layRoute(map, [[64, 45], [76, 41], [76, 25], [66, 20]], 1.08, T_SAND);
  layRoute(map, [[18, 44], [30, 40], [42, 38], [55, 40], [64, 45]]);
  addCover(map, 25, 36, 3.7, T_RUBBLE, seed + 4);
  addCover(map, 54, 35, 4, T_FOREST, seed + 3);
  map.eventSites = [
    { x: 17, y: river[17].y + 5, name: '西堤低地', radius: 7.1 },
    { x: 73, y: river[73].y + 5, name: '下游漫滩', radius: 7.3 },
  ];
  return prepareSites(map, {
    posts: [[42, 10, 'hq', '守军大本营'], [14, 21, 'branch', '西桥头支部'], [66, 20, 'branch', '东桥头支部'],
      [18, 44, 'branch', '南岸支部'], [64, 45, 'branch', '河口支部'], [42, 38, 'point', '中流哨站']],
    spawns: [[26, 52], [58, 52]],
    turrets: [[42, 6, 'fort'], [30, 15, 'mg'], [54, 15, 'mg'], [15, 19, 'at'], [65, 17, 'at'],
      [18, 40, 'mg'], [64, 41, 'mg'], [39, river[39].y - river[39].halfWidth - 2, 'bunker'], [44, 36, 'watchtower'], [10, 39, 'watchtower'], [73, 38, 'watchtower']],
  });
}

function genGrand(seed) {
  const map = makeBattlefield(128, 80, (x, y) => {
    const ridge = fbm(x * .07 + 10, y * .07, seed + 33, 4);
    if (ridge > .64 && (x < 52 || x > 93)) return T_MOUNT;
    return fbm(x * .09, y * .09, seed + 67, 4) > (x > 76 ? .47 : .56) ? T_FOREST : T_PLAIN;
  });
  map.landmarks = [
    { x: 38, y: 32, name: '西翼高地', kind: 'ridge' },
    { x: 90, y: 49, name: '东岸林场', kind: 'ridge' },
  ];
  const river = layRiver(map, x => 39 + 3.1 * Math.sin(x * .084) + 1.4 * Math.sin(x * .18), () => 2);
  addCrossings(map, river, [
    { x: 19, name: '西翼桥', type: T_BRIDGE },
    { x: 43, name: '高地浅滩', type: T_FORD },
    { x: 64, name: '中央干线桥', type: T_BRIDGE, width: 2 },
    { x: 85, name: '林场浅滩', type: T_FORD },
    { x: 108, name: '东翼桥', type: T_BRIDGE },
  ]);
  layRoute(map, [[23, 71], [25, 57], [19, 47], [19, 33], [30, 22], [46, 16], [64, 12]], 1.3);
  layRoute(map, [[64, 73], [64, 61], [64, 48], [64, 33], [64, 12]], 1.4);
  layRoute(map, [[104, 71], [102, 57], [108, 47], [108, 33], [96, 22], [81, 15], [64, 12]], 1.3);
  layRoute(map, [[25, 57], [43, 48], [43, 35], [54, 30], [64, 30]], 1.12);
  layRoute(map, [[102, 57], [85, 49], [85, 36], [76, 30], [64, 30]], 1.12);
  layRoute(map, [[25, 57], [43, 58], [64, 61], [83, 59], [102, 57]], 1.18);
  layRoute(map, [[30, 22], [44, 26], [64, 27], [83, 26], [96, 22]], 1.1);
  map.eventSites = [
    { x: 22, y: 42, to: [106, 38], name: '横贯河谷', radius: 7.3 },
    { x: 106, y: 39, to: [22, 43], name: '横贯河谷', radius: 7.3 },
  ];
  return prepareSites(map, {
    posts: [[64, 12, 'hq', '北军大本营'], [30, 22, 'branch', '西北支部'], [96, 22, 'branch', '东北支部'],
      [19, 34, 'point', '西桥岗哨'], [108, 33, 'point', '东桥岗哨'], [25, 57, 'point', '西南据点'],
      [102, 57, 'point', '东南据点'], [64, 61, 'branch', '南方指挥支部'], [64, 49, 'point', '中央河港']],
    spawns: [[23, 71], [64, 73], [104, 71]], primarySpawn: 1,
    turrets: [[64, 7, 'fort'], [55, 14, 'mg'], [73, 14, 'mg'], [28, 19, 'at'], [98, 19, 'at'],
      [19, 33, 'mg'], [108, 32, 'mg'], [31, 54, 'mg'], [96, 53, 'mg'], [59, 56, 'bunker'],
      [67, 58, 'bunker'], [42, 32, 'watchtower'], [85, 31, 'watchtower'], [64, 35, 'watchtower'],
      [39, 55, 'watchtower'], [88, 54, 'watchtower']],
  });
}

const MAPS = [
  { id: 'island', n: '翡翠群岛', tag: '海岛', gen: genIsland, event: 'volcano',
    palette: { [T_WATER]: ['#173d48', '#2c6469'], [T_SAND]: ['#a49465', '#ccbc88'] },
    desc: '两翼登陆，沿岸绕行或争夺火山鞍道。', routes: '西港环岸、东岭环岸、火山双鞍道' },
  { id: 'valley', n: '赤石山谷', tag: '山谷', gen: genValley, event: 'rockfall',
    palette: { [T_MOUNT]: ['#594d44', '#865f50'], [T_SAND]: ['#87694f', '#a68863'] },
    desc: '两条谷道绕过断崖，南侧岔路可互相支援。', routes: '西侧隘口、东侧隘口、谷底横路' },
  { id: 'plain', n: '黑森林平原', tag: '林地', gen: genPlain, event: 'wildfire',
    palette: { [T_FOREST]: ['#243b32', '#364e3c'], [T_PLAIN]: ['#596247', '#7c8057'] },
    desc: '农道推进较快，两翼林带可遮蔽侦察与迂回。', routes: '中央板桥、西林浅滩、东侧石桥' },
  { id: 'city', n: '断壁残城', tag: '城市', gen: genCity, event: 'oilfire',
    palette: { [T_BUILDING]: ['#4b544d', '#6a6b61'], [T_ROAD]: ['#68665d', '#8c8474'] },
    desc: '南北大道贯穿街区，巷道可以绕开广场弹坑。', routes: '南北大道、老城巷道、工业区外环' },
  { id: 'river', n: '怒涛渡口', tag: '河流', gen: genRiver, event: 'flood',
    palette: { [T_WATER]: ['#17394a', '#2e596a'], [T_FORD]: ['#4d787e', '#89a59b'] },
    desc: '三座桥与一处浅滩连接两岸，南岸可横向调动。', routes: '西堤桥、中央铁桥、东石桥、下游浅滩' },
  { id: 'grand', n: '大陆战场', tag: '大战场', gen: genGrand, event: 'storm',
    palette: { [T_PLAIN]: ['#575b42', '#878054'], [T_FOREST]: ['#273c35', '#405641'] },
    desc: '三个登陆场通往五处渡河点，中央干线连接南北。', routes: '西翼桥、中央干线桥、东翼桥、两处浅滩' },
  { id: 'tutorial', n: '新兵训练', tag: '教程', tutorial: true, routes: '登陆场至中立支部' },
];

function isWaterway(terrain) {
  return terrain === T_WATER || terrain === T_BRIDGE || terrain === T_FORD;
}

function generateMap(mapDef, seed, revision = MAP_REVISION) {
  if (revision === MAP_REVISION && !mapDef.tutorial) return mapDef.gen(seed);
  const width = MAP_W;
  const height = MAP_H;
  let state = seed >>> 0;
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  try {
    return LEGACY_MAP_GENERATORS[mapDef.id](random);
  } finally {
    MAP_W = width;
    MAP_H = height;
  }
}
