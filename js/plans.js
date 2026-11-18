"use strict";

/* ============ 计划 ============ */
function placePlanUnit(unit, x, y, hold = 1) {
  unit.order = { type: 'move', x, y };
  unit.path = null;
  unit.pathI = 0;
  unit.tid = 0;
  unit.holdPost = hold;
  unit._resupplying = false;
}

function distributeAlongLine(units, points, advance = false) {
  if (!points || points.length < 2 || !units.length) return;
  const lengths = points.slice(1).map((point, i) => dist(points[i].x, points[i].y, point.x, point.y));
  const total = lengths.reduce((sum, length) => sum + length, 0);
  if (!total) return;
  for (const [i, unit] of units.entries()) {
    let remaining = total * (units.length > 1 ? i / (units.length - 1) : 0.5);
    for (const [j, length] of lengths.entries()) {
      if (remaining <= length || j === lengths.length - 1) {
        const progress = length ? clamp(remaining / length, 0, 1) : 0;
        const x = lerp(points[j].x, points[j + 1].x, progress);
        const y = lerp(points[j].y, points[j + 1].y, progress);
        placePlanUnit(unit, x + (advance ? rnd(-25, 25) : 0), y + (advance ? rnd(-25, 25) : 0), advance ? 0 : 1);
        break;
      }
      remaining -= length;
    }
  }
}

function applyPlanToUnits(g, plan, units) {
  const assigned = units.filter(unit => unit.alive && unit.side === plan.side);
  if (!assigned.length) return false;
  clearPlanFromUnits(g, plan);
  plan.state = 'active';
  plan._activatedAt = g.time;
  for (const unit of assigned) unit.planId = plan.id;
  if (plan.type === 'attack') {
    distributeAlongLine(assigned, plan.targetPoints, true);
  } else if (plan.type === 'zone') {
    for (const unit of assigned) {
      const angle = Math.random() * Math.PI * 2;
      const distance = Math.random() * plan.r * 0.75;
      placePlanUnit(unit, plan.cx + Math.cos(angle) * distance, plan.cy + Math.sin(angle) * distance);
    }
  } else distributeAlongLine(assigned, plan.points);
  return true;
}

function clearPlanFromUnits(g, plan) {
  for (const unit of g.units) if (unit.planId === plan.id) unit.planId = null;
}

function ensureSelectionIsSquad(g) {
  const ids = g.selection.filter(unit => unit.alive).map(unit => unit.id);
  if (!ids.length) return null;
  const key = ids.slice().sort().join(',');
  for (const [slot, squad] of Object.entries(g.squads)) {
    const live = squad.filter(id => findUnitById(g, id)?.alive).sort().join(',');
    if (live === key) return Number(slot);
  }
  const free = Array.from({ length: 9 }, (_, i) => i + 1).find(slot => !g.squads[slot]?.length);
  const slot = free || g.hotSquad || 1;
  g.squads[slot] = ids;
  toast(g, '已编入编队 ' + slot, 'good');
  refreshLeftPanel(g);
  return slot;
}

function sendPlanChange(plan, action, units = []) {
  if (Net.role !== 'client') return;
  Net.sendToHost({
    type: 'cmd', cmd: 'plan', action, planId: plan.id, shape: plan,
    ids: units.map(unit => unit.id),
  });
}

function createPlan(g, type, geometry) {
  const squadId = ensureSelectionIsSquad(g);
  const units = g.selection.filter(unit => unit.alive);
  const plan = {
    id: uid(), type, side: g.playerSide, state: 'idle', squadId,
    unitIds: units.map(unit => unit.id), _activatedAt: 0, ...geometry,
  };
  g.plans.push(plan);
  if (type !== 'attack') applyPlanToUnits(g, plan, units);
  sendPlanChange(plan, 'set', units);
  refreshPlanSidebar(g);
  return plan;
}

function getPlanUnits(g, plan) {
  const ids = new Set(plan.squadId ? g.squads[plan.squadId] || [] : plan.unitIds);
  return g.units.filter(unit => unit.alive && unit.side === plan.side && ids.has(unit.id));
}

function activatePlan(g, plan) {
  if (plan.side !== g.playerSide || plan.peer) return;
  const units = getPlanUnits(g, plan);
  if (!applyPlanToUnits(g, plan, units)) {
    toast(g, '该编队没有存活部队', 'bad');
    return;
  }
  sendPlanChange(plan, 'set', units);
  toast(g, '计划已启动 · ' + units.length + ' 支部队', 'good');
  refreshPlanSidebar(g);
}

function stopPlan(g, plan) {
  const assigned = g.units.filter(unit => unit.alive && unit.planId === plan.id);
  plan.state = 'idle';
  plan._activatedAt = 0;
  clearPlanFromUnits(g, plan);
  if (plan.type === 'attack') {
    distributeAlongLine(assigned, plan.startPoints);
  } else {
    for (const unit of assigned) {
      cancelMovement(unit);
      unit.holdPost = 1;
    }
  }
}

function deactivatePlan(g, plan) {
  if (plan.side !== g.playerSide || plan.peer) return;
  stopPlan(g, plan);
  sendPlanChange(plan, 'stop');
  toast(g, plan.type === 'attack' ? '进攻已中止 · 返回前线' : '计划已中止', 'good');
  refreshPlanSidebar(g);
}

function deletePlan(g, plan) {
  clearPlanFromUnits(g, plan);
  g.plans = g.plans.filter(item => item !== plan);
}

function removePlan(g, id) {
  const plan = g.plans.find(item => item.id === id && item.side === g.playerSide && !item.peer);
  if (!plan) return;
  deletePlan(g, plan);
  sendPlanChange(plan, 'remove');
  refreshPlanSidebar(g);
}

function applyPeerPlan(g, side, peer, message, units) {
  if (!peer || !Number.isSafeInteger(message.planId)) return;
  let plan = g.plans.find(item => item.peer === peer && item.peerPlanId === message.planId);
  if (message.action === 'stop' && plan) stopPlan(g, plan);
  else if (message.action === 'remove' && plan) deletePlan(g, plan);
  else if (message.action === 'set' && units.length) {
    const shape = message.shape;
    const isPoint = point => point && Number.isFinite(point.x) && Number.isFinite(point.y);
    const pointAt = ({ x, y }) => ({ x: clamp(x, 0, MAP_W * CELL - 1), y: clamp(y, 0, MAP_H * CELL - 1) });
    const line = points => Array.isArray(points) && points.length >= 2 && points.length <= 256 && points.every(isPoint)
      ? points.map(pointAt) : null;
    let geometry;
    if (shape?.type === 'zone' && isPoint({ x: shape.cx, y: shape.cy })) {
      const center = pointAt({ x: shape.cx, y: shape.cy });
      geometry = { cx: center.x, cy: center.y, r: 150 };
    } else if (shape?.type === 'front' || shape?.type === 'line') {
      const points = line(shape.points);
      if (points) geometry = { points };
    } else if (shape?.type === 'attack') {
      const startPoints = line(shape.startPoints);
      const targetPoints = line(shape.targetPoints);
      if (startPoints && targetPoints) geometry = { startPoints, targetPoints };
    }
    if (!geometry) return;
    if (!plan) {
      plan = { id: uid(), peer, peerPlanId: message.planId, side };
      g.plans.push(plan);
    }
    Object.assign(plan, geometry, {
      type: shape.type, unitIds: units.map(unit => unit.id), state: 'idle', _activatedAt: 0,
    });
    if (shape.state === 'active') applyPlanToUnits(g, plan, units);
  }
}

function refreshPlanSidebar(g){
  const list=document.getElementById('planList');
  if(!list)return;
  const myPlans=g.plans.filter(p=>p.side===g.playerSide && !p.peer);
  if(myPlans.length===0){list.innerHTML='<div class="ps-empty">暂无计划<br>选择部队后点上方按钮创建</div>';return;}
  list.innerHTML='';
  myPlans.forEach((p,idx)=>{
    const item=document.createElement('div');
    item.className='plan-item'+(p.state==='active'?' active':'');
    let typeName='',typeCls='';
    if(p.type==='front'){typeName='前线';typeCls='front';}
    else if(p.type==='attack'){typeName='进攻';typeCls='attack';}
    else if(p.type==='zone'){typeName='区域防卫';typeCls='zone';}
    else if(p.type==='line'){typeName='线性防卫';typeCls='line';}
    const liveCount=getPlanUnits(g,p).length;
    const stateTxt=p.state==='active'?'执行中':'待命';
    const squadTxt=p.squadId?'编队 '+p.squadId:'—';
    let bonusTxt='';
    if(p.state==='active'&&p._activatedAt){
      const b=clamp((g.time-p._activatedAt)/180,0,1);
      bonusTxt=' · 加成 +'+Math.round(b*30)+'%';
    }
    let btns='';
    if(p.state==='active')btns='<button class="pi-btn stop" data-act="stop" data-id="'+p.id+'">中止</button>';
    else btns='<button class="pi-btn start" data-act="start" data-id="'+p.id+'">启动</button>';
    item.innerHTML='<div class="pi-title"><span>#'+(idx+1)+'</span><span class="pi-type '+typeCls+'">'+typeName+'</span></div><div class="pi-info">'+squadTxt+' · '+liveCount+' 支 · '+stateTxt+bonusTxt+'</div><div class="pi-btns">'+btns+'<button class="pi-btn" data-act="focus" data-id="'+p.id+'">定位</button><button class="pi-btn del" data-act="del" data-id="'+p.id+'">×</button></div>';
    list.appendChild(item);
  });
  list.querySelectorAll('.pi-btn').forEach(btn=>{
    btn.onclick=()=>{
      const act=btn.dataset.act;const id=parseInt(btn.dataset.id,10);
      const plan=g.plans.find(p=>p.id===id);
      if(!plan)return;
      if(act==='start')activatePlan(g,plan);
      else if(act==='stop')deactivatePlan(g,plan);
      else if(act==='del')removePlan(g,id);
      else if(act==='focus'){
        let cx,cy;
        if(plan.type==='zone'){cx=plan.cx;cy=plan.cy;}
        else{const pts=plan.type==='attack'?plan.targetPoints:plan.points;if(pts&&pts.length){cx=pts[Math.floor(pts.length/2)].x;cy=pts[Math.floor(pts.length/2)].y;}}
        if(cx!==undefined){g.cam.x=cx;g.cam.y=cy;}
      }
    };
  });
}
