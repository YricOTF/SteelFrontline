"use strict";

/* ============ 教程 / 存档 / 设置 ============ */
const TUT_STEPS = [
  {title:'1 / 6 · 移动视角',text:'单指拖动；双指捏合。\n先把视角拖到中间的中立支部。',hint:'拖动地图',check(g,ev){if(ev.type!=='cam')return false;const post=g.posts.find(p=>p.name==='中立支部');if(!post)return false;return dist(g.cam.x,g.cam.y,post.x,post.y)<180;}},
  {title:'2 / 6 · 选中单位',text:'点击己方单位选中。\n选中你的一名步兵。',hint:'点击单位',check(g,ev){return ev.type==='sel'&&g.selection.length>0;}},
  {title:'3 / 6 · 移动与占领',text:'点击地图任意位置命令部队移动。\n把部队移动到中立支部附近即可占领。',hint:'移动至中立支部',check(g){const post=g.posts.find(p=>p.name==='中立支部');return post&&post.owner===g.playerSide&&post.integrate>=1;}},
  {title:'4 / 6 · 部署部队',text:'点击兵种卡片，再点击地图上的橙色部署点圈内。\n试着部署一名步兵。',hint:'部署步兵',check(g,ev){return ev.type==='deploy'||g.deploying.some(d=>d.side===g.playerSide);}},
  {title:'5 / 6 · 交战',text:'部队持续看到敌人 0.8 秒后进入交战并自动开火。\n靠近敌方支部，清掉守军。',hint:'击溃敌军',check(g){return g.stats.def.losses > 0;}},
  {title:'6 / 6 · 拿下指挥部',text:'占领敌方支部后，继续推进攻下敌方指挥部即可获胜。',hint:'占领敌方指挥部',check(g){const hq=g.posts.find(p=>p.type==='hq'&&p.name==='敌方指挥部');return hq&&hq.owner===g.playerSide;}},
];
function startTutorial(){
  removeTutBox();
  G=makeGame({mapId:'tutorial',side:'atk',diff:'easy',dayTime:0});
  G.tutorial={idx:0,lastEv:null};G._clientReady=true;
  G.units = G.units.filter(unit => unit.side === 'atk' || unit.type === 'inf');
  for (const unit of G.units) if (unit.side === 'def') unit.hp *= 0.65;
  startPlaying();showTutHint();toast(G,'新兵训练开始','good');
}
function showTutHint(){
  if(!G||!G.tutorial)return;
  const step=TUT_STEPS[G.tutorial.idx];
  if (!step) return;
  let box=document.getElementById('tutBox');
  if (!box) {
    box = document.createElement('div');
    box.id = 'tutBox';
    box.setAttribute('role', 'status');
    document.body.appendChild(box);
  }
  box.innerHTML = '<div class="tutorial-title">' + step.title +
    '</div><div class="tutorial-text">' + step.text + '</div>';

}
function removeTutBox(){const box=document.getElementById('tutBox');if(box)box.remove();}
function tutStep(dt){
  if(!G||!G.tutorial)return;
  if(G.tutorial.idx>=TUT_STEPS.length)return;
  const step=TUT_STEPS[G.tutorial.idx];
  const ev=G.tutorial.lastEv||{type:'none'};
  if(step.check(G,ev)){
    G.tutorial.lastEv=null;G.tutorial.idx++;
    if (G.tutorial.idx >= TUT_STEPS.length) { endGame(G, G.playerSide); return; }
    toast(G,'✓ 完成 '+G.tutorial.idx+'/'+TUT_STEPS.length,'good');showTutHint();
  }
}
const SAVE_KEY_SOLO='steel_frontline_v24_saves_solo';
const SAVE_KEY_MULTI='steel_frontline_v24_saves_multi';
let saveTab='solo';
function readSaves() {
  const key = saveTab === 'solo' ? SAVE_KEY_SOLO : SAVE_KEY_MULTI;
  try {
    const saves = JSON.parse(localStorage.getItem(key) || '[]');
    return Array.isArray(saves) ? saves.filter(save => save?.data?.cfg && Array.isArray(save.data.units)) : [];
  } catch {
    return [];
  }
}
function writeSaves(saves) {
  const key = saveTab === 'solo' ? SAVE_KEY_SOLO : SAVE_KEY_MULTI;
  try {
    localStorage.setItem(key, JSON.stringify(saves));
    return true;
  } catch {
    return false;
  }
}
function serialize(g) {
  return {
    v: 26, cfg: g.cfg, time: g.time,
    cp: g.cp, cpFrac: g.cpFrac, stats: g.stats,
    season: g.season, dayTime: g.dayTime,
    terrain: encodeCells(g.terrain),
    explored: { atk: encodeCells(g.explored.atk), def: encodeCells(g.explored.def) },
    units: g.units.filter(unit => unit.alive).map(unit => ({
      id: unit.id, side: unit.side, type: unit.type,
      x: unit.x, y: unit.y, hp: unit.hp, maxHp: unit.maxHp, facing: unit.facing,
      hold: unit.holdPost, tid: unit.tid, cd: unit.cd, trenchTimer: unit.trenchTimer,
      combatTarget: unit._combatTarget, combatTime: unit._combatTime, combatLost: unit._combatLost,
      aimTarget: unit.aimTarget, aimTimer: unit.aimTimer, engaged: unit._engaged,
      order: unit.order, planId: unit.planId,
      supply: unit.supply, suppression: unit.suppression, resupplying: unit._resupplying,
    })),
    posts: g.posts.map(post => ({
      owner: post.owner, cap: post.cap, integrate: post.integrate,
      disabled: Boolean(post._disabled), fi: Boolean(post._fullyIntegrated),
    })),
    turrets: g.turrets.map(turret => ({
      id: turret.id, type: turret.type, x: turret.x, y: turret.y, hp: turret.hp,
      discovered: turret.discovered, owner: turret.owner, ruin: turret.ruin, cd: turret.cd,
    })),
    trenches: g.trenches,
    cd: g.cd, squads: g.squads, plans: g.plans,
    deploying: g.deploying.filter(deployment => !deployment._client),
    recon: g.recon, strikes: g.strikes, projectiles: g.projectiles, smokes: g.smokes,
    emergency: g._emergency, march: [...g._marchUnits],
    tutorial: g.tutorial?.idx,
    mp: g.mp || null,
    battlefieldEvent: g.battlefieldEvent, legacyFire: g.legacyFire,
    oilTanks: g._oilTanks,
  };
}

function deserialize(data) {
  const g = makeGame({
    ...data.cfg, mapRevision: data.cfg.mapRevision ?? 1,
    season: data.season, dayTime: data.dayTime, multiplayer: false,
  });
  g.time = data.time;
  g.cp = { ...data.cp };
  if (data.cpFrac) g.cpFrac = { ...data.cpFrac };
  if (data.stats) g.stats = structuredClone(data.stats);
  const savedTerrain = decodeCells(data.terrain, g.terrain.length, TERRAIN.length - 1);
  if (savedTerrain) {
    g.terrain = savedTerrain;
    invalidateTerrain(g);
    buildTerrainCanvas(g);
  }
  for (const side of ['atk', 'def']) {
    g.explored[side] = decodeCells(data.explored?.[side], g.terrain.length, 1) ?? g.explored[side];
  }

  g.units = [];
  const idMap = new Map();
  for (const saved of data.units) {
    if (!Object.hasOwn(UNITS, saved.type) || saved.hp <= 0) continue;
    const unit = spawnUnit(g, saved.side, saved.type, saved.x, saved.y);
    if (saved.id !== undefined) idMap.set(saved.id, unit.id);
    if (data.v >= 25) {
      unit.x = saved.x;
      unit.y = saved.y;
    }
    unit.hp = saved.hp;
    unit.maxHp = saved.maxHp ?? Math.max(saved.hp, unit.maxHp);
    unit.order = saved.order ? { ...saved.order } : null;
    unit.holdPost = saved.hold || 0;
    unit.planId = saved.planId;
    unit.facing = saved.facing ?? unit.facing;
    unit.supply = saved.supply ?? 1;
    unit.suppression = saved.suppression ?? 0;
    unit._resupplying = Boolean(saved.resupplying);
    unit.trenchTimer = saved.trenchTimer || 0;
    unit.cd = saved.cd || 0;
    unit.tid = saved.tid || 0;
    unit._combatTarget = saved.combatTarget || 0;
    unit._combatTime = saved.combatTime || 0;
    unit._combatLost = saved.combatLost || 0;
    unit._engaged = Boolean(saved.engaged);
    unit.aimTarget = saved.aimTarget || 0;
    unit.aimTimer = saved.aimTimer || 0;
  }
  for (let i = 0; i < Math.min(g.posts.length, data.posts.length); i++) {
    const post = g.posts[i];
    const saved = data.posts[i];
    post.owner = saved.owner;
    post.cap = saved.cap;
    post.integrate = saved.integrate;
    post._fullyIntegrated = Boolean(saved.fi);
    post._disabled = Boolean(saved.disabled);
  }
  g.turrets = (data.turrets || []).map(saved => {
    const def = TURRETS[saved.type];
    const id = uid() + 100000;
    if (saved.id !== undefined) idMap.set(saved.id, id);
    const owner = saved.owner || 'def';
    return { ...saved, id, owner, side: owner, maxHp: def.hp, r: def.r,
      cd: saved.cd || 0, discovered: Boolean(saved.discovered), ruin: Boolean(saved.ruin) };
  });
  for (const unit of g.units) {
    unit.tid = idMap.get(unit.tid) || 0;
    unit._combatTarget = idMap.get(unit._combatTarget) || 0;
    unit.aimTarget = idMap.get(unit.aimTarget) || 0;
    if (!unit.aimTarget) unit.aimTimer = 0;
    if (!unit._combatTarget) {
      unit._combatTime = 0;
      unit._combatLost = 0;
      unit._engaged = false;
    }
    if (unit.order?.attack) unit.order.attack = idMap.get(unit.order.attack) || 0;
  }

  g.trenches = (data.trenches || []).map(trench => ({ r: 34, ...trench }));
  g.cd = data.cd || g.cd;
  g.squads = Object.fromEntries(Object.entries(data.squads || {}).map(([key, ids]) =>
    [key, ids.map(id => idMap.get(id)).filter(Boolean)]
  ));
  g.plans = (data.plans || []).map(plan => ({
    ...plan, peer: undefined, peerPlanId: undefined, unitIds: (plan.unitIds || []).map(id => idMap.get(id)).filter(Boolean),
  }));
  _uid = Math.max(_uid, ...g.plans.map(plan => Number(plan.id) + 1).filter(Number.isFinite));
  g.deploying = data.deploying || [];
  g.recon = data.recon || [];
  g.strikes = data.strikes || [];
  g.projectiles = data.projectiles || [];
  g.smokes = data.smokes || [];
  g._emergency = data.emergency || g._emergency;
  for (const [oldId, until] of data.march || []) {
    const id = idMap.get(oldId);
    if (id && until > g.time) {
      g._marchUnits.set(id, until);
    }
  }
  if (Number.isInteger(data.tutorial)) g.tutorial = { idx: data.tutorial, lastEv: null };
  g.battlefieldEvent = normalizeBattlefieldEvent(data.battlefieldEvent) ?? g.battlefieldEvent;
  g.legacyFire = readLegacyFire(g, data.legacyFire ?? data.events?.burnZones);
  syncBattlefieldEventArea(g);
  if (data.oilTanks) g._oilTanks = data.oilTanks.map(tank => ({ ...tank, alive: Boolean(tank.alive) }));
  g._clientReady = true;
  recomputeVis(g, 'atk');
  recomputeVis(g, 'def');
  updateDeployPoints(g);
  return g;
}

const setupCfg = { mapId: 'island', side: 'atk', diff: 'normal', rules: 'frontline', weather: 'overcast', duration: GAME_LEN };

function updateRuleOptions() {
  const frontline = setupCfg.rules === 'frontline';
  show(document.getElementById('weatherRow'), frontline);
  document.getElementById('rulesDescription').textContent = frontline
    ? '加入补给、压制和烟幕支援。天气影响视野与越野速度。'
    : '沿用部署、战术计划和据点攻防。';
}

function buildSetup() {
  const options = [
    ['mapOpts', 'mapId', MAPS.filter(map => !map.tutorial).map(map => ({
      key: map.id, name: map.n, description: map.desc, tag: map.tag,
    }))],
    ['sideOpts', 'side', [
      { key: 'atk', name: '攻方', description: '夺取大本营及至少一半外围据点。' },
      { key: 'def', name: '守方', description: '守住阵地，直到战役倒计时结束。' },
    ]],
    ['diffOpts', 'diff', Object.entries(DIFFS).map(([key, diff]) => ({
      key, name: diff.n, description: 'AI 强度 ×' + diff.statMul,
    }))],
  ];
  const refreshPreview = () => {
    const map = MAPS.find(map => map.id === setupCfg.mapId);
    drawMapPreview(document.getElementById('mapPreview'), map);
    document.getElementById('previewMap').textContent = map.n + ' · ' + map.tag;
    document.getElementById('briefingRoutes').textContent = map.routes;
    const event = BATTLEFIELD_EVENTS[map.event];
    document.getElementById('briefingEvent').textContent = event.name;
    document.getElementById('briefingImpact').textContent = event.brief;
  };
  for (const [id, setting, records] of options) {
    const group = document.getElementById(id);
    group.replaceChildren(...records.map(({ key, name, description, tag }) => {
      const button = document.createElement('button');
      button.className = 'opt';
      button.dataset.value = key;
      button.classList.toggle('active', setupCfg[setting] === key);
      button.setAttribute('aria-pressed', String(setupCfg[setting] === key));
      button.innerHTML = '<span class="on">' + name +
        (tag ? '<span class="map-tag">' + tag + '</span>' : '') +
        '</span><span class="od">' + description + '</span>';
      button.onclick = () => {
        setupCfg[setting] = key;
        for (const option of group.children) {
          const active = option.dataset.value === key;
          option.classList.toggle('active', active);
          option.setAttribute('aria-pressed', String(active));
        }
        if (setting === 'mapId') refreshPreview();
      };
      return button;
    }));
  }
  refreshPreview();
  document.getElementById('rulesOpts').value = setupCfg.rules;
  document.getElementById('weatherOpts').value = setupCfg.weather;
  document.getElementById('durationOpts').value = String(setupCfg.duration);
  updateRuleOptions();
}

document.getElementById('rulesOpts').onchange = event => {
  setupCfg.rules = event.target.value;
  updateRuleOptions();
};
document.getElementById('weatherOpts').onchange = event => { setupCfg.weather = event.target.value; };
document.getElementById('durationOpts').onchange = event => { setupCfg.duration = Number(event.target.value); };

function buildSaveList() {
  const saves = readSaves();
  el.saveList.replaceChildren();
  if (!saves.length) {
    el.saveList.innerHTML = '<div class="empty-tip">暂无存档</div>';
    return;
  }
  for (const [index, save] of saves.entries()) {
    const { cfg, time } = save.data;
    const row = document.createElement('div');
    row.className = 'save-item';
    row.innerHTML = '<div class="si-main"><div class="si-t"></div><div class="si-s"></div></div>';
    row.querySelector('.si-t').textContent = save.name;
    const mapName = (MAPS.find(map => map.id === cfg.mapId) || MAPS[0]).n;
    const side = cfg.side === 'atk' ? '攻方' : '守方';
    const rules = cfg.rules === 'frontline' ? '前线模拟' : '经典攻防';
    row.querySelector('.si-s').textContent = [mapName, side, rules, '已进行 ' + fmtTime(time)].join(' · ');
    const load = document.createElement('button');
    load.className = 'btn primary';
    load.textContent = '载入';
    load.onclick = () => {
      Snd.ensure();
      G = deserialize(save.data);
      startPlaying();
    };
    const remove = document.createElement('button');
    remove.className = 'btn ghost';
    remove.textContent = '删除';
    remove.onclick = () => {
      const updated = readSaves();
      updated.splice(index, 1);
      writeSaves(updated);
      buildSaveList();
    };
    row.append(load, remove);
    el.saveList.append(row);
  }
}
function startPlaying(){
  removeTutBox();
  closeRadial();
  cancelPendingLongPress();
  resetBattleInput();
  acc = 0;
  el.toast.replaceChildren();
  show(el.menu,false);show(el.setup,false);show(el.multi,false);show(el.saves,false);
  show(el.help,false);show(el.tutorial,false);show(el.settings,false);
  show(el.result,false);show(el.pause,false);show(el.hud,true);
  el.planSidebar.classList.add('hidden');
  el.btnPlan.classList.remove('on');
  refreshDeployRow(G);refreshSkillRow(G);refreshLeftPanel(G);
  refreshHUD(G);updateSelInfo(G);updateModeTip(G);
  focusBattleStart(G);
  const supply = document.getElementById('supplyToggle');
  supply.setAttribute('aria-pressed', 'false');
  show(supply, G.frontline);
  show(document.getElementById('rtSupply'), G.frontline);
  G.cam.zoom=(Math.min(W,H)<600)?.78:.90;
  clampCam(G);
  if(G.tutorial) showTutHint();
  const s=SEASONS[G.season];
  if (!G.tutorial) toast(G, s.n + '季 · ' + G.weather.name + (G.frontline ? ' · 前线模拟' : ''), 'good');
}
function buildSettings(){
  const qg=document.getElementById('qgrp');[...qg.children].forEach(c=>c.classList.toggle('active',c.dataset.q===CFG.quality));
  const fg=document.getElementById('fgrp');[...fg.children].forEach(c=>c.classList.toggle('active',parseInt(c.dataset.f,10)===CFG.fps));
  const xg=document.getElementById('fxgrp');[...xg.children].forEach(c=>c.classList.toggle('active',(c.dataset.fx==='1')===CFG.fx));
  const sg=document.getElementById('shgrp');[...sg.children].forEach(c=>c.classList.toggle('active',(c.dataset.sh==='1')===CFG.shake));
  const sndg=document.getElementById('sndgrp');[...sndg.children].forEach(c=>c.classList.toggle('active',(c.dataset.snd==='1')===CFG.snd));
  const uig=document.getElementById('uigrp');[...uig.children].forEach(c=>c.classList.toggle('active',(c.dataset.snd==='1')===CFG.sndUi));
  const bg=document.getElementById('sndbgrp');[...bg.children].forEach(c=>c.classList.toggle('active',(c.dataset.snd==='1')===CFG.sndBattle));
  const ambient = document.getElementById('ambgrp');
  [...ambient.children].forEach(button => button.classList.toggle('active', (button.dataset.snd === '1') === CFG.sndAmbient));
  document.getElementById('volume').value = CFG.volume;
  document.getElementById('volumeVal').value = CFG.volume + '%';
}
document.getElementById('qgrp').onclick=e=>{if(e.target.dataset.q){CFG.quality=e.target.dataset.q;saveCfg();buildSettings();if(G)buildTerrainCanvas(G);}};
document.getElementById('fgrp').onclick=e=>{if(e.target.dataset.f){CFG.fps=parseInt(e.target.dataset.f,10);saveCfg();buildSettings();}};
document.getElementById('fxgrp').onclick=e=>{if(e.target.dataset.fx){CFG.fx=e.target.dataset.fx==='1';saveCfg();buildSettings();}};
document.getElementById('shgrp').onclick=e=>{if(e.target.dataset.sh){CFG.shake=e.target.dataset.sh==='1';saveCfg();buildSettings();}};
document.getElementById('sndgrp').onclick=e=>{if(e.target.dataset.snd){CFG.snd=e.target.dataset.snd==='1';saveCfg();buildSettings();Snd.updateVolumes();if(CFG.snd){Snd.ensure();Snd.click();}}};
document.getElementById('uigrp').onclick=e=>{if(e.target.dataset.snd){CFG.sndUi=e.target.dataset.snd==='1';saveCfg();buildSettings();Snd.updateVolumes();if(CFG.snd&&CFG.sndUi)Snd.click();}};
document.getElementById('sndbgrp').onclick=e=>{if(e.target.dataset.snd){CFG.sndBattle=e.target.dataset.snd==='1';saveCfg();buildSettings();Snd.updateVolumes();}};
document.getElementById('ambgrp').onclick = event => {
  if (!event.target.dataset.snd) return;
  CFG.sndAmbient = event.target.dataset.snd === '1';
  saveCfg();
  buildSettings();
  Snd.updateVolumes();
};
document.getElementById('volume').oninput = event => {
  CFG.volume = Number(event.target.value);
  document.getElementById('volumeVal').value = CFG.volume + '%';
  Snd.updateVolumes();
};
document.getElementById('volume').onchange = saveCfg;
let tutIdx=0;
function showTut(){
  const step=TUT_STEPS[tutIdx];
  document.getElementById('tutContent').innerHTML='<div class="tstep"><h3>'+step.title+'</h3><p>'+step.text.replace(/\n/g,'<br>')+'</p></div><div style="text-align:center;color:#6b7f94;font-size:11px;margin-top:6px;">'+(tutIdx+1)+' / '+TUT_STEPS.length+'</div>';
  document.getElementById('tPrev').disabled=tutIdx===0;
  document.getElementById('tNext').textContent=tutIdx>=TUT_STEPS.length-1?'完成':'下一章';
}
document.getElementById('tPrev').onclick=()=>{if(tutIdx>0){tutIdx--;showTut();}};
document.getElementById('tNext').onclick=()=>{if(tutIdx>=TUT_STEPS.length-1){show(el.tutorial,false);show(el.menu,true);tutIdx=0;}else{tutIdx++;showTut();}};
document.getElementById('mNew').onclick=()=>{Snd.ensure();Snd.click();show(el.menu,false);show(el.setup,true);buildSetup();};
document.getElementById('mTut').onclick=()=>{Snd.ensure();Snd.click();show(el.menu,false);startTutorial();};
document.getElementById('mLoad').onclick=()=>{Snd.ensure();Snd.click();saveTab='solo';show(el.menu,false);show(el.saves,true);buildSaveList();updateSaveTabs();};
document.getElementById('mSet').onclick=()=>{Snd.ensure();Snd.click();show(el.menu,false);show(el.settings,true);buildSettings();};
document.getElementById('mHelp').onclick=()=>{Snd.ensure();Snd.click();show(el.menu,false);show(el.help,true);};
document.getElementById('hBack').onclick=()=>{show(el.help,false);show(el.menu,true);};
document.getElementById('sBack').onclick=()=>{show(el.setup,false);show(el.menu,true);};
document.getElementById('svBack').onclick=()=>{show(el.saves,false);show(el.menu,true);};
document.getElementById('tBack').onclick=()=>{show(el.tutorial,false);show(el.menu,true);};
document.getElementById('setBack').onclick=()=>{show(el.settings,false);if(G&&G.state==='paused')show(el.pause,true);else if(!G||G.state==='over')show(el.menu,true);};
document.getElementById('sGo').onclick = () => {
  Snd.ensure();
  G = makeGame({ ...setupCfg, dayTime: setupCfg.rules === 'frontline' ? 0.08 : undefined });
  G._clientReady = true;
  startPlaying();
};
document.getElementById('btnPause').onclick=()=>{if(!G||G.state!=='playing')return;G.state='paused'; document.getElementById('saveStatus').textContent = ''; closeRadial(); show(el.pause,true);};
document.getElementById('pResume').onclick=()=>{if(!G)return;G.state='playing';show(el.pause,false);};
document.getElementById('pSet').onclick=()=>{show(el.pause,false);show(el.settings,true);buildSettings();};
document.getElementById('pSave').onclick=()=>{
  if(!G)return;
  saveTab = G.mp ? 'multi' : 'solo';
  const name=prompt('存档名称：','战役 '+(readSaves().length+1));
  if(name===null)return;
  const trimmed=(name||'未命名').trim();
  if(!trimmed){toast(G,'存档名不能为空','bad');return;}
  const arr=readSaves();
  const existingIdx=arr.findIndex(s=>s.name===trimmed);
  if(existingIdx>=0){if(!confirm('已存在同名存档「'+trimmed+'」，是否覆盖？'))return;arr.splice(existingIdx,1);}
  arr.unshift({name:trimmed,ts:Date.now(),data:serialize(G)});
  if(arr.length>12)arr.length=12;
  document.getElementById('saveStatus').textContent = writeSaves(arr)
    ? (existingIdx >= 0 ? '已覆盖存档' : '已保存')
    : '存档失败，请检查浏览器存储空间';
};
document.getElementById('pQuit').onclick=()=>{if(!G)return;removeTutBox();Net.close();G.state='playing';show(el.pause,false);show(el.hud,false);show(el.menu,true);G=null;};
document.getElementById('rAgain').onclick=()=>{removeTutBox();Net.close();show(el.result,false);show(el.menu,false);show(el.setup,true);buildSetup();G=null;};
document.getElementById('rMenu').onclick=()=>{removeTutBox();Net.close();show(el.result,false);show(el.hud,false);show(el.menu,true);G=null;};
function updateSaveTabs(){
  const soloBtn=document.getElementById('svTabSolo');
  const multiBtn=document.getElementById('svTabMulti');
  if(!soloBtn||!multiBtn)return;
  soloBtn.style.background = saveTab==='solo' ? '#2a3a4c' : '';
  soloBtn.style.borderColor = saveTab==='solo' ? '#7fc0ff' : '';
  soloBtn.style.color = saveTab==='solo' ? '#9fd8ff' : '';
  multiBtn.style.background = saveTab==='multi' ? '#2a3a4c' : '';
  multiBtn.style.borderColor = saveTab==='multi' ? '#7fc0ff' : '';
  multiBtn.style.color = saveTab==='multi' ? '#9fd8ff' : '';
}
document.getElementById('svTabSolo').onclick=()=>{saveTab='solo';updateSaveTabs();buildSaveList();};
document.getElementById('svTabMulti').onclick=()=>{saveTab='multi';updateSaveTabs();buildSaveList();};
