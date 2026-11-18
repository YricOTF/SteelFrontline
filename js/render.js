"use strict";

/* ============ 画布 ============ */
const cv=document.getElementById('game');
const ctx=cv.getContext('2d',{alpha:false});
let W=0,H=0,DPR=1;
function resize() {
  DPR = Math.min(window.devicePixelRatio || 1, 2);
  W = cv.clientWidth;
  H = cv.clientHeight;
  cv.width = Math.floor(W * DPR);
  cv.height = Math.floor(H * DPR);
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  if (G) clampCam(G);
}
window.addEventListener('resize',resize);
window.addEventListener('orientationchange',()=>setTimeout(resize,180));
/* ============ 渲染 ============ */
let lastT=performance.now(),acc=0,lastRender=0,lastMapDraw=0;
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
function loop(t){
  requestAnimationFrame(loop);
  const dt=(t-lastT)/1000;lastT=t;
  if(G&&G.state==='playing'){
    if(Net.role!=='client'){
      acc+=Math.min(dt,.3);let steps=0;
      while(acc>=TICK&&steps<10){step(TICK);acc-=TICK;steps++;}
      if(steps>=10)acc=0;
    }else{
      clientTick(G,Math.min(dt,.1));
    }
  }
  const minInterval=1000/CFG.fps-1;
  if (G && t - lastRender >= minInterval) {
    lastRender = t;
    render();
    if (G.state === 'playing' && t - lastMapDraw >= 80) {
      lastMapDraw = t;
      drawTacticalMap(G);
    }
  }
  Snd.updateAmbience(G);
}
function clientTick(g,dt){
  for(let i=g.effects.length-1;i>=0;i--){g.effects[i].life-=dt;if(g.effects[i].life<=0)g.effects.splice(i,1);}
  for (const projectile of g.projectiles) {
    projectile.t = Math.min(projectile.flight, projectile.t + dt);
  }

}
function onCamera(g, x, y, margin = 40) {
  return Math.abs(x - g.cam.x) <= W / (2 * g.cam.zoom) + margin &&
    Math.abs(y - g.cam.y) <= H / (2 * g.cam.zoom) + margin;
}

function drawFieldLighting(g) {
  const width = MAP_W * CELL;
  const height = MAP_H * CELL;
  const night = (1 - g.env.dayAmount) * 0.43;
  if (night > 0.015) {
    ctx.fillStyle = 'rgba(12, 23, 43, ' + night + ')';
    ctx.fillRect(0, 0, width, height);
  }
  if (g.cfg.weather !== 'clear') {
    ctx.fillStyle = g.cfg.weather === 'fog' ? 'rgba(166,177,163,.24)' : 'rgba(47,65,62,.19)';
    ctx.fillRect(0, 0, width, height);
  }
  ctx.drawImage(fogLayer(g), 0, 0, width, height);
  ctx.strokeStyle = '#69745c';
  ctx.lineWidth = 1 / g.cam.zoom;
  ctx.strokeRect(0, 0, width, height);
}

function drawSupplyRanges(g) {
  if (!g.showSupply) return;
  for (const node of g.supplies[g.playerSide]) {
    if (!onCamera(g, node.x, node.y, node.radius)) continue;
    ctx.save();
    ctx.beginPath();
    ctx.arc(node.x, node.y, node.radius, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(170,211,154,.075)';
    ctx.fill();
    ctx.strokeStyle = '#a5c694';
    ctx.lineWidth = 1.5 / g.cam.zoom;
    ctx.setLineDash([8, 8]);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#d3e5bd';
    ctx.font = '600 ' + 11 / g.cam.zoom + 'px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('补给范围', node.x, node.y + node.radius - 7 / g.cam.zoom);
    ctx.restore();
  }
}

function drawSmoke(g) {
  for (const smoke of g.smokes) {
    if (!onCamera(g, smoke.x, smoke.y, smoke.radius * 1.4)) continue;
    const seen = smoke.side === g.playerSide || [
      [0, 0], [1, 0], [-1, 0], [0, -1], [0, 1],
    ].some(([x, y]) => visible(g, g.playerSide, smoke.x + x * smoke.radius, smoke.y + y * smoke.radius));
    if (!seen) continue;
    const remaining = smoke.until - g.time;
    ctx.save();
    ctx.globalAlpha = clamp(remaining / 2, 0.10, 1);
    ctx.strokeStyle = 'rgba(229,238,218,.64)';
    ctx.lineWidth = 1.3 / g.cam.zoom;
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.arc(smoke.x, smoke.y, smoke.radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    if (CFG.fx && CFG.quality !== 'low') {
      for (let i = 0; i < 6; i++) {
        const angle = i * 2.4 + g.time * (reduceMotion.matches ? 0 : 0.32);
        const x = smoke.x + Math.cos(angle) * smoke.radius * 0.44;
        const y = smoke.y + Math.sin(angle) * smoke.radius * 0.42;
        const radius = smoke.radius * (0.61 + (i % 3) * 0.11);
        const haze = ctx.createRadialGradient(x, y, 0, x, y, radius);
        haze.addColorStop(0, 'rgba(188,199,179,.37)');
        haze.addColorStop(1, 'rgba(148,157,142,0)');
        ctx.fillStyle = haze;
        ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
      }
    } else {
      ctx.fillStyle = 'rgba(198,205,186,.22)';
      ctx.fill();
    }
    ctx.restore();
  }
}

function drawCommandPaths(g) {
  ctx.save();
  ctx.lineWidth = 1.6 / g.cam.zoom;
  ctx.setLineDash([5 / g.cam.zoom, 5 / g.cam.zoom]);
  for (const unit of g.selection) {
    if (!unit.alive || unit.order?.type !== 'move' || !onCamera(g, unit.x, unit.y)) continue;
    const route = unit.path?.slice(unit.pathI) || [unit.order];
    ctx.strokeStyle = unit._resupplying ? 'rgba(188,224,160,.65)' : 'rgba(232,218,168,.62)';
    ctx.beginPath();
    ctx.moveTo(unit.x, unit.y);
    for (const point of route) ctx.lineTo(point.x, point.y);
    ctx.stroke();
  }
  ctx.restore();
}

function drawRain(g) {
  if (g.cfg.weather !== 'rain' || !CFG.fx || CFG.quality === 'low' || reduceMotion.matches) return;
  ctx.strokeStyle = 'rgba(175,204,211,.19)';
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  for (let i = 0; i < (CFG.quality === 'high' ? 74 : 36); i++) {
    const rate = 0.66 + hash2(i, 7, 21);
    const x = (hash2(i, 11, 7) * W + g.time * rate * 185) % W;
    const y = (hash2(i, 3, 9) * H + g.time * rate * 395) % H;
    ctx.moveTo(x, y);
    ctx.lineTo(x + 8 * rate, y + 18 * rate);
  }
  ctx.stroke();
}

function render(){
  ctx.setTransform(DPR,0,0,DPR,0,0);
  ctx.fillStyle='#111814';ctx.fillRect(0,0,W,H);
  if(!G)return;
  const g=G,cam=g.cam;
  const amplitude = CFG.fx && CFG.shake && !reduceMotion.matches ? g.shake * 6 : 0;
  const shx = amplitude * rnd(-1, 1);
  const shy = amplitude * rnd(-1, 1);
  if(Net.role==='client'){
    const k=1-Math.pow(0.001,0.05);
    for(const u of g.units){if(u._netTarget){u.x+=(u._netTarget.x-u.x)*k;u.y+=(u._netTarget.y-u.y)*k;}}
  }
  ctx.save();ctx.translate(W/2+shx,H/2+shy);ctx.scale(cam.zoom,cam.zoom);ctx.translate(-cam.x,-cam.y);

  if(g.terrainCanvas && g.terrainCanvas.width>0){
    ctx.drawImage(g.terrainCanvas, 0, 0, MAP_W*CELL, MAP_H*CELL);
  } else {
    drawTerrainLive(g);
  }

  drawBurningZones(g);
  drawOilTanks(g);

  const ev=g._events;
  if(ev.volcanoZone){
    ctx.beginPath();ctx.arc(ev.volcanoZone.x,ev.volcanoZone.y,ev.volcanoZone.r,0,6.284);
    const grd=ctx.createRadialGradient(ev.volcanoZone.x,ev.volcanoZone.y,0,ev.volcanoZone.x,ev.volcanoZone.y,ev.volcanoZone.r);
    grd.addColorStop(0,'rgba(255,90,30,.35)');grd.addColorStop(0.6,'rgba(180,40,20,.2)');grd.addColorStop(1,'rgba(80,20,10,0)');
    ctx.fillStyle=grd;ctx.fill();
  }
  if(ev.oilBoom){
    const a=clamp(ev.oilBoom.life/ev.oilBoom.max,0,1);
    ctx.beginPath();ctx.arc(ev.oilBoom.x,ev.oilBoom.y,480*(1.15-a*0.15),0,6.284);
    ctx.fillStyle='rgba(255,90,30,'+(0.10*a)+')';ctx.fill();
  }

  drawFieldLighting(g);
  drawSmoke(g);
  drawSupplyRanges(g);

  for(const plan of g.plans){
    if(plan.side!==g.playerSide)continue;
    const active=plan.state==='active';
    const baseAlpha=active?0.55:0.22;
    if(plan.type==='front'||plan.type==='line'){
      const pts=plan.points;
      const col=plan.type==='front'?'rgba(120,220,255,'+baseAlpha+')':'rgba(200,140,255,'+baseAlpha+')';
      ctx.beginPath();ctx.moveTo(pts[0].x,pts[0].y);
      for(let i=1;i<pts.length;i++)ctx.lineTo(pts[i].x,pts[i].y);
      ctx.strokeStyle=col;ctx.lineWidth=3/cam.zoom;
      if(!active)ctx.setLineDash([14,8]);ctx.stroke();ctx.setLineDash([]);
      for(const pt of pts){ctx.beginPath();ctx.arc(pt.x,pt.y,4.5/cam.zoom,0,6.284);ctx.fillStyle=active?(plan.type==='front'?'#9fd8ff':'#c8a8ff'):'rgba(159,216,255,.35)';ctx.fill();}
    } else if(plan.type==='zone'){
      ctx.beginPath();ctx.arc(plan.cx,plan.cy,plan.r,0,6.284);
      ctx.fillStyle=active?'rgba(80,200,140,.07)':'rgba(80,200,140,.03)';ctx.fill();
      ctx.strokeStyle=active?'rgba(120,255,180,.55)':'rgba(120,255,180,.25)';
      ctx.lineWidth=3/cam.zoom;ctx.setLineDash([12,8]);ctx.stroke();ctx.setLineDash([]);
    } else if(plan.type==='attack'){
      const sPts=plan.startPoints;
      ctx.beginPath();ctx.moveTo(sPts[0].x,sPts[0].y);
      for(let i=1;i<sPts.length;i++)ctx.lineTo(sPts[i].x,sPts[i].y);
      ctx.strokeStyle='rgba(150,200,255,.22)';ctx.lineWidth=2.5/cam.zoom;ctx.setLineDash([8,6]);ctx.stroke();ctx.setLineDash([]);
      const tPts=plan.targetPoints;
      ctx.beginPath();ctx.moveTo(tPts[0].x,tPts[0].y);
      for(let i=1;i<tPts.length;i++)ctx.lineTo(tPts[i].x,tPts[i].y);
      ctx.strokeStyle=active?'rgba(255,120,90,.55)':'rgba(255,120,90,.22)';ctx.lineWidth=3/cam.zoom;
      if(!active)ctx.setLineDash([10,8]);ctx.stroke();ctx.setLineDash([]);
    }
  }
  if(g.planMode&&g.planPts.length>0){
    const pts=g.planPts;
    if(g.planMode==='zone'&&pts.length>0){
      ctx.beginPath();ctx.arc(pts[0].x,pts[0].y,150,0,6.284);
      ctx.fillStyle='rgba(80,200,140,.10)';ctx.fill();
      ctx.strokeStyle='rgba(120,255,180,.8)';ctx.lineWidth=2.5/cam.zoom;ctx.stroke();
    } else if(pts.length>0){
      if(g.planMode==='attack'&&g.planStartLine&&g.planStartLine.length>=2){
        ctx.beginPath();ctx.moveTo(g.planStartLine[0].x,g.planStartLine[0].y);
        for(let i=1;i<g.planStartLine.length;i++)ctx.lineTo(g.planStartLine[i].x,g.planStartLine[i].y);
        ctx.strokeStyle='rgba(150,200,255,.7)';ctx.lineWidth=3/cam.zoom;
        ctx.setLineDash([8,6]);ctx.stroke();ctx.setLineDash([]);
      }
      ctx.beginPath();ctx.moveTo(pts[0].x,pts[0].y);
      for(let i=1;i<pts.length;i++)ctx.lineTo(pts[i].x,pts[i].y);
      if(g.pointerWorld)ctx.lineTo(g.pointerWorld.x,g.pointerWorld.y);
      let col='rgba(120,220,255,.9)';
      if(g.planMode==='line')col='rgba(200,140,255,.9)';
      if(g.planMode==='attack')col='rgba(255,120,90,.9)';
      ctx.strokeStyle=col;ctx.lineWidth=3/cam.zoom;
      ctx.setLineDash([10,6]);ctx.stroke();ctx.setLineDash([]);
      for(let i=0;i<pts.length;i++){ctx.beginPath();ctx.arc(pts[i].x,pts[i].y,5/cam.zoom,0,6.284);ctx.fillStyle=col;ctx.fill();}
    }
  }
  if(g.spawnPoint){
    ctx.beginPath();ctx.arc(g.spawnPoint.x,g.spawnPoint.y,g.forbiddenRadius||DEF_FORBIDDEN_RADIUS,0,6.284);
    ctx.strokeStyle='rgba(232,83,63,.20)';ctx.lineWidth=1.5/cam.zoom;
    ctx.setLineDash([10,10]);ctx.stroke();ctx.setLineDash([]);
  }
  if(g.playerSide==='atk'){
    for(const sp of g.atkSpawnPoints){
      ctx.beginPath();ctx.arc(sp.x,sp.y,DEPLOY_RADIUS,0,6.284);
      ctx.strokeStyle='rgba(255,200,90,.20)';ctx.lineWidth=1.5/cam.zoom;
      ctx.setLineDash([10,10]);ctx.stroke();ctx.setLineDash([]);
    }
  }
  if(g.mode==='deploy'){
    for(const dp of g.deployPoints){
      if(dp.side!==g.playerSide)continue;
      ctx.beginPath();ctx.arc(dp.x,dp.y,dp.r,0,6.284);
      ctx.fillStyle='rgba(255,180,90,.05)';ctx.fill();
      ctx.strokeStyle='rgba(255,180,90,.5)';ctx.lineWidth=2/cam.zoom;
      ctx.setLineDash([10,8]);ctx.stroke();ctx.setLineDash([]);
      ctx.beginPath();ctx.arc(dp.x,dp.y,6/cam.zoom,0,6.284);ctx.fillStyle='#ffb45a';ctx.fill();
      ctx.fillStyle='#1a1a1a';ctx.font='bold '+(9/cam.zoom)+'px sans-serif';
      ctx.textAlign='center';ctx.textBaseline='middle';
      ctx.fillText('+',dp.x,dp.y+1);
    }
  }
  for(const tr of g.trenches){
    const known=(tr.side===g.playerSide)||visible(g,g.playerSide,tr.x,tr.y);
    if(!known)continue;
    ctx.beginPath();ctx.arc(tr.x,tr.y,tr.r,0,6.284);
    ctx.fillStyle='rgba(90,60,30,.42)';ctx.fill();
    ctx.strokeStyle=tr.side==='atk'?'rgba(255,140,90,.55)':'rgba(120,190,255,.55)';
    ctx.lineWidth=2;ctx.setLineDash([6,5]);ctx.stroke();ctx.setLineDash([]);
  }
  for(const p of g.posts) if (onCamera(g, p.x, p.y, 170)) drawPost(g, p);
  for(const t of g.turrets){
    if (!onCamera(g, t.x, t.y)) continue;
    const isOwn=(t.owner===g.playerSide);
    const inView=visible(g,g.playerSide,t.x,t.y);
    const discovered=t.discovered||inView||isOwn;
    if(!discovered)continue;
    drawTurret(g, inView || isOwn ? t : { ...t, owner: 'neutral', ruin: false }, inView || isOwn);
  }
  for(const dep of g.deploying){
    if(dep.side!==g.playerSide || !onCamera(g, dep.x, dep.y))continue;
    const prog=1-dep.timeLeft/dep.total;
    const col=dep.side==='atk'?'#ff8a5c':'#6cb6ff';
    ctx.beginPath();ctx.arc(dep.x,dep.y,26,0,6.284);
    ctx.strokeStyle='rgba(0,0,0,.55)';ctx.lineWidth=4;ctx.stroke();
    ctx.beginPath();ctx.arc(dep.x,dep.y,26,-Math.PI/2,-Math.PI/2+6.284*prog);
    ctx.strokeStyle=col;ctx.lineWidth=4;ctx.stroke();
    ctx.fillStyle=col;ctx.font='bold 11px sans-serif';
    ctx.textAlign='center';ctx.textBaseline='middle';
    ctx.fillText(UNITS[dep.type].n[0],dep.x,dep.y);
  }
  drawCommandPaths(g);
  for(const u of g.units){
    if(!u.alive || !onCamera(g, u.x, u.y))continue;
    if(u.side!==g.playerSide&&!visible(g,g.playerSide,u.x,u.y))continue;
    drawUnit(g,u);
  }
  for(const p of g.projectiles){
    if (!CFG.fx) continue;
    const pr=clamp(p.t/p.flight, 0, 1);
    const groundX = lerp(p.x, p.tx, pr);
    const groundY = lerp(p.y, p.ty, pr);
    if (!onCamera(g, groundX, groundY, 110)) continue;
    if (p.side !== g.playerSide && !visible(g, g.playerSide, groundX, groundY)) continue;
    const x=groundX;const y=groundY-Math.sin(pr*Math.PI)*90;
    ctx.beginPath();ctx.arc(x,y,3,0,6.284);
    ctx.fillStyle=p.neutral?'#ffce6b':(p.side==='atk'?'#ffb27a':'#9fd0ff');ctx.fill();
  }
  if(CFG.fx)drawEffects(g);
  if(g.drag&&g.drag.active&&g.drag.box){
    const b=g.drag.box;
    ctx.strokeStyle='rgba(120,220,160,.95)';ctx.lineWidth=2/cam.zoom;
    ctx.fillStyle='rgba(120,220,160,.14)';
    ctx.fillRect(b.x,b.y,b.w,b.h);ctx.strokeRect(b.x,b.y,b.w,b.h);
  }
  const pulse = reduceMotion.matches ? 1 : 0.5 + 0.5 * Math.sin(performance.now() / 240);
  for(const u of g.selection){
    if(!u.alive)continue;
    const r = Math.max(UNITS[u.type].r + 8, 13 / cam.zoom);
    ctx.beginPath();ctx.arc(u.x,u.y,r,0,6.284);
    ctx.strokeStyle='rgba(125,255,176,'+(0.6+pulse*0.4)+')';
    ctx.lineWidth=2.2/cam.zoom;ctx.stroke();
  }
  for(const k in g.squads){
    const sq=g.squads[k];
    if(!sq||sq.length===0)continue;
    const color=SQUAD_COLORS[parseInt(k,10)-1];
    for(const id of sq){
      const u=findUnitById(g,id);
      if(!u||!u.alive||u.side!==g.playerSide)continue;
      if(!visible(g,g.playerSide,u.x,u.y))continue;
      const r=UNITS[u.type].r+3;
      ctx.beginPath();ctx.arc(u.x,u.y,r,0,6.284);
      ctx.strokeStyle=color;ctx.globalAlpha=0.7;ctx.lineWidth=2/cam.zoom;ctx.stroke();
      ctx.globalAlpha=1;
    }
  }
  if(g.radialTargets){
    const pl=0.5+0.5*Math.sin(performance.now()/180);
    for(const u of g.radialTargets){
      if(!u.alive)continue;
      const r=UNITS[u.type].r+12;
      ctx.beginPath();ctx.arc(u.x,u.y,r,0,6.284);
      ctx.strokeStyle='rgba(255,206,107,'+(0.5+pl*0.5)+')';
      ctx.lineWidth=2.5/cam.zoom;ctx.setLineDash([7,5]);
      ctx.lineDashOffset=-performance.now()/90;ctx.stroke();
      ctx.setLineDash([]);ctx.lineDashOffset=0;
    }
  }
  if(g.mode==='skill'&&g.pointerWorld){
    const s=SKILLS[g.pendingSkill];
    if(s&&s.radius){
      ctx.beginPath();ctx.arc(g.pointerWorld.x,g.pointerWorld.y,s.radius,0,6.284);
      ctx.fillStyle=s.neutral?'rgba(255,206,107,.15)':'rgba(255,120,80,.13)';ctx.fill();
      ctx.strokeStyle=s.neutral?'rgba(255,206,107,.85)':'rgba(255,140,90,.85)';ctx.lineWidth=2/cam.zoom;ctx.stroke();
      if(s.friendlyRange){
        let hasFriendly=false;
        for(const u of g.units){if(u.side===g.playerSide&&u.alive&&dist(u.x,u.y,g.pointerWorld.x,g.pointerWorld.y)<=s.friendlyRange){hasFriendly=true;break;}}
        ctx.beginPath();ctx.arc(g.pointerWorld.x,g.pointerWorld.y,s.friendlyRange,0,6.284);
        ctx.strokeStyle=hasFriendly?'rgba(120,255,180,.6)':'rgba(255,120,120,.6)';ctx.lineWidth=1.5/cam.zoom;
        ctx.setLineDash([10,8]);ctx.stroke();ctx.setLineDash([]);
      }
    }
  }
  if(g.mode==='deploy'&&g.pointerWorld){
    ctx.beginPath();ctx.arc(g.pointerWorld.x,g.pointerWorld.y,20,0,6.284);
    const { x, y } = g.pointerWorld;
    const valid = getDeployPoint(g, g.playerSide, x, y) && canWalk(g, x, y, g.pendingDeploy);
    ctx.strokeStyle = valid ? '#b9e2a5' : '#f59a85';
    ctx.lineWidth = 2 / cam.zoom;
    ctx.stroke();
  }
  ctx.restore();
  drawRain(g);
}

function drawBurningZones(g){
  const bzs=g._events.burnZones;
  if(!bzs||bzs.length===0)return;
  const cam=g.cam;
  const halfW=(W/2)/cam.zoom+240;
  const halfH=(H/2)/cam.zoom+240;
  const tNow = reduceMotion.matches ? 0 : g.time;
  const lowQ=CFG.quality==='low' || !CFG.fx;
  for(const bz of bzs){
    if(Math.abs(bz.x-cam.x)>halfW+bz.r)continue;
    if(Math.abs(bz.y-cam.y)>halfH+bz.r)continue;

    ctx.beginPath();ctx.arc(bz.x,bz.y,bz.r,0,6.284);
    ctx.fillStyle='rgba(28,13,7,0.52)';ctx.fill();
    ctx.beginPath();ctx.arc(bz.x,bz.y,bz.r*0.62,0,6.284);
    ctx.fillStyle='rgba(78,30,12,0.42)';ctx.fill();

    const nFlame = lowQ
      ? Math.min(6,Math.max(3,Math.round(bz.r/26)))
      : Math.min(20,Math.max(5,Math.round(bz.r/11)));

    for(let i=0;i<nFlame;i++){
      const s1=hash2(i*7+1,(bz.x|0)&0x7fff,11);
      const s2=hash2(i*13+3,(bz.y|0)&0x7fff,23);
      const s3=hash2(i*3+5,((bz.x+bz.y)|0)&0x7fff,37);
      const a=s1*6.283;
      const rr=Math.sqrt(s2)*bz.r*0.84;
      const fx=bz.x+Math.cos(a)*rr;
      const fy=bz.y+Math.sin(a)*rr;
      const ph=tNow*(2.0+s3*1.9)+s3*6.283;
      const flick=0.5+0.5*Math.sin(ph);
      const hh=(bz.r*0.18+13)*(0.62+0.75*flick);
      const ww=hh*0.42;

      ctx.globalAlpha=0.55+0.35*flick;
      ctx.beginPath();
      ctx.moveTo(fx-ww, fy);
      ctx.quadraticCurveTo(fx-ww*0.5, fy-hh*0.55, fx, fy-hh);
      ctx.quadraticCurveTo(fx+ww*0.5, fy-hh*0.55, fx+ww, fy);
      ctx.closePath();
      ctx.fillStyle='#ff6a14';
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(fx-ww*0.42, fy);
      ctx.quadraticCurveTo(fx, fy-hh*0.70, fx+ww*0.42, fy);
      ctx.closePath();
      ctx.fillStyle='#ffd46a';
      ctx.fill();
      ctx.globalAlpha=1;
    }

    const glowR=bz.r*0.55;
    const gr=ctx.createRadialGradient(bz.x,bz.y,0,bz.x,bz.y,glowR);
    const pulse=0.5+0.5*Math.sin(tNow*3+bz.x*0.01);
    gr.addColorStop(0,'rgba(255,150,50,'+(0.18+pulse*0.10)+')');
    gr.addColorStop(1,'rgba(255,80,20,0)');
    ctx.beginPath();ctx.arc(bz.x,bz.y,glowR,0,6.284);
    ctx.fillStyle=gr;ctx.fill();

    if(!lowQ){
      for(let i=0;i<4;i++){
        const s4=hash2(i*17+9,(bz.x|0)&0x3ff,61);
        const s5=hash2(i*23+11,(bz.y|0)&0x3ff,71);
        const ph2=(tNow*0.7+s4)%1;
        const px=bz.x+(s4-0.5)*bz.r*1.2;
        const py=bz.y-ph2*bz.r*1.5+(s5-0.5)*20;
        ctx.globalAlpha=(1-ph2)*0.8;
        ctx.fillStyle='#ffb45a';
        ctx.beginPath();ctx.arc(px,py,1.6+ (1-ph2)*1.4,0,6.284);ctx.fill();
        ctx.globalAlpha=1;
      }
    }
  }
}

function drawOilTanks(g){
  const tanks=g._oilTanks;
  if(!tanks||tanks.length===0)return;
  for(const tk of tanks){
    if(!tk.alive || !onCamera(g, tk.x, tk.y))continue;
    ctx.save();
    ctx.translate(tk.x,tk.y);
    ctx.beginPath();ctx.ellipse(3,5,tk.r*1.1,tk.r*0.65,0,0,6.284);
    ctx.fillStyle='rgba(0,0,0,0.42)';ctx.fill();
    ctx.beginPath();ctx.arc(0,0,tk.r,0,6.284);
    ctx.fillStyle='#7d7d86';ctx.fill();
    ctx.beginPath();ctx.arc(0,0,tk.r*0.74,0,6.284);
    ctx.fillStyle='#5c5c66';ctx.fill();
    ctx.beginPath();ctx.arc(0,0,tk.r,0,6.284);
    ctx.strokeStyle='#a8aeb8';ctx.lineWidth=2;ctx.stroke();
    ctx.beginPath();ctx.arc(0,0,tk.r*0.36,0,6.284);
    ctx.fillStyle='#d8a020';ctx.fill();
    ctx.beginPath();ctx.arc(0,0,tk.r*0.36,0,6.284);
    ctx.strokeStyle='#3a2a10';ctx.lineWidth=1.2;ctx.stroke();
    ctx.fillStyle='#231a06';
    ctx.font='bold '+(tk.r*0.62)+'px sans-serif';
    ctx.textAlign='center';ctx.textBaseline='middle';
    ctx.fillText('⚠',0,1);
    ctx.restore();
    ctx.fillStyle='rgba(255,190,90,.75)';
    ctx.font='bold 9px sans-serif';
    ctx.textAlign='center';
    ctx.fillText('油罐',tk.x,tk.y-tk.r-6);
  }
}

function drawTerrainLive(g){
  const cam=g.cam;
  const halfW=(W/2)/cam.zoom + CELL;
  const halfH=(H/2)/cam.zoom + CELL;
  const x0=Math.max(0, Math.floor((cam.x-halfW)/CELL));
  const x1=Math.min(MAP_W-1, Math.ceil((cam.x+halfW)/CELL));
  const y0=Math.max(0, Math.floor((cam.y-halfH)/CELL));
  const y1=Math.min(MAP_H-1, Math.ceil((cam.y+halfH)/CELL));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      ctx.fillStyle = terrainColor(g.terrain[y * MAP_W + x], x, y);
      ctx.fillRect(x * CELL, y * CELL, CELL, CELL);
    }
  }
}

function drawPost(g, post) {
  const type = POST_TYPES[post.type];
  const color = post._disabled ? '#9b9a89' : TEAM_COLORS[post.owner];
  const contested = post._atkP > 0 && post._defP > 0 &&
    (post.owner === g.playerSide || visible(g, g.playerSide, post.x, post.y));
  const size = post.type === 'hq' ? 31 : (post.type === 'branch' ? 24 : 20);
  ctx.save();
  ctx.translate(post.x, post.y);

  ctx.beginPath();
  ctx.arc(0, 0, type.radius, 0, Math.PI * 2);
  ctx.strokeStyle = contested ? '#e2c480' : color;
  ctx.lineWidth = 1.7 / g.cam.zoom;
  ctx.globalAlpha = contested ? 0.7 : 0.38;
  ctx.setLineDash([7, 8]);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;

  const scale = Math.max(1 / g.cam.zoom, 0.8);
  ctx.scale(scale, scale);
  ctx.fillStyle = 'rgba(16,25,21,.94)';
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(0, -size * 0.58);
  ctx.lineTo(size * 0.54, -size * 0.28);
  ctx.lineTo(size * 0.54, size * 0.28);
  ctx.lineTo(0, size * 0.58);
  ctx.lineTo(-size * 0.54, size * 0.28);
  ctx.lineTo(-size * 0.54, -size * 0.28);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.font = '700 ' + (post.type === 'hq' ? 15 : 12) + 'px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = color;
  ctx.fillText(post.type === 'hq' ? '★' : (post.type === 'branch' ? '◆' : '■'), 0, 0);
  const label = post.name + (post._disabled ? ' · 失效' : '');
  ctx.font = '700 11px sans-serif';
  const labelWidth = ctx.measureText(label).width + 12;
  ctx.fillStyle = 'rgba(14,21,17,.88)';
  ctx.fillRect(-labelWidth / 2, -size * 0.58 - 21, labelWidth, 17);
  ctx.fillStyle = '#e7e8d9';
  ctx.fillText(label, 0, -size * 0.58 - 12);
  if (!post._disabled) {
    const barWidth = size * 1.6;
    ctx.fillStyle = '#161c16';
    ctx.fillRect(-barWidth / 2, size * 0.58 + 5, barWidth, 5);
    ctx.fillStyle = contested ? '#e2c480' : color;
    ctx.fillRect(-barWidth / 2, size * 0.58 + 5, barWidth * clamp(post.cap / type.cap, 0, 1), 5);
    if (post.owner === 'atk' && post.integrate < 1) {
      ctx.font = '10px sans-serif';
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#121b17';
      const status = '整合 ' + Math.round(post.integrate * 100) + '%';
      ctx.strokeText(status, 0, size * 0.58 + 19);
      ctx.fillStyle = '#ead098';
      ctx.fillText(status, 0, size * 0.58 + 19);
    }
  }
  ctx.restore();
}

function drawTurret(g,t,showHp){
  const col=t.owner==='atk'?'#ff8a5c':(t.owner==='def'?'#5fa8ff':'#8a8a8a');
  const isRuin=t.ruin;
  ctx.save();ctx.translate(t.x,t.y);
  ctx.beginPath();ctx.arc(0,0,t.r+4,0,6.284);
  ctx.fillStyle=isRuin?'rgba(20,18,18,.9)':'rgba(10,18,28,.9)';ctx.fill();
  ctx.lineWidth=2.5;ctx.strokeStyle=col;ctx.stroke();
  if(isRuin){
    ctx.strokeStyle='rgba(150,150,150,.8)';ctx.lineWidth=2;
    ctx.beginPath();ctx.moveTo(-t.r,t.r);ctx.lineTo(t.r,-t.r);ctx.moveTo(-t.r,-t.r);ctx.lineTo(t.r,t.r);ctx.stroke();
  } else {
    ctx.beginPath();ctx.arc(0,0,t.r*.62,0,6.284);
    const inner = t.type==='bunker'?'#2e4a3a':(t.type==='watchtower'?'#3a4a30':'#2a4a6e');
    ctx.fillStyle=t.owner==='atk'?'#4a2a1a':(t.owner==='def'?inner:'#3a3a3a');ctx.fill();
    ctx.strokeStyle=col;ctx.lineWidth=1.5;ctx.stroke();
    if(t.type==='bunker'){
      for(let i=0;i<4;i++){const a=i*Math.PI/2;ctx.beginPath();ctx.moveTo(Math.cos(a)*(t.r*0.3),Math.sin(a)*(t.r*0.3));ctx.lineTo(Math.cos(a)*(t.r+5),Math.sin(a)*(t.r+5));ctx.strokeStyle=col;ctx.lineWidth=2.5;ctx.stroke();}
    }else if(t.type==='watchtower'){
      ctx.beginPath();
      ctx.moveTo(0,-t.r-4);
      ctx.lineTo(t.r*0.7,t.r*0.5);
      ctx.lineTo(-t.r*0.7,t.r*0.5);
      ctx.closePath();
      ctx.strokeStyle=col;ctx.lineWidth=2;ctx.stroke();
      ctx.beginPath();ctx.moveTo(0,-t.r-4);ctx.lineTo(0,t.r*0.5);ctx.stroke();
    }else{
      ctx.beginPath();ctx.moveTo(0,0);
      const a=(t.type==='fort')?-Math.PI/2:(-Math.PI/2+.5);
      ctx.lineTo(Math.cos(a)*(t.r+9),Math.sin(a)*(t.r+9));
      ctx.strokeStyle=col;ctx.lineWidth=3.5;ctx.lineCap='round';ctx.stroke();
    }
  }
  ctx.restore();
  if(showHp && !isRuin){
    const hw=26;
    ctx.fillStyle='rgba(0,0,0,.65)';
    ctx.fillRect(t.x-hw/2,t.y-t.r-11,hw,4);
    ctx.fillStyle=col;
    ctx.fillRect(t.x-hw/2,t.y-t.r-11,hw*(t.hp/t.maxHp),4);
  }
}
function drawUnit(g, unit) {
  const type = UNITS[unit.type];
  const scale = 1 / g.cam.zoom;
  const halfWidth = Math.max(type.r + 2, 9 * scale);
  const halfHeight = halfWidth * 0.66;
  const color = TEAM_COLORS[unit.side];
  ctx.save();
  ctx.translate(unit.x, unit.y);

  ctx.fillStyle = 'rgba(7,15,11,.52)';
  ctx.fillRect(-halfWidth + 2, -halfHeight + 3, halfWidth * 2, halfHeight * 2);
  ctx.fillStyle = inConcealment(g, unit.x, unit.y) ? '#1b2720' : '#19211b';
  ctx.fillRect(-halfWidth, -halfHeight, halfWidth * 2, halfHeight * 2);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5 * scale;
  ctx.strokeRect(-halfWidth, -halfHeight, halfWidth * 2, halfHeight * 2);
  const x = halfWidth * 0.52;
  const y = halfHeight * 0.56;
  ctx.beginPath();
  switch (unit.type) {
    case 'inf':
      ctx.moveTo(-x, -y); ctx.lineTo(x, y);
      ctx.moveTo(x, -y); ctx.lineTo(-x, y);
      ctx.stroke();
      break;
    case 'scout':
      ctx.moveTo(-x, y); ctx.lineTo(x, -y);
      ctx.stroke();
      break;
    case 'eng':
      ctx.moveTo(-x, y); ctx.lineTo(0, -y); ctx.lineTo(x, y);
      ctx.stroke();
      break;
    case 'arm':
      ctx.ellipse(0, 0, x, y * 0.8, 0, 0, Math.PI * 2);
      ctx.stroke();
      break;
    case 'art':
      ctx.arc(0, 0, Math.max(2 * scale, y * 0.65), 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      break;
  }
  if (unit.order?.type === 'move' || unit._engaged) {
    const length = halfWidth + 4 * scale;
    const tipX = Math.cos(unit.facing) * length;
    const tipY = Math.sin(unit.facing) * length;
    ctx.beginPath();
    ctx.moveTo(tipX * 0.82, tipY * 0.82);
    ctx.lineTo(tipX, tipY);
    ctx.stroke();
  }
  if (unit.hp < unit.maxHp) {
    ctx.fillStyle = '#25241e';
    ctx.fillRect(-halfWidth, -halfHeight - 5 * scale, halfWidth * 2, 3 * scale);
    const health = clamp(unit.hp / unit.maxHp, 0, 1);
    ctx.fillStyle = health > 0.55 ? '#98cb8a' : (health > 0.25 ? '#e6c177' : '#ef8b72');
    ctx.fillRect(-halfWidth, -halfHeight - 5 * scale, halfWidth * 2 * health, 3 * scale);
  }
  if (g.frontline && unit.side === g.playerSide) {
    if (unit.supply < 0.65) {
      ctx.fillStyle = '#161a13';
      ctx.fillRect(-halfWidth, halfHeight + 2 * scale, halfWidth * 2, 3 * scale);
      ctx.fillStyle = '#c4d89e';
      ctx.fillRect(-halfWidth, halfHeight + 2 * scale, halfWidth * 2 * unit.supply, 3 * scale);
    }
    if (unit.suppression >= 0.32) {
      ctx.fillStyle = '#edb667';
      ctx.fillRect(halfWidth + 2 * scale, -halfHeight, 2 * scale, halfHeight * 2 * unit.suppression);
    }
  }
  if (g._marchUnits.has(unit.id) || unit.holdPost) {
    ctx.fillStyle = g._marchUnits.has(unit.id) ? '#edc37b' : color;
    ctx.fillRect(-1.6 * scale, halfHeight + 7 * scale, 3.2 * scale, 2 * scale);
  }
  ctx.restore();
}

function drawEffects(g){
  for(const e of g.effects){
    const a = clamp(e.life / e.max, 0, 1);
    const x = e.x ?? e.x1;
    const y = e.y ?? e.y1;
    if (!onCamera(g, x, y, e.r || 165)) continue;
    if (e.side !== g.playerSide && !visible(g, g.playerSide, x, y) &&
        !(e.type === 'tracer' && visible(g, g.playerSide, e.x2, e.y2))) continue;
    if(e.type==='tracer'){
      const gradient = ctx.createLinearGradient(e.x1, e.y1, e.x2, e.y2);
      gradient.addColorStop(0, '#fff4c7');
      gradient.addColorStop(0.26, e.col);
      gradient.addColorStop(1, 'transparent');
      ctx.strokeStyle=gradient;ctx.globalAlpha=a*.9;ctx.lineWidth=1.9;
      ctx.beginPath();ctx.moveTo(e.x1,e.y1);ctx.lineTo(e.x2,e.y2);ctx.stroke();
      ctx.fillStyle = '#fff2bb';
      ctx.beginPath();ctx.arc(e.x1,e.y1,2.8 + a * 2.2,0,Math.PI * 2);ctx.fill();
      ctx.globalAlpha=1;
    }else if(e.type==='boom'){
      const r=e.r*(1.15-a*.85);
      const gr=ctx.createRadialGradient(e.x,e.y,0,e.x,e.y,r);
      gr.addColorStop(0,'rgba(255,240,180,'+(a*.9)+')');
      gr.addColorStop(.4,'rgba(255,150,60,'+(a*.7)+')');
      gr.addColorStop(1,'rgba(255,80,30,0)');
      ctx.beginPath();ctx.arc(e.x,e.y,r,0,6.284);ctx.fillStyle=gr;ctx.fill();
      if (CFG.quality !== 'low') {
        ctx.globalAlpha = a * a * 0.75;
        ctx.fillStyle = '#ffca78';
        for (let i = 0; i < 6; i++) {
          const angle = hash2(i, e.x, e.y) * Math.PI * 2;
          const distance = e.r * (1 - a) * (0.5 + hash2(i, e.y, 37));
          ctx.fillRect(e.x + Math.cos(angle) * distance, e.y + Math.sin(angle) * distance, 2.4, 2.4);
        }
        ctx.globalAlpha = 1;
      }
    }else if(e.type==='ring'){
      ctx.beginPath();ctx.arc(e.x,e.y,e.r*(1.6-a*.6),0,6.284);
      ctx.strokeStyle=e.col;ctx.globalAlpha=a;ctx.lineWidth=2.5;ctx.stroke();ctx.globalAlpha=1;
    }else if(e.type==='recon'){
      ctx.beginPath();ctx.arc(e.x,e.y,e.r,0,6.284);
      ctx.strokeStyle='rgba(127,208,255,'+(a*.6)+')';ctx.lineWidth=2;
      ctx.setLineDash([10,8]);ctx.stroke();ctx.setLineDash([]);
      ctx.fillStyle='rgba(127,208,255,'+(a*.05)+')';ctx.fill();
    }else if(e.type==='target'){
      const rr=e.r*(1.4-a*.4);
      ctx.beginPath();ctx.arc(e.x,e.y,rr,0,6.284);
      ctx.strokeStyle='rgba(255,107,74,'+(a*.9)+')';ctx.lineWidth=2.5;
      ctx.setLineDash([12,7]);ctx.stroke();ctx.setLineDash([]);
    }else if(e.type==='cpreward'){
      ctx.font='bold 14px sans-serif';ctx.textAlign='center';
      ctx.fillStyle='rgba(255,206,107,'+a+')';
      ctx.fillText(e.text,e.x,e.y-30*(1-a));
    }
  }
}
