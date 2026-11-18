"use strict";

/* ============ 输入 ============ */
const pointers=new Map();
let pinchStart=null,longPressTimer=null,pendingLongPress=null,hoverTipEl=null,lastTapTime=0,lastTapX=0,lastTapY=0;
function screenToWorld(sx,sy){const g=G;return{x:(sx-W/2)/g.cam.zoom+g.cam.x,y:(sy-H/2)/g.cam.zoom+g.cam.y};}
function cancelPendingLongPress(){if(longPressTimer){clearTimeout(longPressTimer);longPressTimer=null;}pendingLongPress=null;}
function isClientWaiting() { return Net.role === 'client' && !G?._clientReady; }
function resetBattleInput() {
  pointers.clear();
  pinchStart = null;
  lastTapTime = 0;
  hideHoverTip();
}

cv.addEventListener('pointerdown',e=>{
  if(!G||G.state!=='playing'||e.button===2)return;
  Snd.ensure();
  cv.setPointerCapture(e.pointerId);
  const rect=cv.getBoundingClientRect();
  const mx=e.clientX-rect.left,my=e.clientY-rect.top;
  const p={id:e.pointerId,startX:mx,startY:my,x:mx,y:my,time:performance.now(),moved:false,boxSelect:e.shiftKey && e.pointerType==='mouse',panOnly:e.button===1};
  pointers.set(e.pointerId,p);
  if(pointers.size===2){
    cancelPendingLongPress();
    const ps=[...pointers.values()];
    ps.forEach(pointer => { pointer.moved = true; });
    pinchStart={d:dist(ps[0].x,ps[0].y,ps[1].x,ps[1].y),zoom:G.cam.zoom};
    G.drag=null;return;
  }
  if(pointers.size===1 && !p.boxSelect && !p.panOnly){
    const w=screenToWorld(mx,my);
    let unitUnder=null;
    for(const u of G.units){
      if(u.side!==G.playerSide||!u.alive)continue;
      if(dist(w.x,w.y,u.x,u.y)<UNITS[u.type].r+18){unitUnder=u;break;}
    }
    pendingLongPress={mx,my,wx:w.x,wy:w.y,unitUnder};
    longPressTimer=setTimeout(()=>{
      if(!pendingLongPress||!pointers.has(e.pointerId))return;
      const pp=pointers.get(e.pointerId);
      if(pp.moved)return;
      if(pendingLongPress.unitUnder){pp.longPress=true;openRadial(G,pendingLongPress.mx,pendingLongPress.my,pendingLongPress.unitUnder);if(navigator.vibrate)navigator.vibrate(15);}
      else{G.drag={active:true,x0:pendingLongPress.wx,y0:pendingLongPress.wy,box:null};if(navigator.vibrate)navigator.vibrate(10);}
      longPressTimer=null;pendingLongPress=null;
    },350);
  }
});
cv.addEventListener('pointermove',e=>{
  if(!G)return;
  const p=pointers.get(e.pointerId);
  const rect=cv.getBoundingClientRect();
  const mx=e.clientX-rect.left,my=e.clientY-rect.top;
  G.pointerScreen={x:mx,y:my};G.pointerWorld=screenToWorld(mx,my);
  if(e.pointerType==='mouse'&&!p&&G.state==='playing')updateHover(mx,my);
  if(!p || p.longPress)return;
  const dx=mx-p.x,dy=my-p.y;p.x=mx;p.y=my;
  const td=Math.sqrt((mx-p.startX)*(mx-p.startX)+(my-p.startY)*(my-p.startY));
  if(td>8){p.moved=true;if(longPressTimer){cancelPendingLongPress();}}
  if(pointers.size===2&&pinchStart){
    const ps=[...pointers.values()];
    const d=dist(ps[0].x,ps[0].y,ps[1].x,ps[1].y);
    if (pinchStart.d > 1) G.cam.zoom=clamp(pinchStart.zoom*(d/pinchStart.d),.42,2.2);
    clampCam(G);
    return;
  }
  if(pointers.size===1){
    if (p.boxSelect && p.moved && !G.drag) {
      const start = screenToWorld(p.startX, p.startY);
      G.drag = { active: true, x0: start.x, y0: start.y, box: null };
    }
    if(G.drag&&G.drag.active){
      const w=screenToWorld(mx,my);
      G.drag.box={x:Math.min(G.drag.x0,w.x),y:Math.min(G.drag.y0,w.y),w:Math.abs(w.x-G.drag.x0),h:Math.abs(w.y-G.drag.y0)};
    } else if(p.moved){
      G.cam.x-=dx/G.cam.zoom;G.cam.y-=dy/G.cam.zoom;clampCam(G);
      if(G.tutorial) G.tutorial.lastEv={type:'cam'};
    }
  }
});
cv.addEventListener('pointerup',e=>{
  const p=pointers.get(e.pointerId);pointers.delete(e.pointerId);
  if(pointers.size<2)pinchStart=null;
  cancelPendingLongPress();
  if(!p||!G||p.panOnly||p.longPress)return;
  if(G.drag&&G.drag.active){
    const box=G.drag.box;G.drag=null;
    if(box&&box.w>8&&box.h>8){
      const sel=[];
      for(const u of G.units){if(u.side!==G.playerSide||!u.alive)continue;if(u.x>=box.x&&u.x<=box.x+box.w&&u.y>=box.y&&u.y<=box.y+box.h)sel.push(u);}
      if(e.shiftKey){for(const u of sel)if(!G.selection.includes(u))G.selection.push(u);}
      else G.selection=sel;
      updateSelInfo(G);
      if(G.selection.length>0){toast(G,'选中 '+G.selection.length+' 支部队','good');if(CFG.sndUi)Snd.select();}
      else if(!e.shiftKey)toast(G,'未框选到部队','bad');
    } else {if(!e.shiftKey){G.selection=[];updateSelInfo(G);}}
    return;
  }
  if(p.moved)return;
  if(G.state!=='playing')return;
  const rect=cv.getBoundingClientRect();
  const mx=e.clientX-rect.left,my=e.clientY-rect.top;
  const now=performance.now();
  const isDoubleTap=(now-lastTapTime<300)&&Math.abs(mx-lastTapX)<15&&Math.abs(my-lastTapY)<15;
  lastTapTime=now;lastTapX=mx;lastTapY=my;
  handleClick(mx,my,e.shiftKey,isDoubleTap);
});
cv.addEventListener('pointercancel',e=>{pointers.delete(e.pointerId);pinchStart=null;cancelPendingLongPress();if(G)G.drag=null;});
cv.addEventListener('wheel', event => {
  if (G?.state !== 'playing') return;
  event.preventDefault();
  const rect = cv.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  const point = screenToWorld(x, y);
  G.cam.zoom = clamp(G.cam.zoom * (event.deltaY > 0 ? 0.88 : 1.14), 0.42, 2.2);
  const zoomed = screenToWorld(x, y);
  G.cam.x += point.x - zoomed.x;
  G.cam.y += point.y - zoomed.y;
  clampCam(G);
  G.pointerWorld = screenToWorld(x, y);
}, { passive: false });
cv.addEventListener('contextmenu', event => {
  event.preventDefault();
  if (G?.state !== 'playing' || isClientWaiting() || !G.selection.length) return;
  const rect = cv.getBoundingClientRect();
  const point = screenToWorld(event.clientX - rect.left, event.clientY - rect.top);
  if (!G.mode && !G.planMode) issueFieldOrder(G, point, fieldTarget(G, point));
});

function clampCam(g) {
  const width = MAP_W * CELL;
  const height = MAP_H * CELL;
  const xPad = Math.min(width / 2, Math.max(0, W / (2 * g.cam.zoom) - 48));
  const top = document.getElementById('topBar').offsetHeight;
  const bottom = el.bottomBar.offsetHeight;
  const topPad = Math.min(height / 2, Math.max(0, (H / 2 - top - 35) / g.cam.zoom));
  const bottomPad = Math.min(height / 2, Math.max(0, (H / 2 - bottom - 35) / g.cam.zoom));
  g.cam.x = clamp(g.cam.x, xPad, width - xPad);
  g.cam.y = clamp(g.cam.y, topPad, height - bottomPad);
}
function updateHover(mx,my){
  if(!G||G.state!=='playing'){hideHoverTip();return;}
  const w=screenToWorld(mx,my);
  let hovered=null;
  for(const u of G.units){
    if(!u.alive)continue;
    const isEnemy=u.side!==G.playerSide;
    if(isEnemy&&!visible(G,G.playerSide,u.x,u.y))continue;
    if(dist(w.x,w.y,u.x,u.y)<UNITS[u.type].r+14){hovered={type:'unit',obj:u};break;}
  }
  if(!hovered){for(const t of G.turrets){
    if(t.owner!==G.playerSide&&!visible(G,G.playerSide,t.x,t.y))continue;
    if(dist(w.x,w.y,t.x,t.y)<t.r+14){hovered={type:'turret',obj:t};break;}
  }}
  if(!hovered){for(const p of G.posts){const r=(POST_TYPES[p.type]?.radius)||36;if(dist(w.x,w.y,p.x,p.y)<r*0.9){hovered={type:'post',obj:p};break;}}}
  if(!hovered){G._hoverUnit=null;hideHoverTip();return;}
  G._hoverUnit=hovered.type==='unit'?hovered.obj:null;
  if(!hoverTipEl)hoverTipEl=document.getElementById('hoverTip');
  let html='';
  if(hovered.type==='unit'){
    const u=hovered.obj,d=UNITS[u.type];
    const isEnemy=u.side!==G.playerSide;
    const forestFlag = inForest(G,u.x,u.y) ? ' <span style="color:#8adf8a">[林中]</span>' : (inMountain(G,u.x,u.y)?' <span style="color:#c0b090">[山中]</span>':'');
    const marchFlag = (G._marchUnits&&G._marchUnits.has(u.id)) ? ' <span style="color:#ffb84d">[急行军]</span>' : '';
    const engFlag = u._engaged ? ' <span style="color:#ff9b7d">[交战中]</span>' : (u._combatTime>0?' <span style="color:#ffce6b">[索敌 '+Math.round(u._combatTime/OBSERVE_TIME*100)+'%]</span>':'');
    html='<div class="ht-name '+(isEnemy?'enemy':'')+'">'+d.n+(isEnemy?' [敌]':'')+forestFlag+marchFlag+engFlag+'</div>'+
      '<div class="ht-row"><span class="ht-label">生命</span><span class="ht-val">'+Math.ceil(u.hp)+'/'+u.maxHp+'</span></div>'+
      '<div class="ht-row"><span class="ht-label">射程</span><span class="ht-val">'+Math.round(effectiveRange(G,u,d))+'</span></div>'+
      (u.holdPost?'<div class="ht-row">驻守中</div>':'') +
      (G.frontline && !isEnemy ? '<div class="ht-row"><span class="ht-label">补给</span><span class="ht-val">' +
        Math.round(u.supply * 100) + '%</span></div>' : '');
  }else if(hovered.type==='turret'){
    const t=hovered.obj,d=TURRETS[t.type];
    const ownerTxt=t.owner==='atk'?'攻方':(t.owner==='def'?'守方':'中立');
    html='<div class="ht-name turret">'+d.n+(t.ruin?' [废墟]':'')+'</div>'+
      (t.ruin?'<div class="ht-row" style="color:#a0a0a0">靠近以占领</div>':
      '<div class="ht-row"><span class="ht-label">生命</span><span class="ht-val">'+Math.ceil(t.hp)+'/'+t.maxHp+'</span></div>'+
      '<div class="ht-row"><span class="ht-label">所属</span><span class="ht-val">'+ownerTxt+'</span></div>'+
      '<div class="ht-row"><span class="ht-label">伤害</span><span class="ht-val">'+d.dmg+'</span></div>'+
      '<div class="ht-row"><span class="ht-label">射程</span><span class="ht-val">'+d.range+'</span></div>');
  }else if(hovered.type==='post'){
    const p=hovered.obj;
    const ownerTxt=p.owner==='atk'?'攻方':(p.owner==='def'?'守方':'中立');
    const def=POST_TYPES[p.type]||POST_TYPES.branch;
    html='<div class="ht-name">'+p.name+' <span style="font-size:10px;color:#7d8fa2">['+(def.n)+']</span></div>'+
      '<div class="ht-row"><span class="ht-label">控制</span><span class="ht-val">'+ownerTxt+'</span></div>'+
      '<div class="ht-row"><span class="ht-label">占领</span><span class="ht-val">'+Math.round(p.cap/def.cap*100)+'%</span></div>'+
      (p._disabled?'<div class="ht-row" style="color:#ff7a5c">[失效]</div>':'');
  }
  hoverTipEl.innerHTML=html;
  hoverTipEl.classList.remove('hidden');
  const tipW = hoverTipEl.offsetWidth, tipH = hoverTipEl.offsetHeight;
  let tx=mx+14,ty=my+14;
  if(tx+tipW>W)tx=mx-tipW-14;
  if(ty+tipH>H)ty=my-tipH-14;
  hoverTipEl.style.left=tx+'px';hoverTipEl.style.top=ty+'px';
}
function hideHoverTip(){if(hoverTipEl)hoverTipEl.classList.add('hidden');}
cv.addEventListener('pointerleave',hideHoverTip);

function fieldTarget(g, point) {
  let target = null;
  let nearest = Infinity;
  for (const enemy of [...g.units, ...g.turrets]) {
    if (enemy.side === g.playerSide || enemy.side === 'neutral' || enemy.hp <= 0) continue;
    if (!visible(g, g.playerSide, enemy.x, enemy.y)) continue;
    const distance = dist2(enemy.x, enemy.y, point.x, point.y);
    const radius = Math.max(12 / g.cam.zoom, UNITS[enemy.type]?.r || enemy.r);
    if (distance > (radius + 10) ** 2 || distance >= nearest) continue;
    nearest = distance;
    target = enemy;
  }
  return target;
}

function issueFieldOrder(g, point, target) {
  const units = g.selection.filter(unit => unit.alive && unit.side === g.playerSide);
  if (!units.length) return;
  if (Net.role === 'client') {
    Net.sendToHost({ type: 'cmd', cmd: target ? 'attack' : 'move', ids: units.map(unit => unit.id),
      target: target?.id, x: point.x, y: point.y });
  } else if (target) {
    attackUnits(g, units, target);
  } else {
    orderMove(g, units, point.x, point.y);
  }
  addEffect(g, {
    type: 'ring', x: target?.x ?? point.x, y: target?.y ?? point.y, r: 20,
    life: 0.48, max: 0.48, col: target ? '#ffb188' : '#c8dfac', side: g.playerSide,
  });
  Snd.order();
}

function handleClick(mx, my, shiftKey, isDoubleTap) {
  const g = G;
  const w = screenToWorld(mx, my);
  if (isClientWaiting()) { toast(g, '正在同步战场数据…', 'bad'); return; }
  if(g.planMode){
    if(g.planMode==='zone'){createPlan(g,'zone',{cx:w.x,cy:w.y,r:150});toast(g,'区域防卫已建立','good');g.planMode=null;g.planPts=[];g.planPhase=null;updateModeTip(g);refreshPlanSidebar(g);return;}
    else{
      if(isDoubleTap&&g.planPts.length>=2){finishPlanDraw(g);return;}
      if(g.planPts.length>=2){const last=g.planPts[g.planPts.length-1];if(dist(w.x,w.y,last.x,last.y)<25/g.cam.zoom){finishPlanDraw(g);return;}}
      g.planPts.push({x:w.x,y:w.y});updateModeTip(g);return;
    }
  }
  if (g.mode === 'skill' && g.pendingSkill) {
    const key = g.pendingSkill;
    const skill = SKILLS[key];
    let accepted = false;
    if (Net.role === 'client') {
      if (skill.friendlyRange && !g.units.some(unit => unit.alive && unit.side === g.playerSide &&
          dist2(unit.x, unit.y, w.x, w.y) <= skill.friendlyRange ** 2)) {
        toast(g, skill.n + '范围内需要己方部队', 'bad');
        return;
      }
      Net.sendToHost({ type: 'cmd', cmd: 'skill', key, x: w.x, y: w.y });
      Snd.skill();
      accepted = true;
    } else accepted = useSkill(g, g.playerSide, key, w.x, w.y);
    if (accepted) {
      g.mode = null;
      g.pendingSkill = null;
      updateModeTip(g);
      refreshSkillRow(g);
    }
    return;
  }

  if (g.mode === 'deploy' && g.pendingDeploy) {
    const type = g.pendingDeploy;
    if (Net.role === 'client') {
      if (!getDeployPoint(g, g.playerSide, w.x, w.y) || !canWalk(g, w.x, w.y, type)) {
        toast(g, '请点击己方部署圈内的可通行地面', 'bad');
        return;
      }
      Net.sendToHost({ type: 'cmd', cmd: 'deploy', unit: type, x: w.x, y: w.y });
      Snd.deploy();
    } else {
      const deployment = startDeploy(g, g.playerSide, type, w.x, w.y);
      if (!deployment) return;
      toast(g, UNITS[type].n + '部署中', 'good');
      if (g.tutorial) g.tutorial.lastEv = { type: 'deploy' };
    }
    g.mode = null;
    g.pendingDeploy = null;
    updateModeTip(g);
    refreshDeployRow(g);
    return;
  }

  if (g.mode === 'order-move') {
    issueFieldOrder(g, w, null);
    g.mode = null;
    updateModeTip(g);
    return;
  }

  let picked = null;
  let nearest = Infinity;
  for (const unit of g.units) {
    if (!unit.alive || unit.side !== g.playerSide) continue;
    const radius = Math.max(12 / g.cam.zoom, UNITS[unit.type].r) + 8;
    const distance = dist2(w.x, w.y, unit.x, unit.y);
    if (distance <= radius ** 2 && distance < nearest) {
      nearest = distance;
      picked = unit;
    }
  }
  if (picked) {
    if (isDoubleTap) {
      g.selection = g.units.filter(unit => unit.alive && unit.side === g.playerSide &&
        unit.type === picked.type && onCamera(g, unit.x, unit.y, 0));
    } else if (!shiftKey) {
      g.selection = [picked];
    } else if (g.selection.includes(picked)) {
      g.selection = g.selection.filter(unit => unit !== picked);
    } else {
      g.selection.push(picked);
    }
    updateSelInfo(g);
    if (g.tutorial) g.tutorial.lastEv = { type: 'sel' };
    Snd.select();
    return;
  }

  if (g.selection.length) issueFieldOrder(g, w, fieldTarget(g, w));
}

function finishPlanDraw(g){
  const pts=g.planPts.slice();
  if(g.planMode==='front'){
    if(pts.length<2){toast(g,'前线至少需要2个点','bad');return;}
    createPlan(g,'front',{points:pts});toast(g,'前线已建立','good');
    g.planMode=null;g.planPts=[];g.planPhase=null;updateModeTip(g);refreshPlanSidebar(g);
  } else if(g.planMode==='line'){
    if(pts.length<2){toast(g,'线性防卫至少需要2个点','bad');return;}
    createPlan(g,'line',{points:pts});toast(g,'线性防卫已建立','good');
    g.planMode=null;g.planPts=[];g.planPhase=null;updateModeTip(g);refreshPlanSidebar(g);
  } else if(g.planMode==='attack'){
    if(pts.length<2){toast(g,'目标线至少需要2个点','bad');return;}
    if(!g.planStartLine||g.planStartLine.length<2){toast(g,'缺少前线基准','bad');return;}
    createPlan(g,'attack',{startPoints:g.planStartLine,targetPoints:pts});toast(g,'进攻计划已建立 · 可在侧栏启动','good');
    g.planMode=null;g.planPts=[];g.planPhase=null;g.planStartLine=null;updateModeTip(g);refreshPlanSidebar(g);
  }
}

/* ============ 战术轮盘 ============ */
let radialEl=null;
function openRadial(g,sx,sy,unit){
  closeRadial();
  if(isClientWaiting())return;
  g.radialTargets=unit?[unit]:(g.selection.length?g.selection.slice():[]);
  if(g.radialTargets.length===0)return;
  const el=document.createElement('div');
  el.id='radial';el.style.left=sx+'px';el.style.top=sy+'px';
  el.innerHTML='<div class="ring"></div><div class="rbtn center" data-act="recycle"><span class="ic">♻</span>回收</div><div class="rbtn" data-act="move" style="left:0px;top:-60px"><span class="ic">➤</span>移动</div><div class="rbtn" data-act="attack" style="left:60px;top:0px"><span class="ic">✶</span>攻击</div><div class="rbtn" data-act="defend" style="left:0px;top:60px"><span class="ic">◈</span>驻守</div><div class="rbtn" data-act="stop" style="left:-60px;top:0px"><span class="ic">■</span>停止</div>';
  document.body.appendChild(el);radialEl=el;
  el.querySelectorAll('.rbtn').forEach(b=>{
    b.addEventListener('click',ev=>{
      ev.stopPropagation();
      const act=b.dataset.act;
      const sel=unit?[unit]:(g.selection.length?g.selection:[]);
      if(sel.length===0){toast(g,'未选中部队','bad');closeRadial();return;}
      if(Net.role==='client'){
        if(act==='recycle'){Net.sendToHost({type:'cmd',cmd:'recycle',ids:sel.map(u=>u.id)});closeRadial();return;}
        if(act==='move'){toast(g,'点击地图指定移动目标','good');closeRadial();return;}
        if(act==='attack'){Net.sendToHost({type:'cmd',cmd:'attack',ids:sel.map(u=>u.id)});toast(g,'攻击指令已下达','good');closeRadial();return;}
        if(act==='defend'){Net.sendToHost({type:'cmd',cmd:'defend',ids:sel.map(u=>u.id)});toast(g,'部队进入驻守状态','good');closeRadial();return;}
        if(act==='stop'){Net.sendToHost({type:'cmd',cmd:'stop',ids:sel.map(u=>u.id)});toast(g,'部队停止行动','good');closeRadial();return;}
        closeRadial();return;
      }
      if(act==='recycle'){
        if(!b.dataset.confirm){b.dataset.confirm='1';b.innerHTML='<span class="ic">⚠</span>确认';b.style.background='#6a2a2a';b.style.borderColor='#ff6b4a';setTimeout(()=>{if(radialEl&&b.parentNode){b.dataset.confirm='';b.innerHTML='<span class="ic">♻</span>回收';b.style.background='';b.style.borderColor='';}},2500);return;}
        let total=0;for(const u of sel)total+=recycleUnit(g,u);
        toast(g,'回收 '+sel.length+' 支部队 · 获得 '+total+' CP','good');closeRadial();updateSelInfo(g);return;
      }
      if(act==='move'){toast(g,'点击地图指定移动目标','good');}
      else if(act==='attack'){
        let cnt=0;
        for(const u of sel){
          let best=null,bd=Infinity;
          for(const e of g.units){
            if(e.side===u.side||!e.alive)continue;
            if(!visible(g,u.side,e.x,e.y))continue;
            const d=dist(u.x,u.y,e.x,e.y);
            if(d<bd){bd=d;best=e;}
          }
          if(best){u.tid=best.id;u.holdPost=0;cnt++;}
        }
        toast(g,cnt>0?'攻击指令已下达':'未发现可见敌人',cnt>0?'good':'bad');
      }else if(act==='defend'){for(const u of sel){u.holdPost=1;u.order=null;u.path=null;}toast(g,'部队进入驻守状态','good');}
      else if(act==='stop'){for(const u of sel){u.order=null;u.path=null;u.tid=0;u.holdPost=0;}toast(g,'部队停止行动','good');}
      closeRadial();
    });
  });
  setTimeout(()=>{const close=()=>{closeRadial();document.removeEventListener('pointerdown',close);};document.addEventListener('pointerdown',close);},50);
}
function closeRadial(){if(G)G.radialTargets=null;if(radialEl){radialEl.remove();radialEl=null;}}
window.addEventListener('keydown',e=>{
  if(!G||G.state!=='playing')return;
  const k=e.key.toLowerCase();
  if (e.target instanceof HTMLElement && e.target.closest('input, select, textarea, [contenteditable]')) return;
  if (k === ' ' && e.target instanceof HTMLButtonElement) return;
  const modifier = e.ctrlKey || e.metaKey;
  if (k === 'r' && !modifier && !e.altKey && G.frontline) {
    if (!e.repeat) requestResupply(G);
    return;
  }
  if(DEPLOY_HOTKEYS[k] && !e.ctrlKey && !e.metaKey && !e.altKey && !(k>='1'&&k<='9')){
    e.preventDefault();
    tryDeployHotkey(G,k);
    return;
  }
  if(k==='a'&&!modifier)G.cam.x-=60/G.cam.zoom;
  if(k==='d'&&!e.ctrlKey)G.cam.x+=60/G.cam.zoom;
  if(k==='w')G.cam.y-=60/G.cam.zoom;
  if(k==='s'&&!e.ctrlKey&&e.key!=='S')G.cam.y+=60/G.cam.zoom;
  if(k==='arrowleft')G.cam.x-=60/G.cam.zoom;
  if(k==='arrowright')G.cam.x+=60/G.cam.zoom;
  if(k==='arrowup')G.cam.y-=60/G.cam.zoom;
  if(k==='arrowdown')G.cam.y+=60/G.cam.zoom;
  if(k==='escape'){G.mode=null;G.pendingSkill=null;G.pendingDeploy=null;G.planMode=null;G.planPts=[];G.planPhase=null;G.planStartLine=null;closeRadial();updateModeTip(G);}
  if(k>='1'&&k<='9'){
    const i=parseInt(k,10);
    if(e.shiftKey||e.ctrlKey){
      if(G.selection.length>0){G.squads[i]=G.selection.filter(u=>u.alive).map(u=>u.id);toast(G,'编队 '+i+' 已编入','good');refreshLeftPanel(G);}
      else toast(G,'请先选中部队','bad');
    }else{
      const sq=G.squads[i];
      if(sq&&sq.length>0){
        const sel=[];
        for(const id of sq){const u=findUnitById(G,id);if(u&&u.alive)sel.push(u);}
        G.selection=sel;G.hotSquad=i;
        if(sel.length>0)toast(G,'调用编队 '+i,'good');
        else{G.squads[i]=[];toast(G,'编队 '+i+' 已失效','bad');refreshLeftPanel(G);}
      }else toast(G,'编队 '+i+' 为空','bad');
    }
    updateSelInfo(G);
    return;
  }
  if(modifier&&k==='a'){e.preventDefault();G.selection=G.units.filter(u=>u.side===G.playerSide&&u.alive);updateSelInfo(G);toast(G,'选中 '+G.selection.length+' 支部队','good');return;}
  if(k===' '){e.preventDefault();if(G.selection.length>0){let cx=0,cy=0;for(const u of G.selection){cx+=u.x;cy+=u.y;}G.cam.x=cx/G.selection.length;G.cam.y=cy/G.selection.length;}return;}
  if (k === 'q' && !modifier && !e.altKey) {
    const keys = targetedSkills(G);
    const current = keys.indexOf(G.pendingSkill);
    for (let i = 1; i <= keys.length; i++) {
      const key = keys[(current + i) % keys.length];
      if (G.cp[G.playerSide] < SKILLS[key].cost || G.cd[G.playerSide][key] > 0) continue;
      requestSkill(G, key);
      return;
    }
    toast(G, '暂无可用的目标支援', 'bad');
  }
  if(k==='h'){
    if(G.selection.length===0){toast(G,'未选中部队','bad');return;}
    if(Net.role==='client'){Net.sendToHost({type:'cmd',cmd:'defend',ids:G.selection.map(u=>u.id)});toast(G,'部队进入驻守状态','good');return;}
    for (const u of G.selection) { cancelMovement(u); u.holdPost = 1; u.tid = 0; u._resupplying = false; }
    toast(G, '部队进入驻守状态', 'good');
  }
  if (k === 's' && e.shiftKey && !modifier) document.getElementById('rtStop').click();
  if(k==='p'){
    if(Net.role==='client'&&!G._clientReady){toast(G,'正在同步…','bad');return;}
    el.btnPlan.click();
  }
  clampCam(G);
});
