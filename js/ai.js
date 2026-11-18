"use strict";

/* ============ AI ============ */
function updateAI(g, dt) {
  if (!g.mp) aiTick(g, dt, g.aiSide);
  else if (Net.role === 'host' && !Net.playerList.some(player => player.side === g.aiSide)) {
    aiTick(g, dt, g.aiSide);
  }
}

function aiTick(g, dt, ai) {
  const cfg = DIFFS[g.cfg.diff];
  g.ai.wave -= dt;
  if (g.ai.wave <= 0) {
    g.ai.wave = 8 + Math.random() * 6;
    if (Math.random() < cfg.skill) aiTrySkill(g, ai);
  }
  if ((g.tick + (ai === 'def' ? 17 : 0)) % 45 === 0) {
    const units = g.units.filter(unit => unit.side === ai && unit.alive);
    if (g.frontline) {
      const returning = units.filter(unit => !readyToResume(g, unit)).length;
      const empty = units.filter(unit => !unit._resupplying && unit.supply < 0.22 && !unit._engaged)
        .slice(0, Math.max(0, Math.floor(units.length / 4) - returning));
      resupplyUnits(g, empty);
    }
    const event = g.battlefieldEvent;
    const danger = g.eventArea || (event?.phase === 'warning' ? battlefieldEventArea(event, g.time) : null);
    const ready = units.filter(unit => !unit._resupplying && !retreatFromEvent(g, unit, danger));
    if (ai === 'atk') aiAtkCommand(g, ready);
    else aiDefCommand(g, ready);
  }
  g.ai.timer -= dt;
  if (g.ai.timer > 0) return;
  g.ai.timer = cfg.interval;
  const myUnits = g.units.filter(unit => unit.side === ai && unit.alive);
  const deploying = g.deploying.filter(deployment => deployment.side === ai).length;
  if (myUnits.length + deploying >= UNIT_CAP[ai]) return;
  const spawns = getSpawnPoints(g, ai).filter(point =>
    eventDamageAt(g.eventArea, point.x, point.y, terrainAt(g, point.x, point.y)) === 0);
  if (!spawns.length) return;
  let type='inf';
  const cp=g.cp[ai];
  const counts={inf:0,scout:0,eng:0,arm:0,art:0};
  for(const u of myUnits)counts[u.type]++;
  const total=myUnits.length||1;
  const r=Math.random();
  if(ai==='atk'){
    if(counts.art<Math.max(2,Math.floor(total*0.08)) && cp>=32 && r<0.18)type='art';
    else if(counts.arm<Math.max(3,Math.floor(total*0.18)) && cp>=30 && r<0.5)type='arm';
    else if(counts.scout<2 && cp>=6 && r<0.65)type='scout';
    else if(counts.eng<2 && cp>=10 && r<0.78)type='eng';
    else if(cp>=8)type='inf';
    else return;
  } else {
    if(counts.eng<2 && cp>=10)type='eng';
    else if(counts.scout<2 && cp>=6 && r<0.5)type='scout';
    else if(counts.arm<2 && cp>=30 && r<0.65)type='arm';
    else if(counts.art<2 && cp>=32 && r<0.8)type='art';
    else if(cp>=8)type='inf';
    else return;
  }
  const start = Math.floor(Math.random() * spawns.length);
  for (let i = 0; i < spawns.length; i++) {
    const spawn = spawns[(start + i) % spawns.length];
    let x = spawn.x + rnd(-42, 42);
    let y = spawn.y + rnd(-42, 42);
    if (!canWalk(g, x, y, type)) { x = spawn.x; y = spawn.y; }
    if (startDeploy(g, ai, type, x, y)) break;
  }
}
function retreatFromEvent(g, unit, area) {
  if (unit.order?.eventRetreat && area?.profile.dps) return true;
  if (!eventDamageAt(area, unit.x, unit.y, terrainAt(g, unit.x, unit.y))) return false;
  const outward = Math.atan2(unit.y - area.y, unit.x - area.x);
  const radius = area.r * area.profile.core + CELL * 1.4;
  for (const turn of [0, .55, -.55, 1.1, -1.1, 1.8, -1.8, Math.PI]) {
    const x = area.x + Math.cos(outward + turn) * radius;
    const y = area.y + Math.sin(outward + turn) * radius;
    if (!canWalk(g, x, y, unit.type) || (unit.side === 'def' && isDefForbiddenArea(g, x, y))) continue;
    unit.order = { type: 'move', x, y, eventRetreat: true };
    unit.path = null;
    unit.pathI = 0;
    unit.holdPost = 0;
    unit.tid = 0;
    return true;
  }
  return false;
}

function aiAtkCommand(g, units){
  if(units.length===0)return;
  const enemyPosts=g.posts.filter(p=>p.owner!=='atk'&&!p._disabled);
  if(enemyPosts.length===0)return;
  if(!g._aiState) g._aiState={};
  if(!g._aiState.atk) g._aiState.atk={phase:'gather',phaseSince:g.time,gatherX:null,gatherY:null,targetId:null,waveUnits:new Set(),wave:1};
  const ast=g._aiState.atk;
  const elapsed=g.time-ast.phaseSince;
  const waveMul = 1 + (g._waveCount.atk||0)*0.3;
  const WAVE_SIZE=Math.round(15*waveMul);
  const GATHER_MAX=30, ADVANCE_MAX=45, ENGAGE_MAX=90;
  if(ast.gatherX===null){
    const own=g.posts.filter(p=>p.owner==='atk').concat([{x:g.spawnPoint.x,y:g.spawnPoint.y,type:'spawn'}]);
    let best=null,bestScore=-Infinity;
    for(const p of own){
      let minD=Infinity;
      for(const ep of enemyPosts)minD=Math.min(minD,dist(p.x,p.y,ep.x,ep.y));
      const score=minD - Math.abs(minD-650)*0.35;
      if(score>bestScore){bestScore=score;best=p;}
    }
    ast.gatherX=best?best.x:g.spawnPoint.x;
    ast.gatherY=best?best.y:g.spawnPoint.y;
  }
  if(ast.phase==='gather'){
    if(units.length>=WAVE_SIZE || elapsed>GATHER_MAX){
      ast.phase='advance'; ast.phaseSince=g.time;
      ast.waveUnits=new Set(units.map(u=>u.id));
      const scored=enemyPosts.map(p=>{
        let s=0;
        if(p.type==='hq')s+=8;
        if(p.cap>0&&p.cap<POST_TYPES[p.type].cap)s+=4;
        let defN=0;
        for(const e of g.units)if(e.side==='def'&&e.alive&&visible(g,'atk',e.x,e.y)&&dist(e.x,e.y,p.x,p.y)<280)defN++;
        let turN=0;
        for(const tt of g.turrets)if(tt.owner==='def'&&!tt.ruin&&tt.discovered&&dist(tt.x,tt.y,p.x,p.y)<260)turN++;
        s-=defN*2+turN*3;
        s-=dist(ast.gatherX,ast.gatherY,p.x,p.y)/220;
        return {p,s};
      }).sort((a,b)=>b.s-a.s);
      ast.targetId=scored[0].p.id;
      return;
    }
    const cols=Math.ceil(Math.sqrt(units.length));
    for(let i=0;i<units.length;i++){
      const u=units[i];
      if(dist(u.x,u.y,ast.gatherX,ast.gatherY)<180)continue;
      const cx=(i%cols)-(cols-1)/2;
      const cy=Math.floor(i/cols)-((Math.ceil(units.length/cols))-1)/2;
      const tx=ast.gatherX+cx*60;
      const ty=ast.gatherY+cy*60;
      if(u.order&&u.order.type==='move'&&dist(u.order.x,u.order.y,tx,ty)<90)continue;
      u.order={type:'move',x:tx,y:ty};
      u.path=null;u.pathI=0;u.holdPost=0;u.tid=0;
    }
    return;
  }
  if(ast.phase==='advance'){
    const target=enemyPosts.find(p=>p.id===ast.targetId)||enemyPosts[0];
    if(!target||elapsed>ADVANCE_MAX){ast.phase='engage';ast.phaseSince=g.time;return;}
    const arr=units.filter(u=>ast.waveUnits.has(u.id));
    let minDistToTarget=Infinity,pioneer=null;
    for(const u of arr){
      const dd=dist(u.x,u.y,target.x,target.y);
      if(dd<minDistToTarget){minDistToTarget=dd;pioneer=u;}
    }
    const maxLeadDist=200;
    const scouts=arr.filter(u=>u.type==='scout');
    const hasScout=scouts.length>0;
    let flankSide=1;
    if(hasScout){
      const leftTurrets=g.turrets.filter(t=>t.owner==='def'&&!t.ruin&&dist(t.x,t.y,target.x-200,target.y)<200).length;
      const rightTurrets=g.turrets.filter(t=>t.owner==='def'&&!t.ruin&&dist(t.x,t.y,target.x+200,target.y)<200).length;
      flankSide = leftTurrets<=rightTurrets ? 1 : -1;
    }
    const assign=(list,offsetR,mode,forcedSide)=>{
      for(let i=0;i<list.length;i++){
        const u=list[i];
        const side=forcedSide||((i%2===0)?1:-1);
        let nx=target.x+side*offsetR+rnd(-30,30);
        let ny=target.y+side*offsetR*0.7+rnd(-30,30);
        if(pioneer && u!==pioneer){
          const pioneerDist=dist(pioneer.x,pioneer.y,target.x,target.y);
          const myDist=dist(u.x,u.y,target.x,target.y);
          if(pioneerDist - myDist > maxLeadDist){
            if(!u.order || u.order.type!=='hold'){
              u.order={type:'move',x:u.x,y:u.y};
              u.path=null;u.pathI=0;
            }
            continue;
          }
        }
        if(u.order&&u.order.type==='move'&&dist(u.order.x,u.order.y,nx,ny)<70)continue;
        u.order={type:'move',x:nx,y:ny};
        u.path=null;u.pathI=0;u.holdPost=0;
        if(mode==='attack')u.tid=0;
      }
    };
    assign(scouts,180*flankSide,'move');
    assign(arr.filter(u=>u.type==='art'),220,'move');
    assign(arr.filter(u=>u.type==='arm'),40,'attack');
    assign(arr.filter(u=>u.type==='eng'),70,'move');
    assign(arr.filter(u=>u.type==='inf'),120,'move',hasScout?flankSide:0);
    let nearCount=0;
    for(const u of arr)if(dist(u.x,u.y,target.x,target.y)<240)nearCount++;
    if(arr.length>0 && nearCount/arr.length>0.6){ast.phase='engage';ast.phaseSince=g.time;}
    return;
  }
  if(ast.phase==='engage'){
    const arr=units.filter(u=>ast.waveUnits.has(u.id));
    if(arr.length < ast.waveUnits.size*0.4 || elapsed>ENGAGE_MAX){
      g._waveCount.atk=(g._waveCount.atk||0)+1;
      ast.phase='gather'; ast.phaseSince=g.time;
      ast.gatherX=null; ast.gatherY=null;
      ast.waveUnits=new Set();
      ast.wave=1+(g._waveCount.atk||0);
      for(const u of units){
        if(u.order&&u.order.type==='move')continue;
        u.order={type:'move',x:g.spawnPoint.x+rnd(-120,120),y:g.spawnPoint.y+rnd(-120,120)};
        u.path=null;u.pathI=0;u.holdPost=0;
      }
      return;
    }
    const target=enemyPosts.find(p=>p.id===ast.targetId)||enemyPosts[0];
    const hostileTurrets=g.turrets.filter(t=>t.owner==='def'&&!t.ruin);
    let focusTurret=null;
    for(const t of hostileTurrets){
      let attacked=false;
      for(const u of arr){
        if(dist(u.x,u.y,t.x,t.y)<t.r+UNITS[u.type].r+30){attacked=true;break;}
      }
      if(attacked){focusTurret=t;break;}
    }
    if(focusTurret){
      for(const u of arr){
        if(u.type==='scout')continue;
        u.tid=focusTurret.id;
        u.holdPost=0;
      }
      return;
    }
    for(const u of arr){
      if(u.type==='scout')continue;
      if(!u.tid){
        let best=null,bd=Infinity;
        for(const e of g.units){
          if(e.side===u.side||!e.alive||!visible(g,u.side,e.x,e.y))continue;
          const dd=dist(u.x,u.y,e.x,e.y);
          if(dd<320&&dd<bd){bd=dd;best=e;}
        }
        if(best)u.tid=best.id;
        else if(target && !u.order){
          u.order={type:'move',x:target.x+rnd(-80,80),y:target.y+rnd(-80,80)};
          u.path=null;u.pathI=0;
        }
      }
    }
    return;
  }
}
function aiDefCommand(g, units){
  if(units.length===0)return;
  if(!g._aiState) g._aiState={};
  if(!g._aiState.def) g._aiState.def={lastPush:0,lastTrench:0};
  const myPosts=g.posts.filter(p=>p.owner==='def'&&!p._disabled);
  if(myPosts.length===0)return;
  const threat=myPosts.map(p=>{
    let eN=0;
    for(const e of g.units){
      if(e.side!=='atk'||!e.alive||!visible(g,'def',e.x,e.y))continue;
      if(dist(e.x,e.y,p.x,p.y)<320)eN++;
    }
    return {p,eN};
  });
  const hq=myPosts.find(p=>p.type==='hq');
  const hqX=hq?hq.x:g.spawnPoint.x;
  const hqY=hq?hq.y:g.spawnPoint.y;
  const needGarrison={};
  for(const p of myPosts) needGarrison[p.id]=(p.type==='hq'?4:(p.type==='branch'?2:1));
  const garrisonCount={};
  for(const p of myPosts)garrisonCount[p.id]=0;
  for(const u of units){
    if(u._defRole==='garrison'&&u._defPostId!==undefined){
      const p=myPosts.find(pp=>pp.id===u._defPostId);
      if(p && garrisonCount[p.id]<needGarrison[p.id] && dist(u.x,u.y,p.x,p.y)<260){
        garrisonCount[p.id]++;
        continue;
      }
      u._defRole=null;u._defPostId=undefined;
    }
  }
  const unassigned=units.filter(u=>!u._defRole);
  for(const p of myPosts){
    while(garrisonCount[p.id]<needGarrison[p.id] && unassigned.length>0){
      let best=null,bestI=-1,bd=Infinity;
      for(let i=0;i<unassigned.length;i++){
        const u=unassigned[i];
        if(u.type==='art')continue;
        const dd=dist(u.x,u.y,p.x,p.y);
        if(dd<bd){bd=dd;best=u;bestI=i;}
      }
      if(!best)break;
      best._defRole='garrison';
      best._defPostId=p.id;
      garrisonCount[p.id]++;
      unassigned.splice(bestI,1);
    }
  }
  for(const u of unassigned){
    if(u.type==='arm')u._defRole='reserve';
    else if(u.type==='art')u._defRole='artillery';
    else if(u.type==='eng')u._defRole='repair';
    else u._defRole='patrol';
  }
  const atkAll=g.units.filter(u=>u.side==='atk'&&u.alive);
  const globalAdv = units.length > atkAll.length*1.4 && units.length>=5;
  const sortedThreat=threat.slice().sort((a,b)=>b.eN-a.eN);
  const worst=sortedThreat[0];
  for(const u of units){
    if(u.type!=='eng')continue;
    let nearT=null,nd=Infinity;
    for(const t of g.turrets){
      if(t.owner!=='def')continue;
      if(t.hp>=t.maxHp)continue;
      const dd=dist(u.x,u.y,t.x,t.y);
      if(dd<300&&dd<nd){nd=dd;nearT=t;}
    }
    if(nearT && dist(u.x,u.y,nearT.x,nearT.y)>40){
      u._defRole='repair';
      if(!u.order || u.order.type!=='move' || dist(u.order.x,u.order.y,nearT.x,nearT.y)>50){
        u.order={type:'move',x:nearT.x+rnd(-40,40),y:nearT.y+rnd(-40,40)};
        u.path=null;u.pathI=0;u.holdPost=0;
      }
    }
  }
  for(const u of units){
    if(!u.alive)continue;
    const role=u._defRole||'patrol';
    if(role==='garrison'){
      const p=myPosts.find(pp=>pp.id===u._defPostId);
      if(!p){u._defRole=null;continue;}
      let ex=0,ey=0,eN=0;
      for(const e of g.units){
        if(e.side!=='atk'||!e.alive||!visible(g,'def',e.x,e.y))continue;
        if(dist(e.x,e.y,p.x,p.y)<200){ex+=e.x;ey+=e.y;eN++;}
      }
      if(eN>0){
        ex/=eN;ey/=eN;
        const ang=Math.atan2(ey-p.y,ex-p.x);
        const tx=p.x+Math.cos(ang)*70;
        const ty=p.y+Math.sin(ang)*70;
        if(dist(u.x,u.y,tx,ty)>35){
          if(!u.order||u.order.type!=='move'||dist(u.order.x,u.order.y,tx,ty)>50){
            u.order={type:'move',x:tx,y:ty};u.path=null;u.pathI=0;u.holdPost=1;
          }
        }
      }else{
        if(dist(u.x,u.y,p.x,p.y)>110){
          const a=Math.random()*6.283;
          u.order={type:'move',x:p.x+Math.cos(a)*60,y:p.y+Math.sin(a)*60};
          u.path=null;u.pathI=0;u.holdPost=1;
        }
      }
    } else if(role==='repair'){
      let nearT=null,nd=Infinity;
      for(const t of g.turrets){
        if(t.owner!=='def')continue;
        if(t.hp>=t.maxHp)continue;
        const dd=dist(u.x,u.y,t.x,t.y);
        if(dd<400&&dd<nd){nd=dd;nearT=t;}
      }
      if(!nearT){
        u._defRole='patrol';
      }else if(dist(u.x,u.y,nearT.x,nearT.y)<50){
        if(u.order&&u.order.type==='move'){u.order=null;u.path=null;}
      }
    } else if(role==='reserve'){
      let target=null;
      for(const t of sortedThreat){if(t.eN>0){target=t.p;break;}}
      if(target){
        const localAdv = target.eN < garrisonCount[target.id]*0.7 + 1;
        if(globalAdv || localAdv){
          if(!u.tid){
            let best=null,bd=Infinity;
            for(const e of g.units){
              if(e.side!=='atk'||!e.alive||!visible(g,'def',e.x,e.y))continue;
              if(dist(e.x,e.y,target.x,target.y)>420)continue;
              const dd=dist(u.x,u.y,e.x,e.y);
              if(dd<bd){bd=dd;best=e;}
            }
            if(best)u.tid=best.id;
          }
          u.holdPost=0;
          if(u.order&&u.order.type==='move'){u.order=null;u.path=null;}
        }else{
          const tx=target.x+rnd(-50,50),ty=target.y+rnd(-50,50);
          if(dist(u.x,u.y,tx,ty)>50){
            u.order={type:'move',x:tx,y:ty};u.path=null;u.pathI=0;u.holdPost=1;u.tid=0;
          }
        }
      }else{
        if(dist(u.x,u.y,hqX,hqY)>260){
          if(!u.order||u.order.type!=='move'){
            const a=Math.random()*6.283;
            u.order={type:'move',x:hqX+Math.cos(a)*120,y:hqY+Math.sin(a)*120};
            u.path=null;u.pathI=0;u.holdPost=1;
          }
        }
      }
    } else if(role==='artillery'){
      if(worst.eN>0){
        const p=worst.p;
        const ang=Math.atan2(p.y-hqY,p.x-hqX);
        const tx=p.x-Math.cos(ang)*200;
        const ty=p.y-Math.sin(ang)*200;
        if(dist(u.x,u.y,tx,ty)>90){
          if(!u.order||u.order.type!=='move'||dist(u.order.x,u.order.y,tx,ty)>70){
            u.order={type:'move',x:tx+rnd(-40,40),y:ty+rnd(-40,40)};
            u.path=null;u.pathI=0;u.holdPost=1;
          }
        }else if(u.order&&u.order.type==='move'){u.order=null;u.path=null;}
      }else{
        if(dist(u.x,u.y,hqX,hqY)>260){
          const a=Math.random()*6.283;
          if(!u.order||u.order.type!=='move'){
            u.order={type:'move',x:hqX+Math.cos(a)*160,y:hqY+Math.sin(a)*160};
            u.path=null;u.pathI=0;u.holdPost=1;
          }
        }else if(u.order&&u.order.type==='move'){u.order=null;u.path=null;}
      }
    } else {
      if(globalAdv){
        const ePosts=g.posts.filter(p=>p.owner!=='def');
        let best=null,bd=Infinity;
        for(const ep of ePosts){
          const dd=dist(u.x,u.y,ep.x,ep.y);
          if(dd<bd){bd=dd;best=ep;}
        }
        if(best && dist(u.x,u.y,best.x,best.y)>260){
          if(!u.order||u.order.type!=='move'||dist(u.order.x,u.order.y,best.x,best.y)>220){
            u.order={type:'move',x:best.x+rnd(-70,70),y:best.y+rnd(-70,70)};
            u.path=null;u.pathI=0;u.holdPost=0;
          }
        }
      }else{
        let nearestEnemy=null,ne=Infinity;
        for(const e of g.units){
          if(e.side!=='atk'||!e.alive||!visible(g,'def',e.x,e.y))continue;
          const dd=dist(u.x,u.y,e.x,e.y);
          if(dd<ne){ne=dd;nearestEnemy=e;}
        }
        let ambushPt=null;
        if(nearestEnemy){
          let nearPost=null,npd=Infinity;
          for(const p of myPosts){const dd=dist(p.x,p.y,nearestEnemy.x,nearestEnemy.y);if(dd<npd){npd=dd;nearPost=p;}}
          if(nearPost){ambushPt={x:(nearPost.x+nearestEnemy.x)/2, y:(nearPost.y+nearestEnemy.y)/2};}
        }
        if(!ambushPt){
          let near=null,nd=Infinity;
          for(const p of myPosts){const dd=dist(u.x,u.y,p.x,p.y);if(dd<nd){nd=dd;near=p;}}
          if(near){
            const a=Math.random()*6.283,r=80+Math.random()*120;
            ambushPt={x:near.x+Math.cos(a)*r,y:near.y+Math.sin(a)*r};
          }
        }
        if(ambushPt){
          if(dist(u.x,u.y,ambushPt.x,ambushPt.y)>50){
            if(!u.order||u.order.type!=='move'||dist(u.order.x,u.order.y,ambushPt.x,ambushPt.y)>70){
              u.order={type:'move',x:ambushPt.x,y:ambushPt.y};
              u.path=null;u.pathI=0;u.holdPost=1;
            }
          }
        }
      }
    }
  }
}
function aiTrySkill(g,ai){
  const cfg=DIFFS[g.cfg.diff];
  if (Math.random() < cfg.skill * 0.8 && useSkill(g, ai, 'emergency', 0, 0)) return;
  if (g.frontline) {
    const pinned = g.units.find(unit => unit.alive && unit.side === ai &&
      unit.suppression >= 0.58 && !crossesSmoke(g, unit.x - 32, unit.y, unit.x + 32, unit.y));
    if (pinned && useSkill(g, ai, 'smoke', pinned.x, pinned.y)) return;
  }
  const enemies = g.units.filter(unit => unit.side !== ai && unit.alive && visible(g, ai, unit.x, unit.y));
  if(enemies.length<3)return;
  let best=null,bestN=0;
  for(const e of enemies){let n=0;for(const o of enemies)if(dist2(e.x,e.y,o.x,o.y)<110*110)n++;if(n>bestN){bestN=n;best=e;}}
  if(!best||bestN<3)return;
  for(const k of ['barrage','airstrike']){
    if(g.cp[ai]>=SKILLS[k].cost&&!(g.cd[ai][k]>0)){if(Math.random()<.55){if(useSkill(g,ai,k,best.x+rnd(-20,20),best.y+rnd(-20,20)))return;}}
  }
  if(g.cp[ai]>=SKILLS.recon.cost&&!(g.cd[ai].recon>0))useSkill(g,ai,'recon',best.x,best.y);
}
