"use strict";

/* ============ UI ============ */
const el={
  menu:document.getElementById('menu'),setup:document.getElementById('setup'),multi:document.getElementById('multi'),
  saves:document.getElementById('saves'),help:document.getElementById('help'),tutorial:document.getElementById('tutorial'),
  settings:document.getElementById('settings'),hud:document.getElementById('hud'),pause:document.getElementById('pause'),
  result:document.getElementById('result'),cpVal:document.getElementById('cpVal'),timeVal:document.getElementById('timeVal'),
  postVal:document.getElementById('postVal'),unitVal:document.getElementById('unitVal'),timeStat:document.getElementById('timeStat'),
  envVal:document.getElementById('envVal'),
  deployRow:document.getElementById('deployRow'),skillRow:document.getElementById('skillRow'),leftPanel:document.getElementById('leftPanel'),
  selInfo:document.getElementById('selInfo'),modeTip:document.getElementById('modeTip'),toast:document.getElementById('toast'),
  saveList:document.getElementById('saveList'),planSidebar:document.getElementById('planSidebar'),hoverTip:document.getElementById('hoverTip'),
  recycleBtn:document.getElementById('recycleBtn'),syncOverlay:document.getElementById('syncOverlay'),
  btnPlan:document.getElementById('btnPlan'),bottomBar:document.getElementById('bottomBar'),deployToggle:document.getElementById('deployToggle'),
  cancelSelBtn:document.getElementById('cancelSelBtn'),skillStatus:document.getElementById('skillStatus'),
};
function show(el_,s){if(s)el_.classList.remove('hidden');else el_.classList.add('hidden');}
function toast(g,text,kind){
  while (el.toast.children.length >= 3) el.toast.firstElementChild.remove();
  const d=document.createElement('div');
  d.className='toastmsg'+(kind?' '+kind:'');
  d.textContent=text;
  el.toast.appendChild(d);
  setTimeout(()=>{d.style.transition='opacity .4s';d.style.opacity='0';},1700);
  setTimeout(()=>{if(d.parentNode)d.parentNode.removeChild(d);},2200);
}
function updateModeTip(g){
  let text='';
  if(g.mode==='deploy')text='点击己方部署点圈内任意位置 · ESC取消';
  else if(g.mode==='skill'&&g.pendingSkill){const s=SKILLS[g.pendingSkill];text=s.n+' · '+(s.friendlyRange?'目标须在己方部队 '+s.friendlyRange+' 范围内':'点击目标区域');}
  else if (g.mode === 'order-move') text = '点击地面指定移动目标';
  else if(g.planMode==='front')text='绘制前线 · 已'+g.planPts.length+'点 · 双击或点最后一点结束';
  else if(g.planMode==='line')text='绘制线性防卫 · 已'+g.planPts.length+'点 · 双击或点最后一点结束';
  else if(g.planMode==='zone')text='绘制区域防卫 · 点击中心位置';
  else if(g.planMode==='attack')text='绘制目标线 · 已'+g.planPts.length+'点 · 基于已有前线';
  if(text){show(el.modeTip,true);el.modeTip.innerHTML=text+'<span class="key">Esc</span>';}else show(el.modeTip,false);
  document.getElementById('rtMove').classList.toggle('active', g.mode === 'order-move');
  if (g.mode !== 'deploy') el.deployRow.querySelector('.ucard.active')?.classList.remove('active');
  el.skillRow.querySelectorAll('[data-targeted]').forEach(card => {
    card.classList.toggle('active', g.mode === 'skill' && g.pendingSkill === card.dataset.card);
  });
}
function prepareTargeting(g, mode) {
  g.mode = mode;
  g.planMode = null;
  g.planPts = [];
  show(el.planSidebar, false);
  el.btnPlan.classList.remove('on');
}

function tryDeployHotkey(g, key) {
  if (g.state !== 'playing' || isClientWaiting()) return;
  const type = DEPLOY_HOTKEYS[key];
  if (!type) return;
  if (type === 'trench') {
    const units = g.selection.filter(unit => unit.type === 'eng' && unit.alive);
    if (!units.length) {
      toast(g, '请先选中工兵班', 'bad');
      return;
    }
    if (g.cp[g.playerSide] < 5) {
      toast(g, '指挥值不足', 'bad');
      return;
    }
    if (Net.role === 'client') Net.sendToHost({ type: 'cmd', cmd: 'trench', ids: units.map(unit => unit.id) });
    else if (!digTrenches(g, g.playerSide, units)) return;
    toast(g, '工兵开始构筑壕沟', 'good');
    Snd.order();
    return;
  }
  if (g.cp[g.playerSide] < availableDeploymentCost(g, type)) {
    toast(g, '指挥值不足', 'bad');
    return;
  }
  prepareTargeting(g, 'deploy');
  g.pendingDeploy = type;
  g.pendingSkill = null;
  updateModeTip(g);
  refreshDeployRow(g);
  Snd.click();
}

function renderCard(row, key, title, value, options = {}) {
  let card = row.querySelector('[data-card="' + key + '"]');
  if (!card) {
    card = document.createElement(options.activate ? 'button' : 'div');
    card.dataset.card = key;
    row.append(card);
  }
  card.className = 'ucard' + (options.skill ? ' skill' : '') +
    (options.disabled ? ' dis' : '') + (options.active ? ' active' : '') +
    (options.activate ? '' : ' card-status');
  if (options.targeted) card.dataset.targeted = '';
  card.innerHTML = (options.key ? '<span class="key">' + options.key + '</span>' : '') +
    (options.slot ? '<span class="slot">' + options.slot + '格</span>' : '') +
    '<span class="un">' + title + '</span><span class="uc">' + value + '</span>' +
    (options.note ? '<span class="card-note">' + options.note + '</span>' : '');
  if (options.activate) {
    card.onclick = options.activate;
    card.setAttribute('aria-disabled', String(Boolean(options.disabled)));
  }
  return card;
}

function refreshDeployRow(g) {
  const side = g.playerSide;
  const slots = usedSlots(g, side);
  const maximum = Math.floor(slotCap(g, side));
  const descriptions = { inf: '通用主力', scout: '扩大视野', eng: '挖壕与修复', arm: '装甲突击', art: '间接火力' };
  renderCard(el.deployRow, 'slots', '部署槽位', slots + '/' + maximum);
  for (const [key, type] of Object.entries(DEPLOY_HOTKEYS)) {
    if (type === 'trench') continue;
    const base = deploymentCost(g, side, type);
    const cost = availableDeploymentCost(g, type);
    renderCard(el.deployRow, type, UNITS[type].n, (cost < base ? cost + '–' + base : base) + ' CP', {
      key: key.toUpperCase(),
      slot: UNIT_SLOTS[type],
      note: descriptions[type],
      active: g.mode === 'deploy' && g.pendingDeploy === type,
      disabled: g.cp[side] < cost || slots + UNIT_SLOTS[type] > maximum,
      activate: () => tryDeployHotkey(g, key),
    });
  }
  renderCard(el.deployRow, 'trench', '挖掘壕沟', '5 CP', {
    key: 'N', note: '需要工兵', disabled: g.cp[side] < 5 || !g.selection.some(unit => unit.type === 'eng'),
    activate: () => tryDeployHotkey(g, 'n'),
  });
}

function targetedSkills(g) {
  return g.frontline ? ['recon', 'barrage', 'airstrike', 'smoke'] : ['recon', 'barrage', 'airstrike'];
}

function requestSkill(g, key) {
  if (g.state !== 'playing' || isClientWaiting()) return;
  const side = g.playerSide;
  const skill = SKILLS[key];
  if (g.cd[side][key] > 0) {
    toast(g, skill.n + '冷却中', 'bad');
    return;
  }
  const slots = g.selection.filter(unit => unit.alive).reduce((sum, unit) => sum + UNIT_SLOTS[unit.type], 0);
  if (key === 'march' && !slots) {
    toast(g, '请先选中部队', 'bad');
    return;
  }
  const cost = key === 'march' ? slots * 2 : (skill.cost ?? (side === 'atk' ? skill.costAtk : skill.costDef));
  if (g.cp[side] < cost) {
    toast(g, '指挥值不足', 'bad');
    return;
  }
  if (targetedSkills(g).includes(key)) {
    prepareTargeting(g, 'skill');
    g.pendingSkill = key;
    g.pendingDeploy = null;
    updateModeTip(g);
    Snd.click();
  } else if (Net.role === 'client') {
    Net.sendToHost({ type: 'cmd', cmd: 'skill', key, ids: g.selection.map(unit => unit.id), x: 0, y: 0 });
  } else {
    useSkill(g, side, key, 0, 0);
    refreshSkillRow(g);
  }
}

function refreshSkillRow(g) {
  const side = g.playerSide;
  const notes = { recon: '揭开迷雾', barrage: '可能误伤友军', airstrike: '可能误伤友军', smoke: '阻隔直射火力' };
  if (!g.frontline) el.skillRow.querySelector('[data-card="smoke"]')?.remove();
  for (const key of targetedSkills(g)) {
    const skill = SKILLS[key];
    const remaining = g.cd[side][key] || 0;
    const card = renderCard(el.skillRow, key, skill.n, remaining > 0 ? Math.ceil(remaining) + 's' : skill.cost + ' CP', {
      skill: true, targeted: true, note: notes[key],
      active: g.mode === 'skill' && g.pendingSkill === key,
      disabled: remaining > 0 || g.cp[side] < skill.cost,
      activate: () => requestSkill(g, key),
    });
    const emergency = el.skillRow.querySelector('[data-card="emergency"]');
    if (emergency && card.nextElementSibling !== emergency && key === 'smoke') el.skillRow.insertBefore(card, emergency);
  }
  for (const key of ['emergency', 'march']) {
    const skill = SKILLS[key];
    const remaining = g.cd[side][key] || 0;
    const active = key === 'emergency' && emergencyActive(g, side);
    const slots = g.selection.filter(unit => unit.alive).reduce((sum, unit) => sum + UNIT_SLOTS[unit.type], 0);
    const cost = key === 'emergency' ? (side === 'atk' ? skill.costAtk : skill.costDef) : slots * 2;
    const value = active ? '生效中' : remaining > 0 ? Math.ceil(remaining) + 's' : cost ? cost + ' CP' : '需选择部队';
    renderCard(el.skillRow, key, skill.n, value, {
      skill: true, active, note: key === 'emergency' ? '增加部署速度和容量' : '移速提高 50%',
      disabled: !cost || remaining > 0 || g.cp[side] < cost,
      activate: () => requestSkill(g, key),
    });
  }
}

function refreshLeftPanel(g){
  if(el.leftPanel.children.length!==9){
    el.leftPanel.innerHTML='';
    for(let i=1;i<=9;i++){
      const b=document.createElement('button');
      b.className='sqbtn';b.dataset.k=i;
      b.innerHTML='<span class="color-dot" style="background:'+SQUAD_COLORS[i-1]+'"></span>'+i+'<span class="cnt"></span>';
      let pressTimer=null,longFired=false;
      const doAssign=()=>{
        if(!G||G.state!=='playing')return;
        if(G.selection.length===0){toast(G,'请先选中部队再编入','bad');return;}
        G.squads[i]=G.selection.filter(u=>u.alive).map(u=>u.id);
        toast(G,'编队 '+i+' 已编入 '+G.squads[i].length+' 支','good');
        refreshLeftPanel(G);
      };
      const doRecall=()=>{
        if(!G||G.state!=='playing')return;
        const sq=G.squads[i];
        if(!sq||sq.length===0){toast(G,'编队 '+i+' 为空','bad');return;}
        const sel=[];
        for(const id of sq){const u=findUnitById(G,id);if(u&&u.alive)sel.push(u);}
        if(sel.length===0){G.squads[i]=[];toast(G,'编队 '+i+' 已失效','bad');refreshLeftPanel(G);return;}
        G.selection=sel;G.hotSquad=i;updateSelInfo(G);toast(G,'调用编队 '+i+'（'+sel.length+'）','good');
      };
      const doDisband=()=>{
        if(!G||G.state!=='playing')return;
        if(!G.squads[i]||G.squads[i].length===0){toast(G,'编队 '+i+' 为空','bad');return;}
        G.squads[i]=[];
        toast(G,'编队 '+i+' 已解散','good');
        refreshLeftPanel(G);
      };
      b.addEventListener('pointerdown',ev=>{
        ev.preventDefault();
        if(ev.button===2){doDisband();return;}
        longFired=false;
        pressTimer=setTimeout(()=>{longFired=true;doAssign();},480);
      });
      b.addEventListener('pointerup',ev=>{
        if(ev.button===2)return;
        if(pressTimer){clearTimeout(pressTimer);pressTimer=null;}
        if(!longFired)doRecall();
      });
      b.addEventListener('pointerleave',()=>{if(pressTimer){clearTimeout(pressTimer);pressTimer=null;}});
      b.addEventListener('pointercancel',()=>{if(pressTimer){clearTimeout(pressTimer);pressTimer=null;}});
      b.addEventListener('contextmenu',e=>e.preventDefault());
      b.addEventListener('click', event => { if (event.detail === 0) doRecall(); });
      el.leftPanel.appendChild(b);
    }
  }
  for(const b of el.leftPanel.children){
    const k=parseInt(b.dataset.k,10);
    const sq=g.squads[k];
    const n=sq?sq.filter(id=>{const u=findUnitById(g,id);return u&&u.alive;}).length:0;
    b.classList.toggle('has',n>0);
    b.classList.toggle('hot',g.hotSquad===k&&n>0);
    b.querySelector('.cnt').textContent=n>0?n:'';
    b.setAttribute('aria-label', '编队 ' + k + (n ? '，' + n + ' 支部队' : '，空'));
  }
}
function updateSelInfo(g){
  const validIds=new Set(g.units.filter(u=>u.alive).map(u=>u.id));
  g.selection=g.selection.filter(u=>u.alive&&validIds.has(u.id));
  const byId=new Map(g.units.map(u=>[u.id,u]));
  g.selection=g.selection.map(u=>byId.get(u.id)).filter(Boolean);
  const sel=g.selection;
  if(sel.length===0){show(el.selInfo,false);el.recycleBtn.classList.add('dis');if(el.cancelSelBtn)show(el.cancelSelBtn,false);return;}
  show(el.selInfo,true);el.recycleBtn.classList.remove('dis');if(el.cancelSelBtn)show(el.cancelSelBtn,true);
  if(sel.length===1){
    const u=sel[0],d=UNITS[u.type];
    const status = u._resupplying ? '补给中' : (u.holdPost ? '驻守' : (u._engaged ? '交战' : ''));
    el.selInfo.innerHTML='<div class="sn">'+d.n+'</div><div class="sr">生命 '+Math.ceil(u.hp)+'/'+u.maxHp+' · 射程 '+Math.round(effectiveRange(g,u,d))+'</div>' +
      (status ? '<div class="sr">' + status + '</div>' : '');
  }else{
    const counts={};for(const u of sel)counts[u.type]=(counts[u.type]||0)+1;
    let txt=Object.entries(counts).map(([k,v])=>UNITS[k].n+'×'+v).join(' · ');
    el.selInfo.innerHTML='<div class="sn">已选中 '+sel.length+' 支部队</div><div class="sr">'+txt+'</div>';
  }
  if (g.frontline) {
    const supply = sel.reduce((sum, unit) => sum + unit.supply, 0) / sel.length;
    const suppressed = sel.filter(unit => unit.suppression >= 0.32).length;
    const line = document.createElement('div');
    line.className = 'sr';
    line.textContent = (sel.length > 1 ? '平均补给 ' : '补给 ') + Math.round(supply * 100) + '%' +
      (suppressed ? ' · ' + (sel.length > 1 ? suppressed + ' 支受压制' : '受压制') : '');
    el.selInfo.append(line);
  }
}
function refreshSkillStatus(g){
  if(!el.skillStatus)return;
  const items=[];
  if(emergencyActive(g,g.playerSide)){
    const left=g._emergency[g.playerSide]-g.time;
    items.push({name:'紧急部署',left,total:SKILLS.emergency.dur,cls:''});
  }
  const marching = g.units.filter(unit => unit.alive && unit.side === g.playerSide && g._marchUnits.has(unit.id));
  if (marching.length) {
    const until = Math.max(...marching.map(unit => g._marchUnits.get(unit.id)));
    items.push({ name: '急行军 ×' + marching.length, left: until - g.time, total: SKILLS.march.dur, cls: '' });
  }
  const smoke = g.smokes.find(item => item.side === g.playerSide);
  if (smoke) items.push({ name: '烟幕支援', left: smoke.until - g.time, total: SKILLS.smoke.dur, cls: '' });
  if(g.recon.length>0){
    const r=g.recon.find(x=>x.side===g.playerSide);
    if(r){items.push({name:'侦察机',left:r.until-g.time,total:SKILLS.recon.dur,cls:''});}
  }
  if(g.strikes.length>0){
    const s=g.strikes.find(x=>x.side===g.playerSide);
    if(s){items.push({name:SKILLS[s.key].n,left:s.delay+s.dur-s.t,total:s.delay+s.dur,cls:'warn'});}
  }
  el.skillStatus.innerHTML=items.map(it=>{
    const pct=Math.max(0,Math.min(1,it.left/it.total));
    return '<div class="skill-banner '+it.cls+'"><span>'+it.name+'</span><div class="bar"><i style="width:'+(pct*100)+'%"></i></div><span>'+Math.ceil(it.left)+'s</span></div>';
  }).join('');
}
function refreshHUD(g) {
  el.cpVal.textContent = Math.floor(g.cp[g.playerSide]);
  const left = Math.max(0, Math.ceil(g.duration - g.time));
  el.timeVal.textContent = fmtTime(left);
  el.timeStat.classList.toggle('warn', left < 120);
  const branches = g.posts.filter(post => post.type !== 'hq' && !post._disabled);
  const own = branches.filter(post => post.owner === g.playerSide).length;
  el.postVal.textContent = own + '/' + branches.length;
  const myUnits = g.units.filter(unit => unit.alive && unit.side === g.playerSide).length;
  el.unitVal.textContent = myUnits + '/' + UNIT_CAP[g.playerSide];
  const season = SEASONS[g.season];
  const phase = g.env.dayAmount > 0.55 ? '白天' : (g.env.dayAmount < 0.3 ? '夜晚' : '黄昏');
  el.envVal.textContent = g.frontline ? g.weather.name + '·' + phase : season.n + '·' + phase;
  const flag = document.getElementById('sideFlag');
  flag.textContent = g.playerSide === 'atk' ? '攻方' : '守方';
  flag.classList.toggle('def', g.playerSide === 'def');
  document.getElementById('missionMap').textContent = g.mapDef.n;
  const hq = g.posts.find(post => post.type === 'hq');
  document.getElementById('missionGoal').textContent = g.tutorial
    ? '跟随训练指令'
    : g.playerSide === 'atk'
      ? '大本营' + (hq?.owner === 'atk' ? '已夺取' : '待夺取') + ' · 外围据点 ' + own + '/' + Math.ceil(branches.length / 2)
      : '坚守至倒计时结束 · 大本营' + (hq?.owner === 'def' ? '守住' : '失守');
  refreshSkillStatus(g);
}

setInterval(() => {
  if (G?.state !== 'playing') return;
  refreshHUD(G);
  refreshDeployRow(G);
  refreshSkillRow(G);
  refreshLeftPanel(G);
  updateSelInfo(G);
  if (!el.planSidebar.classList.contains('hidden')) refreshPlanSidebar(G);
  show(el.syncOverlay, isClientWaiting());
}, 450);

function setupRightPanel(){
  el.btnPlan.onclick=()=>{
    if(!G)return;
    if(Net.role==='client'&&!G._clientReady){toast(G,'正在同步…','bad');return;}
    el.planSidebar.classList.toggle('hidden');
    el.btnPlan.classList.toggle('on',!el.planSidebar.classList.contains('hidden'));
    if(!el.planSidebar.classList.contains('hidden')){
      G.planMode=null;G.planPts=[];G.planPhase=null;G.planStartLine=null;
      G.mode=null;G.pendingDeploy=null;G.pendingSkill=null;refreshPlanSidebar(G);
    }
    updateModeTip(G);
  };
  document.getElementById('psClose').onclick=()=>{
    el.planSidebar.classList.add('hidden');
    el.btnPlan.classList.remove('on');
    if(G){G.planMode=null;G.planPts=[];G.planPhase=null;G.planStartLine=null;}
    if (G) updateModeTip(G);
  };
  document.getElementById('psClear').onclick=()=>{
    if(!G)return;if(!confirm('清除所有计划？'))return;
    for (const plan of [...G.plans]) {
      if (plan.side !== G.playerSide || plan.peer) continue;
      sendPlanChange(plan, 'remove');
      deletePlan(G, plan);
    }
    refreshPlanSidebar(G);
    toast(G, '已清除所有计划', 'good');
  };
  el.planSidebar.querySelectorAll('.draw-btn').forEach(b=>{
    b.onclick=()=>{
      if(!G)return;
      if(G.selection.length===0){toast(G,'请先选中部队再创建计划','bad');return;}
      const d=b.dataset.draw;
      el.planSidebar.querySelectorAll('.draw-btn').forEach(x=>x.classList.remove('active'));
      b.classList.add('active');
      if(d==='attack'){
        const fronts=G.plans.filter(p=>p.side===G.playerSide && !p.peer && (p.type==='front'||p.type==='line'));
        if(fronts.length===0){toast(G,'请先绘制一条前线作为基准','bad');b.classList.remove('active');return;}
        const latest=fronts[fronts.length-1];
        G.planMode='attack';G.planPts=[];G.planPhase='targetLine';G.planStartLine=latest.points.slice();
        toast(G,'已选用最近的前线 · 请绘制目标线','good');updateModeTip(G);return;
      }
      G.planMode=d;G.planPts=[];G.planPhase=null;G.planStartLine=null;
      G.mode=null;G.pendingDeploy=null;G.pendingSkill=null;updateModeTip(G);
    };
  });
  document.getElementById('rtMove').onclick = () => {
    if (!G || !G.selection.length) { toast(G, '未选中部队', 'bad'); return; }
    prepareTargeting(G, 'order-move');
    updateModeTip(G);
  };
  document.getElementById('rtAttack').onclick=()=>{
    if(!G||G.selection.length===0){toast(G,'未选中部队','bad');return;}
    if(Net.role==='client'){Net.sendToHost({type:'cmd',cmd:'attack',ids:G.selection.map(u=>u.id)});toast(G,'攻击指令已下达','good');return;}
    let cnt=0;
    for(const u of G.selection){
      let best=null,bd=Infinity;
      for(const e of G.units){
        if(e.side===u.side||!e.alive)continue;
        if(!visible(G,u.side,e.x,e.y))continue;
        const d=dist(u.x,u.y,e.x,e.y);
        if(d<bd){bd=d;best=e;}
      }
      if (best) { attackUnits(G, [u], best); cnt++; }
    }
    toast(G,cnt>0?'攻击指令已下达':'未发现可见敌人',cnt>0?'good':'bad');
  };
  document.getElementById('rtStop').onclick=()=>{
    if(!G||G.selection.length===0){toast(G,'未选中部队','bad');return;}
    if(Net.role==='client'){Net.sendToHost({type:'cmd',cmd:'stop',ids:G.selection.map(u=>u.id)});toast(G,'部队停止行动','good');return;}
    for (const u of G.selection) { cancelMovement(u); u.tid = 0; u.holdPost = 0; u._resupplying = false; }
    toast(G, '部队停止行动', 'good');
  };
  el.recycleBtn.onclick=()=>{
    if(!G||G.selection.length===0){toast(G,'未选中部队','bad');return;}
    if(Net.role==='client'&&!G._clientReady){toast(G,'正在同步…','bad');return;}
    if(!confirm('确认回收选中的 '+G.selection.length+' 支部队？'))return;
    if(Net.role==='client'){Net.sendToHost({type:'cmd',cmd:'recycle',ids:G.selection.map(u=>u.id)});return;}
    let total=0;for(const u of G.selection)total+=recycleUnit(G,u);
    toast(G,'回收 '+G.selection.length+' 支部队 · 获得 '+total+' CP','good');updateSelInfo(G);
  };
  if(el.cancelSelBtn){
    el.cancelSelBtn.onclick=()=>{
      if(!G)return;
      G.selection=[];
      G.mode=null;G.pendingDeploy=null;G.pendingSkill=null;
      G.planMode=null;G.planPts=[];G.planPhase=null;G.planStartLine=null;
      updateSelInfo(G);updateModeTip(G);
    };
  }
  if(el.deployToggle){
    const KEY='v24_deploy_collapsed';
    if(readSetting(KEY)==='1'){
      el.bottomBar.classList.add('collapsed');
      el.deployToggle.textContent='▼ 展开';
    }
    el.deployToggle.onclick=()=>{
      const col=el.bottomBar.classList.toggle('collapsed');
      el.deployToggle.textContent=col?'▼ 展开':'▲ 部署';
      try{localStorage.setItem(KEY,col?'1':'0');}catch(e){}
    };
  }
}
function recycleUnit(g, u, side = g.playerSide){
  if(!u.alive||u.side!==side)return 0;
  const d=UNITS[u.type];
  let nearest=null,nd=Infinity;
  for(const p of g.posts){if(p.owner!==side || p._disabled)continue;const dd=dist2(u.x,u.y,p.x,p.y);if(dd<nd){nd=dd;nearest=p;}}
  if(!nearest)nd=9999*9999;
  const distPx=Math.sqrt(nd);
  const distFactor=clamp(1-distPx/900*0.65,0.35,1.0);
  const hpFactor=u.hp/u.maxHp;
  const value=Math.max(1,Math.round(d.cost*0.6*hpFactor*distFactor));
  g.cp[side]=Math.min(CP_MAX,g.cp[side]+value);
  u.alive=false;
  addEffect(g,{type:'ring',x:u.x,y:u.y,r:30,life:0.6,max:0.6,col:'#ffce6b',side});
  addEffect(g,{type:'cpreward',x:u.x,y:u.y,life:1.4,max:1.4,text:'+'+value+' CP',side});
  return value;
}
function orderMove(g, units, x, y) {
  const active = units.filter(unit => unit.alive);
  if (!active.length || !Number.isFinite(x) || !Number.isFinite(y)) return;
  const columns = Math.ceil(Math.sqrt(active.length));
  const rows = Math.ceil(active.length / columns);
  const spacing = 42;
  for (const [i, unit] of active.entries()) {
    const dx = (i % columns - (columns - 1) / 2) * spacing;
    const dy = (Math.floor(i / columns) - (rows - 1) / 2) * spacing;
    unit.order = { type: 'move', x: clamp(x + dx, 1, MAP_W * CELL - 1), y: clamp(y + dy, 1, MAP_H * CELL - 1) };
    unit.path = null;
    unit.pathI = 0;
    unit.holdPost = 0;
    unit.tid = 0;
    unit._resupplying = false;
  }
}
