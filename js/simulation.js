"use strict";

/* ============ 游戏初始化 ============ */
function makeGame(cfg){
  const mapDef=MAPS.find(m=>m.id===cfg.mapId)||MAPS[0];
  const seed = Number.isInteger(cfg.seed) ? cfg.seed >>> 0 : Math.floor(Math.random() * 4294967296);
  const mapRevision = cfg.mapRevision === 1 || mapDef.tutorial ? 1 : MAP_REVISION;
  const gen = generateMap(mapDef, seed, mapRevision);
  const tileCenter = point => ({ x: (point.x + 0.5) * CELL, y: (point.y + 0.5) * CELL });
  const attackSpawns = gen.spawns.map(tileCenter);
  const spawnPoint = mapRevision === 1 ? { x: gen.spawn.x * CELL, y: gen.spawn.y * CELL } : tileCenter(gen.spawn);
  MAP_W = gen.mapW;
  MAP_H = gen.mapH;

  const frontline = cfg.rules === 'frontline' && !mapDef.tutorial;
  const weatherKey = frontline && Object.hasOwn(WEATHER, cfg.weather) ? cfg.weather : 'clear';
  const duration = [900, 1500, 2100].includes(cfg.duration) ? cfg.duration : GAME_LEN;

  const seasonKeys=Object.keys(SEASONS);
  const season = Object.hasOwn(SEASONS, cfg.season) ? cfg.season : seasonKeys[Math.floor(Math.random() * seasonKeys.length)];
  const seasonDef=SEASONS[season];

  const g={
    cfg: { ...cfg, mapId: mapDef.id, mapRevision, seed, weather: weatherKey, duration }, mapDef,
    landmarks: (gen.landmarks || []).map(mark => ({ ...mark, ...tileCenter(mark) })),
    terrain: gen.terrain, terrainCanvas: null, terrainRevision: 0,
    frontline, weather: WEATHER[weatherKey], duration,
    supplies: { atk: [], def: [] }, showSupply: false, smokes: [],
    stats: { atk: { losses: 0, deployed: 0 }, def: { losses: 0, deployed: 0 } },
    units:[],turrets:[],posts:[],trenches:[],
    effects:[],projectiles:[],strikes:[],deploying:[],
    plans:[],deployPoints:[],
    time:0,tick:0,
    cp:{atk:0,def:0},cpFrac:{atk:0,def:0},
    playerSide:cfg.side,aiSide:cfg.side==='atk'?'def':'atk',
    selection:[],cam:{x:gen.spawn.x*CELL,y:(gen.spawn.y+8)*CELL,zoom:.85},
    vis: { atk: null, def: null },
    explored: { atk: new Uint8Array(gen.terrain.length), def: new Uint8Array(gen.terrain.length) },
    recon:[],cd:{atk:{},def:{}},
    state:'playing',result:null,
    ai:{timer:1.2,wave:0},
    spawnPoint, atkSpawnPoints: attackSpawns,
    forbiddenCenters: mapRevision === 1 ? [spawnPoint] : attackSpawns,
    mode:null,pendingDeploy:null,pendingSkill:null,
    shake:0,squads:{},hotSquad:0,radialTargets:null,
    planMode:null,planPts:[],planPhase:null,planStartLine:null,
    mp:null,tutorial:null,forbiddenRadius:DEF_FORBIDDEN_RADIUS,_clientReady:false,
    season:season,dayTime:Number.isFinite(cfg.dayTime)?cfg.dayTime:Math.random(),
    env:{cpMul:1,dmgMul:1,spdMul:1,visMul:1,dayAmount:1},
    _aiState:null,
    _waveCount:{atk:0,def:0},
    _planBonuses:{atk:0,def:0},
    _emergency:{atk:0,def:0},
    _marchUnits:new Map(),
    _oilTanks:(gen.oilTanks||[]).map(t=>({x:t.x,y:t.y,r:t.r,alive:true})),
    battlefieldEvent: null, eventArea: null, legacyFire: [],
    _lastTerrainTry:-99,
  };
  g.env.cpMul=seasonMul(seasonDef.cpMul);
  g.env.dmgMul=seasonMul(seasonDef.dmgMul);
  g.env.spdMul=seasonMul(seasonDef.spdMul);
  g.env.visMul=seasonMul(seasonDef.visMul);
  updateEnv(g,0);

  /* 生成据点 */
  gen.posts.forEach((p,i)=>{
    const ptype = p.type==='point'?'point':p.type;
    const def=POST_TYPES[ptype]||POST_TYPES.branch;
    g.posts.push({
      id:i,x:p.x*CELL+CELL/2,y:p.y*CELL+CELL/2,
      type:ptype,
      owner: p.owner || 'def',
      cap: p.owner === 'neutral' ? 0 : def.cap,
      integrate:1,
      name:p.name,
    });
  });
  /* 生成炮塔 */
  gen.turrets.forEach(p=>{
    const d=TURRETS[p.type];
    g.turrets.push({
      id:uid()+100000,
      side:'def',owner:'def',type:p.type,
      x:p.x*CELL+CELL/2,y:p.y*CELL+CELL/2,
      hp:d.hp,maxHp:d.hp,cd:rnd(0,1),r:d.r,discovered:false,ruin:false
    });
  });
  computeForbiddenRadius(g);
  /* 守方初始驻军 */
  g.posts.forEach(p=>{
    if(p.owner !== 'def') return;
    if(p.type==='hq'){
      const u1=spawnUnit(g,'def','inf',p.x+rnd(-40,40),p.y+rnd(40,70));u1.holdPost=1;
      const u2=spawnUnit(g,'def','inf',p.x+rnd(-40,40),p.y+rnd(40,70));u2.holdPost=1;
      const u3=spawnUnit(g,'def','eng',p.x+rnd(-40,40),p.y+rnd(60,90));u3.holdPost=1;
    }else{
      const u=spawnUnit(g,'def','inf',p.x+rnd(-30,30),p.y+rnd(-30,30));u.holdPost=1;
      if(Math.random()<.6){const s=spawnUnit(g,'def','scout',p.x+rnd(-50,50),p.y+rnd(-50,50));s.holdPost=1;}
    }
  });
  /* 攻方初始 */
  for(let i=0;i<4;i++)spawnUnit(g,'atk','inf',g.spawnPoint.x+rnd(-70,70),g.spawnPoint.y+rnd(-50,50));
  spawnUnit(g,'atk','scout',g.spawnPoint.x+rnd(-60,60),g.spawnPoint.y+rnd(-40,40));
  spawnUnit(g,'atk','arm',g.spawnPoint.x+rnd(-50,50),g.spawnPoint.y+rnd(-40,40));
  spawnUnit(g,'atk','eng',g.spawnPoint.x+rnd(-60,60),g.spawnPoint.y+rnd(-40,40));
  g.cp.atk=30;g.cp.def=38;
  g.battlefieldEvent = prepareBattlefieldEvent(g, gen);
  buildTerrainCanvas(g);
  recomputeVis(g,'atk');recomputeVis(g,'def');
  updateDeployPoints(g);
  return g;
}

function updateEnv(g,dt){
  g.dayTime=(g.dayTime+dt/DAY_CYCLE)%1;
  const raw=0.5+0.5*Math.cos(g.dayTime*Math.PI*2);
  const dayAmount=Math.pow(raw,0.7);
  g.env.dayAmount=dayAmount;
  const seasonDef=SEASONS[g.season];
  g.env.cpMul=seasonMul(seasonDef.cpMul);
  g.env.dmgMul=seasonMul(seasonDef.dmgMul);
  g.env.spdMul=seasonMul(seasonDef.spdMul);
  g.env.visMul=seasonMul(seasonDef.visMul)*(0.75+0.25*dayAmount)*g.weather.visibility;
}

/* 登陆场周围保留进攻方的初始部署空间。 */
function computeForbiddenRadius(g){
  g.forbiddenRadius = DEF_FORBIDDEN_RADIUS;
}

/* 据点完成整合后开放部署。 */
function updateDeployPoints(g){
  const pts=[];
  if(g.playerSide==='atk'||g.aiSide==='atk'){
    for(const sp of g.atkSpawnPoints){
      pts.push({x:sp.x,y:sp.y,r:DEPLOY_RADIUS,side:'atk',name:'登陆场',permanent:true});
    }
  }
  for(const p of g.posts){
    if(p._disabled || p.owner === 'neutral') continue;
    if(p.owner==='atk'&&p.integrate<1) continue;
    pts.push({
      x:p.x, y:p.y,
      r:DEPLOY_RADIUS,
      side:p.owner, name:p.name, postId:p.id
    });
  }
  g.deployPoints=pts;
  updateSupplyNodes(g);
}
function statMulOf(g,side){
  if(g.mp || g.cfg.multiplayer) return 1;
  return (side===g.aiSide) ? DIFFS[g.cfg.diff].statMul : 1;
}
function spawnUnit(g,side,type,x,y){
  const d=UNITS[type];
  if (side === 'def') {
    const radius = g.forbiddenRadius || DEF_FORBIDDEN_RADIUS;
    for (const center of g.forbiddenCenters) {
      const d2 = dist2(x, y, center.x, center.y);
      if (d2 >= radius ** 2) continue;
      const angle = d2 ? Math.atan2(y - center.y, x - center.x) : -Math.PI / 2;
      x = center.x + Math.cos(angle) * (radius + 40);
      y = center.y + Math.sin(angle) * (radius + 40);
    }
  }
  if(!canWalk(g,x,y,type)){
    let best=null,bestD=Infinity;
    for(let r=1;r<=8&&!best;r++){
      for(let dy=-r;dy<=r;dy++)for(let dx=-r;dx<=r;dx++){
        if(Math.abs(dx)!==r&&Math.abs(dy)!==r)continue;
        const nx=x+dx*CELL*0.5,ny=y+dy*CELL*0.5;
        if(nx<0||ny<0||nx>=MAP_W*CELL||ny>=MAP_H*CELL)continue;
        if(canWalk(g,nx,ny,type)&&(side!=='def'||!isDefForbiddenArea(g,nx,ny))){const dd=dist2(x,y,nx,ny);if(dd<bestD){bestD=dd;best={x:nx,y:ny};}}
      }
    }
    if(best){x=best.x;y=best.y;}
  }
  const sm=statMulOf(g,side);
  const hp=Math.round(d.hp*sm);
  const u={id:uid(),side,type,x,y,hp,maxHp:hp,cd:0,order:null,tid:0,stuck:0,lastX:x,lastY:y,facing:side==='atk'?-Math.PI/2:Math.PI/2,trenchTimer:0,alive:true,path:null,pathI:0,aimTimer:0,aimTarget:null,holdPost:0,observedTime:0,_defRole:null,_defPostId:undefined,planId:null,_planSince:0,_dmgMul:sm,
    _combatTarget:0,_combatTime:0,_combatLost:0,_engaged:false,supply:1,suppression:0};
  g.units.push(u);
  return u;
}

function terrainAt(g,wx,wy){const cx=Math.floor(wx/CELL),cy=Math.floor(wy/CELL);if(cx<0||cy<0||cx>=MAP_W||cy>=MAP_H)return T_MOUNT;return g.terrain[cy*MAP_W+cx];}
function canWalk(g, wx, wy, type) {
  return cellWalkable(g, Math.floor(wx / CELL), Math.floor(wy / CELL), type);
}
function speedAt(g,wx,wy,unitType){
  const tv=terrainAt(g,wx,wy);
  if(tv===T_MOUNT) return 0.15;
  if (tv === T_BRIDGE && g.cfg.mapRevision === MAP_REVISION) return TERRAIN[T_BRIDGE].spd;
  if (tv === T_BRIDGE || tv === T_FORD) {
    if (unitType === 'arm' || unitType === 'art') return tv === T_FORD ? 0.31 : 0.2;
    if (unitType === 'eng') return tv === T_FORD ? 0.69 : 1;
    return 0.6;
  }
  return TERRAIN[tv].spd;
}
function coverAt(g,wx,wy){return TERRAIN[terrainAt(g,wx,wy)].cover;}
function inForest(g,wx,wy){return terrainAt(g,wx,wy)===T_FOREST;}
function inMountain(g,wx,wy){return terrainAt(g,wx,wy)===T_MOUNT;}
function inConcealment(g,wx,wy){const t=terrainAt(g,wx,wy);return t===T_FOREST||t===T_MOUNT;}
function unitSpeedInTerrain(g,u){
  const d=UNITS[u.type];let base=d.spd*speedAt(g,u.x,u.y,u.type);
  if(u.type==='arm'&&terrainAt(g,u.x,u.y)===T_FOREST)base*=0.5;
  base*=g.env.spdMul||1;
  const terrain = terrainAt(g, u.x, u.y);
  if (terrain !== T_ROAD && terrain !== T_BRIDGE) base *= g.weather.offRoadSpeed;
  base *= battlefieldSpeed(g, u.x, u.y, terrain);
  if (g.frontline) {
    base *= (0.8 + 0.2 * Math.min(1, u.supply / 0.35)) * (1 - 0.28 * u.suppression);
  }
  if(u.planId){
    const planBonus=g._planBonuses[u.side]||0;
    if(planBonus>0)base*=(1+planBonus*0.3);
  }
  if(g._marchUnits && g._marchUnits.has(u.id))base*=1.5;
  return base;
}

function inAtkSafeZone(g,wx,wy){
  if(!g.atkSpawnPoints)return false;
  for(const sp of g.atkSpawnPoints){
    if(dist2(wx,wy,sp.x,sp.y) < 130*130) return true;
  }
  return false;
}

/* ============ 视野 ============ */
function recomputeVis(g,side){
  const v=new Uint8Array(MAP_W*MAP_H);
  const mark = (px, py, radius, scout = false, airborne = false) => {
    if (!airborne) radius *= battlefieldVisibility(g, px, py);
    const cx = Math.floor(px / CELL);
    const cy = Math.floor(py / CELL);
    const cells = Math.ceil(radius / CELL);
    const r2 = radius ** 2;
    for (let y = Math.max(0, cy - cells); y <= Math.min(MAP_H - 1, cy + cells); y++) {
      for (let x = Math.max(0, cx - cells); x <= Math.min(MAP_W - 1, cx + cells); x++) {
        const i = y * MAP_W + x;
        if (v[i]) continue;
        const gx = (x + 0.5) * CELL;
        const gy = (y + 0.5) * CELL;
        const d2 = dist2(gx, gy, px, py);
        if (d2 > r2) continue;
        if (Math.max(Math.abs(x - cx), Math.abs(y - cy)) <= 1 || airborne) {
          v[i] = 1;
          continue;
        }
        if (crossesSmoke(g, px, py, gx, gy)) continue;
        const canSeeThroughForest = scout && d2 <= r2 * 0.25;
        const clear = traceCells(px, py, gx, gy, (tx, ty) => {
          const terrain = g.terrain[ty * MAP_W + tx];
          const atTarget = tx === x && ty === y;
          if (terrain === T_BUILDING || terrain === T_MOUNT) return atTarget && canSeeThroughForest;
          return terrain !== T_FOREST || canSeeThroughForest;
        });
        if (clear) v[i] = 1;
      }
    }
  };
  const isNight=g.env.dayAmount<0.3;
  for(const u of g.units){
    if(u.side!==side||!u.alive)continue;
    let visMul=g.env.visMul||1;
    if(isNight){
      let nearPost=false;
      for(const p of g.posts){if(p.owner===side && dist2(u.x,u.y,p.x,p.y)<220*220){nearPost=true;break;}}
      if(nearPost)visMul=g.weather.visibility;
    }
    const isScout=u.type==='scout';
    mark(u.x,u.y,UNITS[u.type].vis*visMul,isScout);
  }
  for(const t of g.turrets){
    if(t.owner!==side)continue;
    mark(t.x,t.y,TURRETS[t.type].vis*(g.env.visMul||1),false,false);
  }
  for(const p of g.posts){
    if(p.owner!==side)continue;
    if(p._disabled)continue;
    mark(p.x,p.y,(POST_TYPES[p.type]?.radius*1.6)||190,false,false);
  }
  for(const r of g.recon){if(r.side!==side)continue;mark(r.x,r.y,r.r,false,true);}
  if(side!=='atk'){
    for(const sp of g.atkSpawnPoints){
      const cx=Math.floor(sp.x/CELL),cy=Math.floor(sp.y/CELL);
      const rr=Math.ceil(130/CELL);
      for(let y=cy-rr;y<=cy+rr;y++){
        if(y<0||y>=MAP_H)continue;
        for(let x=cx-rr;x<=cx+rr;x++){
          if(x<0||x>=MAP_W)continue;
          const gx=(x+.5)*CELL,gy=(y+.5)*CELL;
          if(dist2(gx,gy,sp.x,sp.y)<130*130) v[y*MAP_W+x]=0;
        }
      }
    }
  }
  g.vis[side]=v;
  const explored = g.explored[side];
  for (let i = 0; i < v.length; i++) if (v[i]) explored[i] = 1;
  if(g.playerSide===side){
    for(const t of g.turrets){
      if(t.owner===side||t.discovered)continue;
      const cx=Math.floor(t.x/CELL),cy=Math.floor(t.y/CELL);
      if(cx>=0&&cy>=0&&cx<MAP_W&&cy<MAP_H&&v[cy*MAP_W+cx])t.discovered=true;
    }
  }
}
function visible(g,side,wx,wy){const arr=g.vis[side];if(!arr)return true;const cx=Math.floor(wx/CELL),cy=Math.floor(wy/CELL);if(cx<0||cy<0||cx>=MAP_W||cy>=MAP_H)return false;return arr[cy*MAP_W+cx]===1;}
function isDefForbiddenArea(g, x, y) {
  const radius = g.forbiddenRadius || DEF_FORBIDDEN_RADIUS;
  return g.forbiddenCenters.some(center => dist2(x, y, center.x, center.y) < radius ** 2);
}
function effectiveRange(g,u,d){
  let r=d.range;
  const tv=terrainAt(g,u.x,u.y);
  if(tv===T_BUILDING||tv===T_MOUNT) r*=0.85;
  return r;
}
function canAttackUnit(g,attacker,defender){
  if(defender.side==='def' && isDefForbiddenArea(g,defender.x,defender.y)){
    if(attacker.side==='atk')return false;
  }
  return true;
}

/* ============ 主循环 step ============ */
function step(dt){
  const g=G;
  if(g.state!=='playing')return;
  g.tick++;
  if(Net.role==='client')return;
  g.time+=dt;
  updateEnv(g,dt);
  updateBattlefieldEvent(g, dt);
  updatePlanBonus(g,dt);
  for (const side of ['atk', 'def']) {
    for (const key in g.cd[side]) g.cd[side][key] = Math.max(0, g.cd[side][key] - dt);
  }
  if (g.smokes.length) g.smokes = g.smokes.filter(smoke => smoke.until > g.time);
  for (const [id, until] of g._marchUnits) {
    if (until <= g.time) g._marchUnits.delete(id);
  }
  updateCP(g,dt);
  updateDeploy(g,dt);
  for(const u of g.units){if(u.alive)updateUnit(g,u,dt);}
  for(const t of g.turrets)updateTurret(g,t,dt);
  updateProjectiles(g,dt);
  updatePosts(g,dt);
  updateStrikes(g,dt);
  for(let i=g.recon.length-1;i>=0;i--)if(g.recon[i].until<g.time)g.recon.splice(i,1);
  for(let i=g.effects.length-1;i>=0;i--){g.effects[i].life-=dt;if(g.effects[i].life<=0)g.effects.splice(i,1);}
  for(let i=g.units.length-1;i>=0;i--)if(!g.units[i].alive)g.units.splice(i,1);
  for(let i=g.turrets.length-1;i>=0;i--){const t=g.turrets[i];if(t.hp<=0&&!t.ruin){t.hp=0;t.ruin=true;t.owner='neutral';t.side='neutral';addEffect(g,{type:'boom',x:t.x,y:t.y,r:60,life:.7,max:.7});if(CFG.shake&&!g.mp)g.shake=Math.min(1,g.shake+0.15);}}
  if(!g.terrainCanvas && g.time - (g._lastTerrainTry||-99) > 1.5){
    buildTerrainCanvas(g);
  }
  if(g.tick % 6 === 0){recomputeVis(g,'atk');recomputeVis(g,'def');updateDeployPoints(g);}
  if(g.tutorial) tutStep(dt);
  if (!g.tutorial) updateAI(g,dt);
  checkVictory(g);
  if(g.shake>0)g.shake=Math.max(0,g.shake-dt*3.5);
  if(Net.role==='host' && (g.result || g.tick%3===0)) netBroadcastState(Boolean(g.result));
}

function updatePlanBonus(g,dt){
  const bonus={atk:0,def:0};
  for(const plan of g.plans){
    if(plan.state!=='active')continue;
    if(!plan._activatedAt)plan._activatedAt=g.time;
    const t=g.time-plan._activatedAt;
    const b=clamp(t/180,0,1);
    bonus[plan.side]=Math.max(bonus[plan.side],b);
  }
  g._planBonuses=bonus;
}

function updateCP(g,dt){
  const add=(side)=>{
    let r;
    if(side==='atk'){r=(0.55+g.time*0.0012)*0.85;for(const p of g.posts){if(p.owner!=='atk')continue;if(p.type==='hq')r+=0.22;else if(p.type==='branch')r+=0.12;else r+=0.08;}}
    else{r=0.85;for(const p of g.posts){if(p.owner==='def')continue;if(p.type==='hq')r-=0.25;else if(p.type==='branch')r-=0.10;else r-=0.06;}}
    r=Math.max(0.15,r);
    if(g.aiSide===side && !g.mp)r*=DIFFS[g.cfg.diff].cpMul;
    r*=g.env.cpMul;
    g.cpFrac[side]+=r*dt;
    if(g.cpFrac[side]>=1){const inc=Math.floor(g.cpFrac[side]);g.cpFrac[side]-=inc;g.cp[side]=Math.min(CP_MAX,g.cp[side]+inc);}
  };
  add('atk');add('def');
}
/* ============================================================
 * 占领奖励 —— 修复数值过低
 * 据点 30 CP / 支部 50 CP / 大本营 90 CP
 * ============================================================ */
 function awardCaptureCP(g, side, postType){
  let value = 0;
  if(postType === 'hq')          value = 90;
  else if(postType === 'branch') value = 50;
  else if(postType === 'point')  value = 30;
  if(value <= 0) return;

  g.cp[side] = Math.min(CP_MAX, g.cp[side] + value);
  if(side === g.playerSide){
    const def = POST_TYPES[postType];
    toast(g, '占领 ' + (def ? def.n : '据点') + ' · +' + value + ' CP', 'good');
  }
}


/* ============ 单位逻辑 ============ */
function cancelMovement(unit) {
  unit.order = null;
  unit.path = null;
  unit.pathI = 0;
}

function moveUnit(g, unit, dt) {
  if (!unit.path) {
    const route = findPath(g, unit.x, unit.y, unit.order.x, unit.order.y, unit.type, unit.side);
    if (!route) {
      cancelMovement(unit);
      return;
    }
    unit.path = smoothPath(g, route, unit.x, unit.y, unit.type, unit.side);
    unit.pathI = 0;
  }

  const waypoint = unit.path[unit.pathI];
  const dx = waypoint.x - unit.x;
  const dy = waypoint.y - unit.y;
  const distance = Math.hypot(dx, dy);
  const travel = unitSpeedInTerrain(g, unit) * dt;
  if (distance < 0.001) {
    unit.pathI++;
  } else {
    const fraction = Math.min(1, travel / distance);
    const x = unit.x + dx * fraction;
    const y = unit.y + dy * fraction;
    if (!canWalk(g, x, y, unit.type) || (unit.side === 'def' &&
        !isDefForbiddenArea(g, unit.x, unit.y) && isDefForbiddenArea(g, x, y))) {
      cancelMovement(unit);
      return;
    }
    unit.x = x;
    unit.y = y;
    unit.facing = Math.atan2(dy, dx);
    if (fraction === 1) unit.pathI++;
  }
  if (unit.pathI === unit.path.length) cancelMovement(unit);
}

function attackUnits(g, units, target) {
  for (const unit of units) {
    if (!unit.alive || unit.side === target.side || !visible(g, unit.side, target.x, target.y)) continue;
    unit.tid = target.id;
    unit.holdPost = 0;
    unit._resupplying = false;
    cancelMovement(unit);
    if (dist2(unit.x, unit.y, target.x, target.y) > effectiveRange(g, unit, UNITS[unit.type]) ** 2) {
      unit.order = { type: 'move', x: target.x, y: target.y, attack: target.id };
    }
  }
}

function updateUnit(g,u,dt){
  const d=UNITS[u.type];
  updateReadiness(g, u, dt);
  const cadence = g.frontline
    ? (0.60 + 0.40 * Math.min(1, u.supply / 0.35)) * (1 - 0.58 * u.suppression)
    : 1;
  if(u.cd>0)u.cd-=dt*cadence;
  if(u.aimTimer>0)u.aimTimer-=dt*cadence;
  {
    const enemySide=u.side==='atk'?'def':'atk';
    if(visible(g,enemySide,u.x,u.y))u.observedTime=Math.min(10,(u.observedTime||0)+dt);
    else u.observedTime=Math.max(0,(u.observedTime||0)-dt*3);
  }
  if((g.tick+(u.id%30))%30===0){
    if(!canWalk(g,u.x,u.y,u.type)){
      let best=null,bestD=Infinity;
      for(let r=1;r<=6&&!best;r++){
        for(let dy=-r;dy<=r;dy++)for(let dx=-r;dx<=r;dx++){
          if(Math.abs(dx)!==r&&Math.abs(dy)!==r)continue;
          const nx=u.x+dx*CELL*0.4,ny=u.y+dy*CELL*0.4;
          if(nx<0||ny<0||nx>=MAP_W*CELL||ny>=MAP_H*CELL)continue;
          if(canWalk(g,nx,ny,u.type)){const dd=dist2(u.x,u.y,nx,ny);if(dd<bestD){bestD=dd;best={x:nx,y:ny};}}
        }
      }
      if(best){u.x=best.x;u.y=best.y;}
    }
  }
  if(u.type==='eng'){
    let near=null,nd=Infinity;
    for(const t of g.turrets){
      if(t.owner!==u.side)continue;
      if(t.hp>=t.maxHp)continue;
      const dd=dist2(u.x,u.y,t.x,t.y);
      if(dd<80*80 && dd<nd){nd=dd;near=t;}
    }
    if(near){
      const healRate=near.maxHp*0.025;
      near.hp=Math.min(near.maxHp,near.hp+healRate*dt);
      if(Math.random()<0.2)addEffect(g,{type:'ring',x:near.x,y:near.y,r:near.r+8,life:.3,max:.3,col:'#66e09a'});
    }
  }
  if (u.order?.attack) {
    const mark = findUnitById(g, u.order.attack) || g.turrets.find(turret => turret.id === u.order.attack);
    if (!mark || mark.hp <= 0 || mark.side === u.side) cancelMovement(u);
    else if (visible(g, u.side, mark.x, mark.y)) {
      const range = effectiveRange(g, u, d);
      const clear = u.type === 'art' || hasLOS(g, u.x, u.y, mark.x, mark.y);
      if (clear && dist2(u.x, u.y, mark.x, mark.y) <= (range * 0.95) ** 2) cancelMovement(u);
      else if (dist2(u.order.x, u.order.y, mark.x, mark.y) > CELL ** 2) {
        u.order.x = mark.x;
        u.order.y = mark.y;
        u.path = null;
      }
    }
  }
  if (u.order?.type === 'move') moveUnit(g, u, dt);

  const range = effectiveRange(g, u, d);
  const searchRangeSquared = (range * 1.05) ** 2;
  const canTrack = (enemy, radiusSquared) =>
    enemy.hp > 0 && enemy.side !== u.side && enemy.side !== 'neutral' &&
    dist2(u.x, u.y, enemy.x, enemy.y) <= radiusSquared &&
    canAttackUnit(g, u, enemy) && visible(g, u.side, enemy.x, enemy.y) &&
    (u.type === 'art' || (
      hasLOS(g, u.x, u.y, enemy.x, enemy.y) &&
      !crossesSmoke(g, u.x, u.y, enemy.x, enemy.y)
    ));

  let target = null;
  if (u.tid) {
    const intended = findUnitById(g, u.tid) || g.turrets.find(turret => turret.id === u.tid);
    if (!intended || intended.hp <= 0 || intended.side === u.side) u.tid = 0;
    else if (canTrack(intended, (range * 1.15) ** 2)) target = intended;
  }
  if (!target) {
    let best = searchRangeSquared;
    for (const enemies of [g.units, g.turrets]) {
      for (const enemy of enemies) {
        if (!canTrack(enemy, best)) continue;
        best = dist2(u.x, u.y, enemy.x, enemy.y);
        target = enemy;
      }
    }
  }
  /* 索敌状态机：0.8秒持续观察、1秒宽限 */
  if(u._combatLost===undefined)u._combatLost=0;
  if(u._engaged===undefined)u._engaged=false;
  if(u._combatTarget===undefined)u._combatTarget=0;
  if(u._combatTime===undefined)u._combatTime=0;

  if(target){
    if(u._combatTarget!==target.id){
      u._combatTime = 0;
      u._engaged = false;
      u._combatTarget = target.id;
    }
    u._combatTime+=dt;
    u._combatLost=0;
    if(u._combatTime>=OBSERVE_TIME)u._engaged=true;
  }else{
    u._combatLost+=dt;
    if(u._combatLost>OBSERVE_GRACE){
      u._combatTarget=0;u._combatTime=0;u._engaged=false;
    }
  }
  if(d.keepRange && target && !u._resupplying){
    const dd=dist(u.x,u.y,target.x,target.y);
    const tooClose=range*0.55;
    const tooFar=range*1.0;
    if(dd<tooClose){
      if(!u.order || u.order.type!=='move' || dist(u.order.x,u.order.y,target.x,target.y)<dd){
        const ang=Math.atan2(u.y-target.y,u.x-target.x);
        const backX=u.x+Math.cos(ang)*35,backY=u.y+Math.sin(ang)*35;
        if(canWalk(g,backX,backY,u.type)){u.order={type:'move',x:backX,y:backY};u.path=null;u.pathI=0;}
      }
    } else if(dd>tooFar && !u.order){
      const ang=Math.atan2(target.y-u.y,target.x-u.x);
      const fwdX=u.x+Math.cos(ang)*30,fwdY=u.y+Math.sin(ang)*30;
      if(canWalk(g,fwdX,fwdY,u.type)){u.order={type:'move',x:fwdX,y:fwdY};u.path=null;u.pathI=0;}
    } else {
      if(u.order&&u.order.type==='move'){u.order=null;u.path=null;}
    }
  }
  if (u.aimTarget && target?.id !== u.aimTarget) {
    u.aimTarget = 0;
    u.aimTimer = 0;
  }
  const armed = u._engaged;
  if(target&&u.cd<=0&&armed){
    const dd=dist(u.x,u.y,target.x,target.y);
    const minRange = d.keepRange ? range*0.55 : 0;
    if(dd<=range && dd>=minRange){
      if(d.aim&&d.aim>0){
        u.facing = Math.atan2(target.y - u.y, target.x - u.x);
        if(u.aimTarget!==target.id){u.aimTarget=target.id;u.aimTimer=d.aim;}
        else if(u.aimTimer<=0){u.cd=d.cd;u.aimTarget=0;u.facing=Math.atan2(target.y-u.y,target.x-u.x);fire(g,u,target);}
      } else {
        u.cd=d.cd;u.facing=Math.atan2(target.y-u.y,target.x-u.x);fire(g,u,target);
      }
    } else if (u.aimTarget) {
      u.aimTarget = 0;
      u.aimTimer = 0;
    }
  }
  if(d.trench&&u.order&&u.order.type==='trench'){
    u.trenchTimer+=dt;
    if(u.trenchTimer>=3.2){u.trenchTimer=0;g.trenches.push({x:u.x,y:u.y,r:34,side:u.side});addEffect(g,{type:'ring',x:u.x,y:u.y,r:36,life:.5,max:.5,col:'#8ad0ff'});u.order=null;}
  }
  if(u.planId && !u.order && !u.tid && readyToResume(g, u)){
    const plan=g.plans.find(p=>p.id===u.planId);
    if(plan && plan.state==='active'){
      const pts=plan.points||plan.targetPoints||[];
      if(pts.length>=2){
        const t=Math.random();
        const tx=lerp(pts[0].x,pts[pts.length-1].x,t);
        const ty=lerp(pts[0].y,pts[pts.length-1].y,t);
        u.order={type:'move',x:tx,y:ty};u.path=null;u.pathI=0;
      }
    }
  }
}
function findUnitById(g,id){for(const u of g.units)if(u.id===id)return u;return null;}
function fire(g,u,target){
  const d=UNITS[u.type];
  if (g.frontline) {
    u.supply = Math.max(0, u.supply - d.cd * 0.009);
  }
  Snd.fire(g, u.x, u.y, u.type, u.side);
  let mult=1.0;
  if(target.observedTime&&target.observedTime>2)mult=1.25;
  mult*=g.env.dmgMul||1;
  mult*=u._dmgMul||1;
  if(u.planId){const b=g._planBonuses[u.side]||0;mult*=(1+b*0.3);}
  if(u.type==='art'){
    g.projectiles.push({x:u.x,y:u.y,tx:target.x+rnd(-12,12),ty:target.y+rnd(-12,12),t:0,flight:Math.max(.7,dist(u.x,u.y,target.x,target.y)/330),dmg:d.dmg*mult,splash:d.splash,side:u.side,neutral:false});
  }else{
    const dmg=calcDamage(g,u,target,d.dmg*mult);
    applyDamage(g,target,dmg,u.side);
    addEffect(g,{type:'tracer',x1:u.x,y1:u.y,x2:target.x,y2:target.y,life:.12,max:.12,col:TEAM_COLORS[u.side],side:u.side,munition:u.type});
  }
}
function calcDamage(g,attacker,target,base){
  let red=coverAt(g,target.x,target.y);
  for(const tr of g.trenches){if(tr.side===target.side&&dist2(tr.x,tr.y,target.x,target.y)<tr.r*tr.r){red=Math.max(red,.38);break;}}
  return base*(1-red);
}
function applyDamage(g,target,dmg,attackerSide){
  if(target.alive===false)return;
  if(target.hp<=0)return;
  target.hp-=dmg;
  if (g.frontline && target.alive !== undefined) {
    target.suppression = clamp(target.suppression + Math.min(0.52, dmg / target.maxHp * 1.8), 0, 1);
  }
  if(target.hp<=0){
    target.hp=0;
    if (target.alive !== undefined) {
      target.alive = false;
      g.stats[target.side].losses++;
    }
    addEffect(g,{type:'boom',x:target.x,y:target.y,r:22,life:.5,max:.5,side:target.side});
    if (CFG.shake && !g.mp && visible(g, g.playerSide, target.x, target.y)) g.shake=Math.min(1,g.shake+0.04);
    Snd.boom(g, target.x, target.y, target.type === 'arm', target.side);
    if (attackerSide && UNITS[target.type] && attackerSide !== target.side) {
      let reward = Math.max(3, Math.round(UNITS[target.type].cost * 0.64));
      if (attackerSide === 'def') reward = Math.round(reward * 1.1);
      g.cp[attackerSide] = Math.min(CP_MAX, g.cp[attackerSide] + reward);
    }
  }
}
function updateTurret(g,t,dt){
  if(t.ruin){
    let best=null,bd=Infinity;
    for(const u of g.units){
      if(!u.alive)continue;
      if(u.side==='neutral')continue;
      const dd=dist2(t.x,t.y,u.x,u.y);
      if(dd<80*80 && dd<bd){bd=dd;best=u;}
    }
    if(best){
      t.owner=best.side;t.side=best.side;t.ruin=false;t.hp=t.maxHp*0.3;
      addEffect(g,{type:'ring',x:t.x,y:t.y,r:40,life:.6,max:.6,col:best.side==='atk'?'#ff8a5c':'#6cb6ff'});
      if(g.playerSide===best.side)toast(g,'占领了哨塔废墟','good');
    }
    return;
  }
  const d=TURRETS[t.type];
  if(t.cd>0)t.cd-=dt;
  if(t.cd>0)return;
  let best=null,bd=Infinity;
  const R=d.range;
  const enemyOf = (t.owner==='atk')?'def':(t.owner==='def'?'atk':null);
  if(!enemyOf)return;
  const isWatchtower=(t.type==='watchtower');
  for(const u of g.units){
    if(u.side!==enemyOf||!u.alive)continue;
    if (!isWatchtower && !visible(g, t.owner, u.x, u.y)) continue;
    if (!hasLOS(g, t.x, t.y, u.x, u.y) || crossesSmoke(g, t.x, t.y, u.x, u.y)) continue;
    if(!canAttackUnit(g,t,u) && t.owner==='def')continue;
    const dd=dist2(t.x,t.y,u.x,u.y);
    if(dd<R*R&&dd<bd){bd=dd;best=u;}
  }
  if(best){
    t.cd=d.cd;
    const dmg=calcDamage(g,t,best,d.dmg*(g.env.dmgMul||1));
    applyDamage(g,best,dmg,t.owner);
    addEffect(g,{type:'tracer',x1:t.x,y1:t.y,x2:best.x,y2:best.y,life:.12,max:.12,col:TEAM_COLORS[t.owner],side:t.owner,munition:t.type==='fort'||t.type==='at'?'arm':'inf'});
    Snd.fire(g, t.x, t.y, t.type === 'fort' || t.type === 'at' ? 'arm' : 'inf', t.owner);
  }
}
function updateProjectiles(g,dt){
  for(let i=g.projectiles.length-1;i>=0;i--){
    const p=g.projectiles[i];
    p.t+=dt;
    if(p.t>=p.flight){
      if(inAtkSafeZone(g,p.tx,p.ty)){g.projectiles.splice(i,1);continue;}
      const R=(p.splash||26);
      checkOilTankImpact(g, p.tx, p.ty, R);
      const cx0=Math.floor((p.tx-R)/CELL),cx1=Math.floor((p.tx+R)/CELL);
      const cy0=Math.floor((p.ty-R)/CELL),cy1=Math.floor((p.ty+R)/CELL);
      let destroyed=false;
      for(let cy=cy0;cy<=cy1;cy++)for(let cx=cx0;cx<=cx1;cx++){
        if(cx<0||cy<0||cx>=MAP_W||cy>=MAP_H)continue;
        const gx=cx*CELL+CELL/2,gy=cy*CELL+CELL/2;
        if(dist2(gx,gy,p.tx,p.ty)>R*R)continue;
        const idx=cy*MAP_W+cx;
        if(g.terrain[idx]===T_BUILDING){g.terrain[idx]=T_RUBBLE;destroyed=true;}
      }
      if (destroyed) invalidateTerrain(g);
      addEffect(g,{type:'boom',x:p.tx,y:p.ty,r:R,life:.7,max:.7});
      if(CFG.shake && !g.mp && visible(g,g.playerSide,p.tx,p.ty)) g.shake=Math.min(1,g.shake+.22);
      Snd.boom(g, p.tx, p.ty, R > 32);
      const targets=[];
      for (const u of g.units) {
        if (!u.alive || (!p.neutral && u.side === p.side)) continue;
        const dd = dist(u.x,u.y,p.tx,p.ty);
        if (dd <= R + UNITS[u.type].r) targets.push({ u, dd });
        else if (g.frontline && dd < R * 2.4) {
          u.suppression = Math.min(1, u.suppression + 0.28 * (1 - dd / (R * 2.4)));
        }
      }
      for(const t of g.turrets){if(!p.neutral&&t.owner===p.side)continue;const dd=dist(t.x,t.y,p.tx,p.ty);if(dd<=R+t.r)targets.push({u:t,dd});}
      for(const it of targets){
        const f=1-clamp(it.dd/(R+10),0,1);
        const dmg=p.dmg*(.45+.55*f)*(1-coverAt(g,it.u.x,it.u.y)*.5);
        applyDamage(g,it.u,dmg,p.neutral?null:p.side);
      }
      g.projectiles.splice(i,1);
    }
  }
}

/* ============================================================
 * 据点占领 —— 修复进度条卡死
 *
 * 核心改动：
 *  · cap 统一表示「当前 owner 的控制度」(0 ~ def.cap)
 *  · 攻方占领后 cap 从 30% 平滑推进到 100%（整合过程）
 *  · 守方推回时 cap 从当前值下降到 0% 再翻转所有权
 *  · 大本营/支部/据点各自的整合时长由 POST_TYPES 决定
 * ============================================================ */
 function updatePosts(g,dt){
  for(const p of g.posts){
    if(p._disabled) continue;
    const def = POST_TYPES[p.type];
    const R   = def.radius;

    /* --- 统计据点半径内双方部署容量 --- */
    let atkP=0, defP=0;
    for(const u of g.units){
      if(!u.alive) continue;
      if(dist(u.x, u.y, p.x, p.y) > R) continue;
      const w = UNIT_SLOTS[u.type] * (g.frontline ? 1 - 0.38 * u.suppression : 1);
      if(u.side==='atk') atkP += w; else defP += w;
    }
    /* 供渲染层显示颜色用 */
    p._atkP = atkP;
    p._defP = defP;

    const BASE_RATE = 5;           /* 无对抗时 5/s */
    const total     = atkP + defP;
    const atkRatio  = total > 0 ? atkP/total : 0;
    const defRatio  = total > 0 ? defP/total : 0;
    const netFlow   = atkRatio - defRatio;   /* >0 攻方推进；<0 守方推进 */

    /* ============================================================
     * 攻方拥有
     * ============================================================ */
    if(p.owner === 'atk'){
      if(netFlow < 0){
        /* 守方推回：攻方控制度下降 */
        const rate = -netFlow * BASE_RATE;
        p.cap = Math.max(0, p.cap - rate*dt);
        if(p.cap <= 0){
          p.owner='def';
          p.cap=def.cap;
          p.integrate=1;
          p._fullyIntegrated=false;
          toast(g,'守方夺回了 '+p.name, g.playerSide==='def'?'good':'bad');
          addEffect(g,{type:'ring',x:p.x,y:p.y,r:80,life:.8,max:.8,col:'#4c9cff'});
          awardCaptureCP(g,'def',p.type);
          updateDeployPoints(g);
          if (visible(g, g.playerSide, p.x, p.y) || p.owner === g.playerSide) Snd.capture();
        }
      } else if(total > 0){
        /* 整合推进：控制度从 30% 涨到 100% */
        const myRatio = atkP/total;
        if(myRatio >= 0.8){
          p.integrate = Math.min(1, p.integrate + dt/def.integrate);
        } else {
          p.integrate = Math.max(0, p.integrate - dt*0.15);
        }
        /* ★ 关键：同步 cap，让进度条随整合推进 */
        p.cap = def.cap * (0.3 + 0.7 * p.integrate);

        if(p.integrate >= 1 && !p._fullyIntegrated){
          p._fullyIntegrated = true;
          toast(g, p.name+' 整合完成，可部署部队', g.playerSide==='atk'?'good':'bad');
          updateDeployPoints(g);
        }
      }
      /* total===0 时不做任何事（无单位在场，保持现状） */
    }
    /* ============================================================
     * 守方 / 中立拥有
     * ============================================================ */
    else {
      if(netFlow > 0){
        /* 攻方推回：守方控制度下降 */
        const rate = netFlow * BASE_RATE;
        p.cap = Math.max(0, p.cap - rate*dt);
        if(p.cap <= 0){
          p.owner='atk';
          p.cap = def.cap * 0.3;
          p.integrate = 0;
          p._fullyIntegrated = false;
          toast(g,'攻方占领了 '+p.name, g.playerSide==='atk'?'good':'bad');
          addEffect(g,{type:'ring',x:p.x,y:p.y,r:80,life:.8,max:.8,col:'#ff7a4c'});
          awardCaptureCP(g,'atk',p.type);
          updateDeployPoints(g);
          if (visible(g, g.playerSide, p.x, p.y) || p.owner === g.playerSide) Snd.capture();
        }
      }
      /* 否则守方保持 */
    }
  }
}

/* ============ 部署 ============ */
function usedSlots(g,side){
  /* 关键改动：只统计“正在部署中”的单位槽位
     部署完成后立即释放，允许流水线持续补充 */
  let s=0;
  for(const d of g.deploying){if(d.side===side)s+=UNIT_SLOTS[d.type]||2;}
  return s;
}
function emergencyActive(g,side){return g._emergency[side] && g._emergency[side]>g.time;}
function slotCap(g,side){
  let cap=DEPLOY_CAP_SLOTS[side]||12;
  if(emergencyActive(g,side))cap*=1.5;
  return cap;
}
function getDeployPoint(g, side, x, y) {
  let closest = null;
  let distance = Infinity;
  for (const point of g.deployPoints) {
    if (point.side !== side) continue;
    const d = dist2(x, y, point.x, point.y);
    if (d <= point.r ** 2 && d < distance) {
      closest = point;
      distance = d;
    }
  }
  return closest;
}

function deploymentCost(g, side, type, point) {
  const base = UNITS[type].cost * (side === 'def' ? DEF_DEPLOY_COST_MUL : 1);
  const post = g.posts[point?.postId];
  return Math.round(base * (post ? POST_TYPES[post.type].costMul : 1));
}

function availableDeploymentCost(g, type) {
  const side = g.playerSide;
  const points = g.deployPoints.filter(point => point.side === side);
  return Math.min(deploymentCost(g, side, type), ...points.map(point => deploymentCost(g, side, type, point)));
}

function digTrenches(g, side, units) {
  const engineers = units.filter(unit => unit.alive && unit.side === side && unit.type === 'eng' && unit.order?.type !== 'trench');
  if (!engineers.length || g.cp[side] < 5) return false;
  g.cp[side] -= 5;
  for (const unit of engineers) {
    unit.order = { type: 'trench' };
    unit.path = null;
    unit.trenchTimer = 0;
    unit._resupplying = false;
  }
  return true;
}

function startDeploy(g, side, type, x, y) {
  if (!Object.hasOwn(UNITS, type) || !Number.isFinite(x) || !Number.isFinite(y)) return null;
  const point = getDeployPoint(g, side, x, y);
  if (!point) {
    if (side === g.playerSide) toast(g, '请点击己方部署圈内的地面', 'bad');
    return null;
  }
  if (!canWalk(g, x, y, type) || (side === 'def' && isDefForbiddenArea(g, x, y))) {
    if (side === g.playerSide) toast(g, '该地形无法部署此兵种', 'bad');
    return null;
  }
  const post = g.posts[point.postId];
  const postType = post ? POST_TYPES[post.type] : null;
  const cost = deploymentCost(g, side, type, point);
  if (g.cp[side] < cost) {
    if (side === g.playerSide) toast(g, '指挥值不足（需要 ' + cost + ' CP）', 'bad');
    return null;
  }
  const deployed = g.units.filter(unit => unit.side === side && unit.alive).length +
    g.deploying.filter(deployment => deployment.side === side).length;
  if (deployed >= UNIT_CAP[side]) {
    if (side === g.playerSide) toast(g, '部队已达上限', 'bad');
    return null;
  }
  if (usedSlots(g, side) + UNIT_SLOTS[type] > slotCap(g, side)) {
    if (side === g.playerSide) toast(g, '部署槽位已满，等待当前批次完成', 'bad');
    return null;
  }

  let duration = (side === 'atk' ? 2.5 : 4) / (postType?.deploySpeedMul ?? 1);
  if (post) {
    let nearestEnemy = Infinity;
    for (const unit of g.units) {
      if (unit.alive && unit.side !== side) {
        nearestEnemy = Math.min(nearestEnemy, dist2(unit.x, unit.y, post.x, post.y));
      }
    }
    if (nearestEnemy < postType.radius ** 2) duration /= 0.4;
    else if (nearestEnemy < 300 ** 2) duration /= 0.75;
  }
  if (emergencyActive(g, side)) duration /= 1.5;
  const deployment = { x, y, type, side, timeLeft: duration, total: duration, order: null, cost };
  g.cp[side] -= cost;
  g.deploying.push(deployment);
  if (side === g.playerSide) Snd.deploy();
  return deployment;
}

function updateDeploy(g, dt) {
  for (let i = g.deploying.length - 1; i >= 0; i--) {
    const deployment = g.deploying[i];
    deployment.timeLeft -= dt;
    if (deployment.timeLeft > 0) continue;
    g.deploying.splice(i, 1);
    const { side, type, x, y, cost } = deployment;
    if (!getDeployPoint(g, side, x, y) || !canWalk(g, x, y, type)) {
      g.cp[side] = Math.min(CP_MAX, g.cp[side] + (cost ?? 0));
      if (side === g.playerSide) toast(g, '部署位置失效，已退还指挥值', 'bad');
      continue;
    }
    const unit = spawnUnit(g, side, type, x, y);
    g.stats[side].deployed++;
    addEffect(g, { type: 'ring', x, y, r: 30, life: 0.5, max: 0.5, col: TEAM_COLORS[side], side });
    if (deployment.order) {
      unit.order = deployment.order;
      unit.holdPost = 1;
    }
    if (side === g.playerSide) {
      toast(g, UNITS[type].n + ' 部署完成', 'good');
      Snd.deployDone();
    }
  }
}

/* ============ 胜负 ============ */
function checkVictory(g){
  if(g.tutorial) return;
  const hq=g.posts.find(p=>p.type==='hq');
  const branches=g.posts.filter(p=>p.type!=='hq' && !p._disabled);
  const atkB=branches.filter(p=>p.owner==='atk').length;
  const need=Math.ceil(branches.length * 0.5);
  if(hq && hq.owner==='atk' && atkB>=need){endGame(g,'atk');return;}
  if(g.time>=g.duration)endGame(g,'def');
}
function endGame(g,winner){
  removeTutBox();
  g.state='over';g.result=winner;
  const playerWin=(winner===g.playerSide);
  const rt=document.getElementById('rTitle');const rs=document.getElementById('rSub');const rl=document.getElementById('result');
  rt.textContent=g.tutorial?'训练完成':(playerWin?'胜利':'失败');
  rl.className='overlay '+(playerWin?'win':'lose');
  rl.classList.remove('hidden');
  const hq=g.posts.find(p=>p.type==='hq');
  const branches=g.posts.filter(p=>p.type!=='hq' && !p._disabled);
  const atkB=branches.filter(p=>p.owner==='atk').length;
  const s=SEASONS[g.season];
  const report = [
    g.tutorial ? '已完成全部训练目标' : (winner === 'atk' ? '攻方夺取大本营并控制指定数量的据点' : '守方坚持到战役结束'),
    '用时 ' + fmtTime(g.time) + ' · 攻方控制 ' + atkB + '/' + branches.length + ' 处外围据点',
    '己方损失 ' + g.stats[g.playerSide].losses + ' 支 · 增援 ' + g.stats[g.playerSide].deployed + ' 支',
    s.n + '季 · ' + g.weather.name,
  ];
  rs.replaceChildren(...report.map(text => {
    const line = document.createElement('div');
    line.textContent = text;
    return line;
  }));
  show(document.getElementById('hud'),false);
  if(CFG.snd)playerWin?Snd.win():Snd.lose();
}
function fmtTime(t){const m=Math.floor(t/60),s=Math.floor(t%60);return m+':'+(s<10?'0':'')+s;}
function getSpawnPoints(g, side) {
  return g.deployPoints.filter(point => point.side === side);
}
function useSkill(g,side,key,x,y){
  if (!Object.hasOwn(SKILLS, key) || (key === 'smoke' && !g.frontline)) return false;
  const s=SKILLS[key];
  if(key==='emergency'){
    const cost=side==='atk'?s.costAtk:s.costDef;
    if(g.cp[side]<cost)return false;
    if(g._emergency[side]&&g._emergency[side]>g.time)return false;
    if((g.cd[side][key]||0)>0)return false;
    g.cp[side]-=cost;
    g.cd[side][key]=s.cd;
    g._emergency[side]=g.time+s.dur;
    if (side === g.playerSide) Snd.skill();
    if(side===g.playerSide)toast(g,'紧急部署已激活 · 25秒内部署加速','good');
    return true;
  }
  if (key === 'march') {
    const units = side === g.playerSide ? g.selection : g.units;
    return startMarch(g, side, units);
  }
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x >= MAP_W * CELL || y >= MAP_H * CELL) return false;
  if(g.cp[side]<s.cost)return false;
  if((g.cd[side][key]||0)>0)return false;
  if(s.maxRange){
    let inRange=false;
    for(const u of g.units){if(u.side!==side||!u.alive)continue;if(dist(u.x,u.y,x,y)<=s.maxRange){inRange=true;break;}}
    if(!inRange){for(const p of g.posts){if(p.owner!==side)continue;if(dist(p.x,p.y,x,y)<=s.maxRange){inRange=true;break;}}}
    if(!inRange){if(side===g.playerSide)toast(g,'超出射程 · 需己方基地/据点1000范围内','bad');return false;}
  }
  if(s.friendlyRange){
    let ok=false;
    for(const u of g.units){if(u.side!==side||!u.alive)continue;if(dist(u.x,u.y,x,y)<=s.friendlyRange){ok=true;break;}}
    if(!ok){if(side===g.playerSide)toast(g,s.n + '需在己方部队 ' + s.friendlyRange + ' 范围内','bad');return false;}
  }
  g.cp[side]-=s.cost;
  g.cd[side][key]=s.cd;
  if (key === 'smoke') {
    g.smokes.push({ side, x, y, radius: s.radius, until: g.time + s.dur });
    recomputeVis(g, 'atk');
    recomputeVis(g, 'def');
  } else if (key === 'recon') {
    g.recon.push({ side, x, y, r: s.radius, until: g.time + s.dur });
    addEffect(g, { type: 'recon', x, y, r: s.radius, life: s.dur, max: s.dur, side });
    recomputeVis(g, side);
  } else {g.strikes.push({side,key,x,y,radius:s.radius,t:0,delay:1.6,dur:s.dur,dps:s.dps,tick:0,neutral:!!s.neutral});addEffect(g,{type:'target',x,y,r:s.radius,life:1.6,max:1.6});}
  if (side === g.playerSide) Snd.skill();
  return true;
}
function startMarch(g, side, units) {
  const selected = units.filter(unit => unit.alive && unit.side === side);
  const cost = selected.reduce((total, unit) => total + UNIT_SLOTS[unit.type] * 2, 0);
  const skill = SKILLS.march;
  if (!selected.length || g.cp[side] < cost || g.cd[side].march > 0) return false;
  g.cp[side] -= cost;
  g.cd[side].march = skill.cd;
  for (const unit of selected) g._marchUnits.set(unit.id, g.time + skill.dur);
  if (side === g.playerSide) {
    Snd.skill();
    toast(g, '急行军 · 30 秒内移速提高 50%', 'good');
  }
  return true;
}

function updateStrikes(g,dt){
  for(let i=g.strikes.length-1;i>=0;i--){
    const s=g.strikes[i];
    s.t+=dt;
    if(s.t<s.delay)continue;
    s.tick-=dt;
    if(s.tick<=0){
      s.tick=0.6;
      const n=s.key==='airstrike'?2:1;
      for(let k=0;k<n;k++){
        const a=Math.random()*6.283,rr=Math.random()*s.radius;
        const x=s.x+Math.cos(a)*rr,y=s.y+Math.sin(a)*rr;
        if(inAtkSafeZone(g,x,y))continue;
        g.projectiles.push({x:x+rnd(-160,160),y:y-220,tx:x,ty:y,t:0,flight:.55,dmg:s.dps*.32,splash:s.key==='airstrike'?40:28,side:s.side,neutral:!!s.neutral});
      }
    }
    if(s.t>s.delay+s.dur)g.strikes.splice(i,1);
  }
}
function addEffect(g, effect) {
  if (g.mp?.isHost && ['tracer', 'boom', 'target'].includes(effect.type)) {
    g._effectSequence = (g._effectSequence || 0) + 1;
    effect.netId = g._effectSequence;
  }
  g.effects.push(effect);
  if (g.effects.length > 220) g.effects.shift();
}
