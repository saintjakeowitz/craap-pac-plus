(function(){
  'use strict';
  const errBar = document.getElementById('err');
  window.addEventListener('error', e => { if(!errBar) return; errBar.style.display='block'; errBar.textContent='Game script error: '+e.message; });

  function ready(fn){ if(document.readyState!=='loading'){ fn(); } else { document.addEventListener('DOMContentLoaded', fn); } }
  ready(init);

  function init(){
    const $=(s,r=document)=>r.querySelector(s), $$=(s,r=document)=>Array.from(r.querySelectorAll(s));

    const canvas=$('#game'), ctx=canvas.getContext('2d'), stage=$('#stage');
    const btnStart=$('#btnStart'), btnHelp=$('#btnHelp'), btnMute=$('#btnMute');
    const toast=$('#toast'), hsList=$('#highscores');
    const bPlanes=$('#bPlanes strong'), bBonus=$('#bBonus strong'), bLives=$('#bLives strong'), bLevel=$('#bLevel strong');
    const rangeRobots=$('#robotCount'), robotCountVal=$('#robotCountVal');
    const rangeSpeed=$('#speed'), speedVal=$('#speedVal');
    const chkRoam=$('#aiRoam');

    // Force stage size to avoid aspect-ratio CSS dependency
    function forceStageSize(){
      const w = stage.clientWidth || (stage.parentElement ? stage.parentElement.clientWidth : 960);
      const h = Math.round(w * 9 / 16);
      stage.style.height = h + 'px';
      canvas.width = Math.floor(w);
      canvas.height = Math.floor(h);
    }
    window.addEventListener('resize', forceStageSize);
    window.addEventListener('load', forceStageSize);
    setTimeout(forceStageSize, 0);

    // Settings defaults
    const settings={ robots: parseInt(rangeRobots.value,10)||7, roam:true, step: parseInt(rangeSpeed.value,10)||120 };
    robotCountVal.textContent=String(settings.robots);
    speedVal.textContent=settings.step+' ms';

    rangeRobots.addEventListener('input', ()=>{ settings.robots=parseInt(rangeRobots.value,10); robotCountVal.textContent=String(settings.robots); });
    rangeSpeed.addEventListener('input', ()=>{ settings.step=parseInt(rangeSpeed.value,10); speedVal.textContent=settings.step+' ms'; });
    chkRoam.addEventListener('change', ()=>{ settings.roam=chkRoam.checked; });

    // Audio (defer until Start click to avoid autoplay policy issues)
    let audioCtx=null, mute=false, audioReady=false;
    function ensureAudio(){ if(audioReady) return; try{ audioCtx=new (window.AudioContext||window.webkitAudioContext)(); audioReady=true; }catch(e){ /* ignore */ } }
    function tone(f=440,d=.1,type='sine',g=.06){ if(mute||!audioReady||!audioCtx) return; const o=audioCtx.createOscillator(), gain=audioCtx.createGain(); o.type=type; o.frequency.value=f; gain.gain.value=g; o.connect(gain).connect(audioCtx.destination); o.start(); o.stop(audioCtx.currentTime+d); }
    const SFX={ pellet(){tone(1200,.06,'triangle',.05)}, bonus(){tone(880,.08,'sine',.05); setTimeout(()=>tone(1320,.08,'triangle',.05),80)}, death(){tone(200,.25,'sawtooth',.09); setTimeout(()=>tone(120,.3,'sawtooth',.09),220)}, win(){[523,659,784,1047].forEach((f,i)=>setTimeout(()=>tone(f,.14,'triangle',.06),i*140))} };
    btnMute.addEventListener('click', ()=>{ mute=!mute; btnMute.textContent='Sound: '+(mute?'Off':'On'); btnMute.setAttribute('aria-pressed', String(!mute)); });

    // RNG
    const R=Math.random; const RI=n=>Math.floor(R()*n);
    function shuffle(a){ for(let i=a.length-1;i>0;i--){ const j=RI(i+1); [a[i],a[j]]=[a[j],a[i]]; } return a; }

    // State
    const state={ grid:[], cols:33, rows:25, tile:24, wrap:true,
      player:{x:1,y:1,dir:[1,0],turnDir:[1,0],turnBuffer:0},
      robots:[], pellets:new Set(), planes:0, bonus:0, level:1, lives:3,
      running:false, quiz:false, explosion:null, effects:{invuln:0} };

    // Build Grid
    function buildGrid(cols, rows){
      const W=1,P=0;
      const g=Array.from({length:rows},()=>Array(cols).fill(W));
      for(let y=1;y<rows-1;y+=2){ for(let x=1;x<cols-1;x++){ g[y][x]=P; } }
      for(let x=2;x<cols-2;x+=3){ for(let y=1;y<rows-1;y++){ if(y%2){ g[y-1][x]=P; g[y+1][x]=P; } } }
      for(let x=3;x<cols-3;x+=2){ if(R()<0.55){ for(let y=1;y<rows-1;y++){ g[y][x]=P; } } }
      const midY=Math.floor(rows/2), midX=Math.floor(cols/2);
      for(const y of [midY-2, midY, midY+2]){ g[y][1]=P; g[y][cols-2]=P; }
      for(const x of [midX-2, midX, midX+2]){ g[1][x]=P; g[rows-2][x]=P; }
      return g;
    }

    function resetLevel(){
      const w = stage.clientWidth, h = stage.clientHeight;
      if(!w || !h){ forceStageSize(); }
      const ideal = Math.floor(Math.min(canvas.width/26, canvas.height/26));
      state.cols = Math.max(25, (ideal*1.1|0)|1);
      state.rows = Math.max(19, (ideal*0.9|0)|1);
      state.grid = buildGrid(state.cols, state.rows);
      state.tile = Math.floor(Math.min(canvas.width/state.cols, canvas.height/state.rows));

      state.level=1; state.lives=3; state.bonus=0; state.planes=0;
      state.player.x=1; state.player.y=1; state.player.dir=[1,0]; state.player.turnDir=[1,0]; state.player.turnBuffer=0;
      state.effects.invuln = 12;

      state.pellets.clear();
      for(let y=1;y<state.rows-1;y++){ for(let x=1;x<state.cols-1;x++){ if(state.grid[y][x]===0) state.pellets.add(k(x,y)); } }

      spawnRobots(settings.robots);

      state.running=true; state.quiz=false; state.explosion=null;
      updateHUD();
    }

    function spawnRobots(count){
      const colorPool=['#22d3ee','#f472b6','#fb923c','#a3e635','#f59e0b','#06b6d4','#8b5cf6','#10b981'];
      state.robots.length=0;
      const spots=[ [state.cols-2,1], [1,state.rows-2], [state.cols-2,state.rows-2], [Math.floor(state.cols/2),1], [1,Math.floor(state.rows/2)], [state.cols-2,Math.floor(state.rows/2)], [Math.floor(state.cols/2),state.rows-2], [Math.floor(state.cols/2),Math.floor(state.rows/2)] ];
      for(let i=0;i<count;i++){
        const [sx,sy]=spots[i%spots.length];
        const color=colorPool[i%colorPool.length];
        const speed=0.11 + (i%4)*0.015;
        state.robots.push(makeRobot(color, sx, sy, speed, i));
      }
    }

    function makeRobot(color,x,y,speed,idx){
      const personalities=[
        {agg:0.7, rnd:0.2, scatter:50, chase:70, wander:170},
        {agg:0.6, rnd:0.25, scatter:40, chase:80, wander:160},
        {agg:0.5, rnd:0.3, scatter:60, chase:70, wander:190},
        {agg:0.8, rnd:0.15, scatter:45, chase:85, wander:150},
      ];
      const p=personalities[idx%personalities.length];
      return {x,y,color,dir:[-1,0],speed,accum:0, mode:'wander', timer: p.wander + RI(40), corner: cornerFor(idx), personality:p, lastDir:[-1,0]};
    }
    function cornerFor(i){
      const corners=[ [1,1], [state.cols-2,1], [1,state.rows-2], [state.cols-2,state.rows-2] ];
      return corners[i%corners.length];
    }
    function k(x,y){ return x+','+y; }
    function canMove(x,y){ if(state.wrap){ if(x<0) x=state.cols-1; if(x>=state.cols) x=0; if(y<0) y=state.rows-1; if(y>=state.rows) y=0; } return y>=0&&y<state.rows&&x>=0&&x<state.cols&&state.grid[y][x]===0; }
    function wrapCoord(x,y){ if(!state.wrap) return [x,y]; if(x<0) x=state.cols-1; if(x>=state.cols) x=0; if(y<0) y=state.rows-1; if(y>=state.rows) y=0; return [x,y]; }

    function parallax(){ const px=state.player.x/state.cols, py=state.player.y/state.rows; $$('.layer').forEach(el=>{ const depth=parseFloat(el.getAttribute('data-depth')||'0.1'); const dx=(px-0.5)*depth*80; const dy=(py-0.5)*depth*30; el.style.transform='translate('+dx+'px,'+dy+'px)'; }); }

    // Input
    window.addEventListener('keydown',(e)=>{
      if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight',' ','Spacebar','Space','w','a','s','d','W','A','S','D'].includes(e.key)) e.preventDefault();
      const p=state.player;
      if(e.key==='ArrowUp'||e.key==='w'||e.key==='W'){ p.turnDir=[0,-1]; p.turnBuffer=8; }
      if(e.key==='ArrowDown'||e.key==='s'||e.key==='S'){ p.turnDir=[0,1]; p.turnBuffer=8; }
      if(e.key==='ArrowLeft'||e.key==='a'||e.key==='A'){ p.turnDir=[-1,0]; p.turnBuffer=8; }
      if(e.key==='ArrowRight'||e.key==='d'||e.key==='D'){ p.turnDir=[1,0]; p.turnBuffer=8; }
    });

    // Movement & AI
    let last=0;
    function gameLoop(ts){ try{ if(!state.running){ requestAnimationFrame(gameLoop); return; } if(!last) last=ts; const dt=ts-last; if(dt>settings.step && !state.quiz){ last=ts; tick(); } draw(); requestAnimationFrame(gameLoop); }catch(err){ if(errBar){ errBar.style.display='block'; errBar.textContent='Loop error: '+err.message; } } }
    requestAnimationFrame(gameLoop);

    function tick(){ stepPlayer(); stepRobots(); parallax(); }

    function stepPlayer(){
      const p=state.player;
      if(p.turnBuffer>0 && canMove(p.x+p.turnDir[0], p.y+p.turnDir[1])){ p.dir=[p.turnDir[0],p.turnDir[1]]; p.turnBuffer=0; } else if(p.turnBuffer>0){ p.turnBuffer--; }
      let nx=p.x+p.dir[0], ny=p.y+p.dir[1]; [nx,ny]=wrapCoord(nx,ny);
      if(canMove(nx,ny)){ p.x=nx; p.y=ny; onEnter(nx,ny); }
      if(p.turnBuffer>0 && canMove(p.x+p.turnDir[0], p.y+p.turnDir[1])){ p.dir=[p.turnDir[0],p.turnDir[1]]; p.turnBuffer=0; } else if(p.turnBuffer>0){ p.turnBuffer--; }
    }

    function onEnter(x,y){
      const keyStr=k(x,y);
      if(state.pellets.has(keyStr)){ state.pellets.delete(keyStr); state.planes++; SFX.pellet(); showToast('+1 ✈️'); updateHUD(); checkWin(); }
      for(const r of state.robots){ if(r.x===x && r.y===y){ if(state.effects.invuln>0){ return; } triggerQuiz(); break; } }
    }

    function stepRobots(){
      for(const r of state.robots){
        r.timer--;
        if(r.timer<=0){
          if(!chkRoam.checked){ r.mode='chase'; r.timer=100+RI(60); }
          else{
            if(r.mode==='wander'){ r.mode='chase'; }
            else if(r.mode==='chase'){ r.mode = (Math.random()<0.25) ? 'scatter' : 'wander'; }
            else { r.mode='wander'; }
            const p=r.personality;
            r.timer = (r.mode==='scatter')? p.scatter + RI(25) : (r.mode==='wander'? p.wander + RI(60) : p.chase + RI(40));
          }
        }
        r.accum += r.speed;
        if(r.accum < 1) continue;
        r.accum = 0;
        const move = nextRobotMove(r);
        let nx=r.x+move[0], ny=r.y+move[1]; [nx,ny]=wrapCoord(nx,ny);
        if(canMove(nx,ny)){ r.x=nx; r.y=ny; r.lastDir=move; }
        if(r.x===state.player.x && r.y===state.player.y){
          if(state.effects.invuln>0){ } else { triggerQuiz(); }
        }
      }
      if(state.effects.invuln>0) state.effects.invuln--;
    }

    function nextRobotMove(r){
      const dirs=[[1,0],[-1,0],[0,1],[0,-1]];
      const options=dirs.filter(d=>canMove(r.x+d[0], r.y+d[1]));
      if(options.length===0) return [0,0];
      const notReverse = options.filter(d=>!(d[0]===-r.lastDir[0] && d[1]===-r.lastDir[1]));
      const opts = notReverse.length? notReverse : options;
      if(r.mode==='wander'){
        if(Math.random()<0.3){ const target = randomPellet(); if(target){ return greedyStepTowards(r.x,r.y,target[0],target[1],opts); } }
        return opts[RI(opts.length)];
      }
      if(r.mode==='scatter'){ const [tx,ty]=r.corner; return greedyStepTowards(r.x,r.y,tx,ty,opts); }
      if(Math.random()<0.25){ return opts[RI(opts.length)]; }
      const tx=state.player.x, ty=state.player.y;
      return greedyStepTowards(r.x,r.y,tx,ty,opts);
    }

    function greedyStepTowards(sx,sy,tx,ty,options){
      let best=options[0], bestd=Infinity;
      for(const d of options){ let nx=sx+d[0], ny=sy+d[1]; [nx,ny]=wrapCoord(nx,ny); const dd=manhattan(nx,ny,tx,ty); if(dd<bestd){ best=d; bestd=dd; } }
      return best;
    }
    function manhattan(ax,ay,bx,by){
      const dx=Math.min(Math.abs(ax-bx), state.cols - Math.abs(ax-bx));
      const dy=Math.min(Math.abs(ay-by), state.rows - Math.abs(ay-by));
      return dx+dy;
    }
    function randomPellet(){
      const n=state.pellets.size; if(n===0) return null;
      const idx = RI(n);
      let i=0; for(const s of state.pellets){ if(i++===idx){ const [x,y]=s.split(',').map(Number); return [x,y]; } }
      return null;
    }

    // Drawing
    function draw(){
      const t=state.tile; ctx.clearRect(0,0,canvas.width,canvas.height);
      ctx.fillStyle='#1f2937'; ctx.fillRect(0,0,canvas.width,canvas.height);
      for(let y=0;y<state.rows;y++){
        for(let x=0;x<state.cols;x++){
          const X=x*t, Y=y*t;
          if(state.grid[y][x]===1){ ctx.fillStyle='#0c3b2e'; ctx.fillRect(X,Y,t,t); ctx.fillStyle='#11624c'; roundRect(X+2,Y+2,t-4,t-4,6,true,false); }
          else { ctx.fillStyle='#0b1020'; ctx.fillRect(X,Y,t,t); ctx.fillStyle='rgba(255,255,255,.05)'; ctx.fillRect(X,Y,t,2); }
        }
      }
      ctx.fillStyle='#fbbf24';
      state.pellets.forEach(s=>{ const [x,y]=s.split(',').map(Number); ctx.beginPath(); ctx.arc(x*t+t/2, y*t+t/2, Math.max(2, t*0.12), 0, Math.PI*2); ctx.fill(); });
      for(const r of state.robots){ drawRobot(r); }
      drawPlayer(state.player.x, state.player.y);
      if(state.explosion){ drawExplosion(); }
    }

    function drawPlayer(x,y){
      const t=state.tile, X=x*t, Y=y*t;
      const eye = Math.max(2, t*0.08);
      ctx.save(); ctx.translate(X+t/2, Y+t/2);
      ctx.fillStyle='#f87171'; circle(0,0,t*0.36,true);
      ctx.fillStyle='#fff'; circle(-t*0.2,-t*0.12,eye,true); circle(t*0.2,-t*0.12,eye,true);
      ctx.fillStyle='#111827'; circle(-t*0.2,-t*0.12,eye*0.5,true); circle(t*0.2,-t*0.12,eye*0.5,true);
      ctx.fillStyle='#ef4444'; ctx.beginPath(); ctx.moveTo(-4,8); ctx.lineTo(0,12); ctx.lineTo(4,8); ctx.closePath(); ctx.fill();
      ctx.restore();
    }
    function drawRobot(r){
      const t=state.tile, X=r.x*t, Y=r.y*t;
      ctx.fillStyle=r.color; roundRect(X+4,Y+4,t-8,t-8,6,true,false);
      ctx.fillStyle='#111827'; ctx.fillRect(X+6,Y+6,6,6); ctx.fillRect(X+t-12,Y+6,6,6);
      const barH = Math.max(2, t*0.06);
      ctx.fillStyle = (r.mode==='chase')? '#ef4444' : (r.mode==='wander'? '#10b981' : '#3b82f6');
      ctx.fillRect(X+4, Y+t-6, t-8, barH);
    }
    function circle(x,y,r,fill){ ctx.beginPath(); ctx.arc(x,y,r,0,Math.PI*2); fill?ctx.fill():ctx.stroke(); }
    function roundRect(x,y,w,h,r,fill,stroke){ if(w<0) w=-w; if(h<0) h=-h; ctx.beginPath(); ctx.moveTo(x+r,y); ctx.arcTo(x+w,y,x+w,y+h,r); ctx.arcTo(x+w,y+h,x,y+h,r); ctx.arcTo(x,y+h,x,y,r); ctx.arcTo(x,y,x+w,y,r); ctx.closePath(); if(fill) ctx.fill(); if(stroke) ctx.stroke(); }

    let toastTimer=null; function showToast(msg){ toast.textContent=msg; toast.classList.add('show'); clearTimeout(toastTimer); toastTimer=setTimeout(()=>toast.classList.remove('show'),1000); }

    function updateHUD(){ bPlanes.textContent=state.planes; bBonus.textContent=state.bonus; bLives.textContent=state.lives; bLevel.textContent=state.level; }

    function checkWin(){ if(state.pellets.size===0){ endLevel(); } }
    function endLevel(){ state.running=false; SFX.win(); const score=state.planes+state.bonus; $('#finalScore').textContent=score; $('#finalPlanes').textContent=state.planes; $('#finalBonus').textContent=state.bonus; endShow(); const list=readHS(); list.unshift({t:Date.now(), sc:score}); list.sort((a,b)=>b.sc-a.sc); writeHS(list.slice(0,20)); renderHS(); }
    const endModal=$('#endModal'); function endShow(){ endModal.classList.add('show'); endModal.setAttribute('aria-hidden','false'); } function endClose(){ endModal.classList.remove('show'); endModal.setAttribute('aria-hidden','true'); } $('#btnPlayAgain').addEventListener('click', ()=>{ endClose(); state.level++; resetLevel(); state.running=true; });

    function readHS(){ try{ return JSON.parse(localStorage.getItem('craap_pac_v4ext_hs')||'[]'); }catch(e){ return []; } }
    function writeHS(v){ localStorage.setItem('craap_pac_v4ext_hs', JSON.stringify(v)); }
    function renderHS(){ const list=readHS().slice(0,8); hsList.innerHTML=''; if(!list.length){ hsList.innerHTML='<li><em>No scores yet—be the first!</em></li>'; return; } list.forEach(s=>{ const li=document.createElement('li'); li.innerHTML='<span>'+new Date(s.t).toLocaleDateString()+' '+new Date(s.t).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})+'</span><span>'+s.sc+'</span>'; hsList.appendChild(li); }); }

    // Quiz
    const quizModal=$('#quizModal'), quizQ=$('#quizQuestion'), quizMedia=$('#quizMedia'), quizChoices=$('#quizChoices'), quizExplain=$('#quizExplain');
    const retryCountEl=$('#retryCount'), btnRetry=$('#btnRetry'), btnContinue=$('#btnContinue'), btnGiveUp=$('#btnGiveUp');
    let quizRetries=2, currentQ=null;
    const SVG={
      truncatedAxis(){return `<svg viewBox='0 0 240 140' width='100%' height='120' xmlns='http://www.w3.org/2000/svg'><rect width='240' height='140' fill='#f8fafc'/><text x='6' y='14' font-size='10' fill='#334155'>Y-axis starts at 95</text><line x1='40' y1='20' x2='40' y2='120' stroke='#475569'/><line x1='40' y1='120' x2='220' y2='120' stroke='#475569'/><text x='28' y='28' font-size='9' fill='#64748b'>100</text><text x='28' y='60' font-size='9' fill='#64748b'>97</text><text x='28' y='120' font-size='9' fill='#64748b'>95</text><rect x='60' y='55' width='30' height='65' fill='#60a5fa'/><rect x='110' y='50' width='30' height='70' fill='#f87171'/><rect x='160' y='52' width='30' height='68' fill='#34d399'/><text x='62' y='135' font-size='9' fill='#334155'>A</text><text x='112' y='135' font-size='9' fill='#334155'>B</text><text x='162' y='135' font-size='9' fill='#334155'>C</text></svg>`;},
      astroturf(){return `<svg viewBox='0 0 260 120' width='100%' height='120' xmlns='http://www.w3.org/2000/svg'><rect width='260' height='120' fill='#f8fafc'/><circle cx='40' cy='60' r='16' fill='#94a3b8'/><text x='16' y='16' font-size='10' fill='#0f172a'>Sponsor</text><line x1='56' y1='60' x2='110' y2='30' stroke='#94a3b8'/><line x1='56' y1='60' x2='110' y2='60' stroke='#94a3b8'/><line x1='56' y1='60' x2='110' y2='90' stroke='#94a3b8'/><circle cx='120' cy='30' r='10' fill='#86efac'/><circle cx='120' cy='60' r='10' fill='#86efac'/><circle cx='120' cy='90' r='10' fill='#86efac'/><line x1='130' y1='30' x2='200' y2='20' stroke='#86efac'/><line x1='130' y1='60' x2='200' y2='60' stroke='#86efac'/><line x1='130' y1='90' x2='200' y2='100' stroke='#86efac'/><circle cx='210' cy='20' r='8' fill='#60a5fa'/><circle cx='210' cy='60' r='8' fill='#60a5fa'/><circle cx='210' cy='100' r='8' fill='#60a5fa'/><text x='156' y='15' font-size='9' fill='#0f172a'>'Grassroots' pages</text></svg>`;},
      deepfake(){return `<svg viewBox='0 0 240 120' width='100%' height='120' xmlns='http://www.w3.org/2000/svg'><rect width='240' height='120' fill='#f8fafc'/><rect x='20' y='20' width='70' height='50' rx='6' fill='#e2e8f0'/><circle cx='55' cy='45' r='16' fill='#93c5fd'/><rect x='150' y='20' width='70' height='50' rx='6' fill='#e2e8f0'/><circle cx='185' cy='45' r='16' fill='#fda4af'/><defs><marker id='ar' markerWidth='6' markerHeight='6' refX='5' refY='3' orient='auto'><path d='M0,0 L0,6 L6,3 z' fill='#334155'/></marker></defs><path d='M100 45h40' stroke='#334155' stroke-width='2' marker-end='url(#ar)'/><text x='20' y='90' font-size='10' fill='#334155'>Face/voice swap</text></svg>`;},
      botnet(){return `<svg viewBox='0 0 260 120' width='100%' height='120' xmlns='http://www.w3.org/2000/svg'><rect width='260' height='120' fill='#f8fafc'/><circle cx='40' cy='60' r='14' fill='#fca5a5'/><text x='15' y='18' font-size='10' fill='#0f172a'>Seed</text><line x1='54' y1='60' x2='100' y2='30' stroke='#94a3b8'/><line x1='54' y1='60' x2='100' y2='60' stroke='#94a3b8'/><line x1='54' y1='60' x2='100' y2='90' stroke='#94a3b8'/><g fill='#a5b4fc'><circle cx='110' cy='30' r='9'/><circle cx='110' cy='60' r='9'/><circle cx='110' cy='90' r='9'/></g><g stroke='#a5b4fc'><line x1='119' y1='30' x2='200' y2='20'/><line x1='119' y1='60' x2='200' y2='60'/><line x1='119' y1='90' x2='200' y2='100'/></g><g fill='#60a5fa'><circle cx='210' cy='20' r='7'/><circle cx='210' cy='60' r='7'/><circle cx='210' cy='100' r='7'/></g><text x='150' y='15' font-size='9' fill='#0f172a'>Burst within seconds</text></svg>`;},
      falsebalance(){return `<svg viewBox='0 0 260 120' width='100%' height='120' xmlns='http://www.w3.org/2000/svg'><rect width='260' height='120' fill='#f8fafc'/><rect x='120' y='20' width='4' height='70' fill='#64748b'/><rect x='80' y='35' width='84' height='4' fill='#64748b'/><circle cx='86' cy='80' r='16' fill='#60a5fa'/><circle cx='160' cy='60' r='10' fill='#f87171'/><text x='62' y='102' font-size='10' fill='#0f172a'>Consensus</text><text x='144' y='80' font-size='10' fill='#0f172a'>Outlier</text></svg>`;},
      reverse(){return `<svg viewBox='0 0 240 120' width='100%' height='120' xmlns='http://www.w3.org/2000/svg'><rect width='240' height='120' fill='#f8fafc'/><rect x='20' y='20' width='160' height='70' rx='6' fill='#e2e8f0'/><circle cx='60' cy='55' r='20' fill='#c7d2fe'/><rect x='95' y='35' width='70' height='10' rx='3' fill='#94a3b8'/><rect x='95' y='55' width='90' height='10' rx='3' fill='#a1a1aa'/><circle cx='200' cy='85' r='20' fill='#34d399'/><line x1='180' y='65' x2='194' y2='79' stroke='#334155' stroke-width='3'/></svg>`;}
    };

    const QUESTIONS=(function(){ const qs=[
      { q:"Which term best describes false information shared without intent to deceive?", choices:["Misinformation","Disinformation","Propaganda","Conspiracy theory"], correct:0, explain:"Misinformation = false but shared without intent; disinformation = false with intent to deceive; propaganda = persuasive communication often selective or misleading." },
      { q:"Disinformation differs from misinformation primarily by what?", choices:["Its format is usually video","It spreads faster","The intent to mislead","It uses statistics"], correct:2, explain:"Intent is the key: disinformation is crafted/spread to mislead on purpose." },
      { q:"Which is NOT a CRAAP criterion?", choices:["Currency","Relevance","Authority","Aesthetics"], correct:3, explain:"CRAAP stands for Currency, Relevance, Authority, Accuracy, Purpose." },
      { q:"A news program invites a climate scientist and a non-expert skeptic for 'both sides'. What bias is this?", choices:["Cherry-picking","False balance","Ad hominem","Appeal to nature"], correct:1, explain:"False balance gives an outlier view equal weight to a well-supported consensus.", img:SVG.falsebalance() },
      { q:"This chart makes small differences look huge by starting the y-axis at 95. What’s the problem?", choices:["Too many categories","Truncated axis exaggeration","Missing legend","Wrong units"], correct:1, explain:"Starting the axis high visually magnifies tiny differences — a classic misleading viz.", img:SVG.truncatedAxis() },
      { q:"A viral video shows a politician saying something outrageous, but lip-sync looks slightly off. First step?", choices:["Share before it’s removed","Reverse image/video search","Check comments","Ask a friend"], correct:1, explain:"Use reverse image/video search to check provenance; deepfakes often leave artifacts.", img:SVG.deepfake() },
      { q:"A 'grassroots' page suddenly appears with slick graphics and ad budget. Likely risk?", choices:["Astroturfing","Satire","Citizen journalism","Crowdsourcing"], correct:0, explain:"Astroturfing = orchestrated campaign designed to look grassroots; check funding/about pages.", img:SVG.astroturf() },
      { q:"You see 300 identical posts within minutes boosting a product. Signal of…", choices:["Organic virality","Coordinated bots","A/B testing","Shadowbanning"], correct:1, explain:"Synchronized timing/text across many accounts suggests a botnet.", img:SVG.botnet() },
      { q:"A site mimics a major newspaper’s logo with a slightly different URL and sensational headlines. This is…", choices:["Satire","Imposter content","Parody","Paywalled journalism"], correct:1, explain:"Imposter content imitates legitimate brands to borrow credibility." },
      { q:"Which is a higher level of evidence?", choices:["Meta-analysis/systematic review","Single case report","Press release","Blog post"], correct:0, explain:"Syntheses (systematic reviews/meta-analyses) sit near the top of evidence hierarchies." },
      { q:"A claim links to a PDF with charts but no methods section. Which CRAAP element is weak?", choices:["Currency","Relevance","Accuracy","Purpose"], correct:2, explain:"Without methods or transparent data, accuracy/verifiability is questionable." },
      { q:"A company funds doubt‑casting papers to delay regulation. Which tactic from the Disinformation Playbook is this?", choices:["The Fake","The Blitz","The Fix","The Screen"], correct:0, explain:"‘The Fake’: promote counterfeit science to question consensus." },
      { q:"Flooding agencies with lawsuits and attacks to intimidate scientists is…", choices:["The Blitz","The Fix","The Diversion","The Screen"], correct:0, explain:"‘The Blitz’: harass/chill critics through legal and PR attacks." },
      { q:"Placing allies on oversight boards to skew decisions is…", choices:["The Diversion","The Fix","The Screen","Astroturf"], correct:1, explain:"‘The Fix’: capture decision‑making spaces." },
      { q:"Funding front groups to create a veneer of support is…", choices:["The Screen","The Diversion","The Blitz","The Fix"], correct:0, explain:"‘The Screen’: create a false appearance of support via shell groups and PR." },
      { q:"“No studies show harm, therefore it’s safe.” Problem?", choices:["Cherry-picking","Argument from ignorance","Post hoc","Appeal to emotion"], correct:1, explain:"Absence of evidence ≠ evidence of absence." },
      { q:"A thread focuses on one outlier study and ignores 20 others. This is…", choices:["Hedging","Cherry‑picking","Moving the goalposts","Tu quoque"], correct:1, explain:"Cherry‑picking selects evidence that fits a pre‑chosen conclusion." },
      { q:"Best first step to vet a suspicious breaking news image?", choices:["Reverse image search + look for earlier dates","Zoom and look at pixels only","Trust the watermark","Check if it ‘feels’ real"], correct:0, explain:"Use reverse search to find original context/time and compare versions.", img:SVG.reverse() },
      { q:"The URL ends with .co and mimics a known outlet. You should…", choices:["Close it immediately","Check About/Contact, masthead, and WHOIS","Email the author","Trust Google ranking"], correct:1, explain:"Verify ownership, editorial team, and contact footprint to spot imposters." },
      { q:"An alarming claim cites 'a study' but doesn’t link it. Best move?", choices:["Assume it’s paywalled","Search for the study title/DOI","Ask in comments","Trust a screenshot"], correct:1, explain:"Locate the actual study; read methods and limitations." },
      { q:"Which of these best fits 'fake news' as defined in research?", choices:["Satirical articles only","Any mistake in journalism","Intentionally and verifiably false news content designed to mislead","Opinion pieces"], correct:2, explain:"Research definitions emphasize intentional deception in news-like formats." },
      { q:"Post‑truth culture is characterized by…", choices:["Prioritizing identity and feelings over evidence","Only using statistics","A ban on sarcasm","Perfect objectivity"], correct:0, explain:"Post‑truth elevates identity/feelings over empirical facts." },
      { q:"Digital propaganda primarily refers to…", choices:["Educational infographics","Attempts to manipulate public opinion via social platforms/ICTs","Only government press releases","Peer‑reviewed research"], correct:1, explain:"Digital propaganda leverages social media/ICTs to sway opinion." },
      { q:"Conspiracy theories commonly feature…", choices:["Falsifiability and openness to new evidence","Self‑sealing logic that explains away disconfirming facts","Strict reliance on primary data","Peer review"], correct:1, explain:"Self‑sealing explanations make conspiracies resistant to falsification." },
      { q:"A meme crops out a headline’s correction. Tactic?", choices:["Hedging","Context stripping","Satire","Equivocation"], correct:1, explain:"Crops remove corrective context to mislead." },
      { q:"Which habit most reduces being fooled online?", choices:["Rely on one trusted source","Pause and lateral read across multiple sources","Only use video content","Check comments"], correct:1, explain:"Lateral reading across diverse, credible sources helps." },
      { q:"Malinformation is best described as…", choices:["Satire mistaken as news","True information shared to cause harm (e.g., doxxing)","Typos in headlines","Benign gossip"], correct:1, explain:"Malinformation uses true content weaponized to harm." },
      { q:"Which CRAAP element checks if a source clearly states authors and qualifications?", choices:["Currency","Relevance","Authority","Purpose"], correct:2, explain:"Authority asks who wrote it and their credentials." },
      { q:"A sudden spike of identical comments praising a brand is most likely…", choices:["Organic fandom","Coordinated inauthentic behavior","Journalistic outreach","A/B testing"], correct:1, explain:"Synchronous repetition indicates coordination/bots." },
      { q:"A 'testimonials' ad where influencers endorse a product for credibility is a classic example of…", choices:["Scientific consensus","Testimonial propaganda technique","Primary research","Ethnography"], correct:1, explain:"Testimonial propaganda borrows credibility from endorsers." },
      { q:"Which step is part of the SIFT/lateral reading approach?", choices:["Share first","Investigate the source","Ignore the URL","Accept screenshots"], correct:1, explain:"Investigate the source, then find better coverage and trace to the original." },
      { q:"Which is a clue of 'imposter content'?", choices:["Secure HTTPS","A clearly listed editorial board","A URL that closely imitates a known outlet (typosquatting)","Accessible corrections policy"], correct:2, explain:"Look‑alike URLs are common in imposters." },
      { q:"A deepfake detection red flag is…", choices:["Perfect lip‑sync","Irregular blinking & artifacts","Always vertical video","Presence of subtitles"], correct:1, explain:"Blinking artifacts and uncanny syncing are common tells.", img:SVG.deepfake() },
      { q:"A lobby group funds a 'think tank' that publishes friendly reports. This most resembles…", choices:["Citizen science","The Screen (buy credibility)","Peer review","Replication"], correct:1, explain:"Buying credibility through front groups aligns with 'The Screen' tactic." },
      { q:"On a source that seems credible, what should you still do?", choices:["Assume accuracy","Skim only the abstract","Check methods, data, and look for independent replication","Ignore conflicts of interest"], correct:2, explain:"Accuracy depends on transparent, reproducible methods." },
      { q:"A rumor claims a recall on campus; reverse image search shows the photo from 2016 abroad. This is…", choices:["Fresh reporting","Misinformation via miscaptioning/context collapse","Provenance check","Investigative journalism"], correct:1, explain:"Old photo reused as new is decontextualization." },
      { q:"'Absence of evidence is evidence of absence' is which fallacy?", choices:["Appeal to nature","Argument from ignorance","Slippery slope","Straw man"], correct:1, explain:"Lack of evidence alone doesn’t prove falsity/truth." },
      { q:"Which description best fits propaganda?", choices:["Neutral info sharing","Deliberate, systematic attempts to shape perception to achieve a response","Unintended rumors","Peer‑reviewed research"], correct:1, explain:"A standard definition emphasizes deliberate, systematic persuasion." },
      { q:"Which is the best practice when a claim references 'a study' with a screenshot only?", choices:["Accept the screenshot","Find the DOI/title and read the study","Assume paywall makes it credible","Ask your group chat"], correct:1, explain:"Trace to the original and assess methods." },
      { q:"A post that says, “No experts can explain X, therefore Y is true” illustrates…", choices:["Burden of proof reversal","Causation vs correlation","Ad hominem","Base‑rate neglect"], correct:0, explain:"It shifts the burden of proof without evidence." },
      { q:"'The Diversion' play in the Disinformation Playbook is…", choices:["Capture oversight boards","Harass critics","Buy credibility via front groups","Flood the zone with doubt and distractions"], correct:3, explain:"The Diversion manufactures uncertainty and distracts from evidence." },
      { q:"When evaluating Currency in CRAAP, you primarily check…", choices:["Whether the site looks modern","Publication/last updated date and relevance to topic","If the author is famous","If it has images"], correct:1, explain:"Currency is about timeliness for your purpose." },
      { q:"Which statement about conspiracy theories is most accurate?", choices:["They invite disconfirming evidence","They rely on sealed logic and special pleading","They are peer‑reviewed","They prioritize the best explanation"], correct:1, explain:"Self‑sealing narratives maintain belief despite evidence." },
      { q:"'Greenwashing' is best described as…", choices:["Transparent lifecycle analysis","Overstating environmental benefits to mislead","Open-source sustainability data","A government labeling program"], correct:1, explain:"A deception tactic to appear eco‑friendly without substantiation." },
      { q:"Which tool/workflow is appropriate for debunking a viral video?", choices:["Lateral reading + reverse video search + find earlier uploads","Screenshot and repost","Only read comments","Ask the uploader"], correct:0, explain:"Verified workflow helps recover context and origin." },
      { q:"Which of these is a signal of coordinated campaign timing?", choices:["Random posting intervals","Repeated identical phrasing at tight intervals","Typos","Use of emojis"], correct:1, explain:"Synchronized text bursts = coordination/bots." },
      { q:"If a site uses a .co domain to imitate a .com of a news outlet, evaluation should focus on…", choices:["Visuals only","About page, masthead, funding, and contact footprint","Number of ads","Comment count"], correct:1, explain:"Ownership and editorial transparency are key checks." },
      { q:"Which of the following is NOT a step of lateral reading/SIFT?", choices:["Stop","Investigate the source","Find better coverage","Follow the money"], correct:3, explain:"Core SIFT steps: Stop, Investigate, Find better coverage, Trace to the original. 'Follow the money' can help but isn't a core step." },
      { q:"An influencer shares a detox cure citing 'studies' but links to no research. Best response?", choices:["Accept anecdote","Look for peer‑reviewed evidence and clinical consensus","Buy the product to test","Trust comments"], correct:1, explain:"Seek peer‑reviewed evidence and consensus; beware health misinformation." },
      { q:"Which clue suggests a deepfake audio clip?", choices:["Clean room noise profile","Imperfect prosody, odd breaths, mismatched cadence","Recorded on a phone","Short duration"], correct:1, explain:"Synthetic voices often stumble on breath/cadence details.", img:SVG.deepfake() },
      { q:"A polished 'citizen group' launches days before a vote with heavy ads. Risk?", choices:["Organic mobilization","Astroturfing/front group","Peer review","Community science"], correct:1, explain:"Sudden, well‑funded campaigns may mask organized interests.", img:SVG.astroturf() },
      { q:"“If masks work, why do doctors still get sick?” is an example of…", choices:["Straw man & false equivalence","Sound methodology","Accurate causal reasoning","Meta‑analysis"], correct:0, explain:"It misrepresents protective effect sizes and context." },
      { q:"When tracing an image, which signal often reveals manipulation?", choices:["EXIF matches context","Lighting/shadows inconsistent with scene","Alt text provided","Landscape orientation"], correct:1, explain:"Shadow/lighting mismatches can expose edits." }
    ]; return shuffle(qs); })();

    function triggerQuiz(){ if(state.quiz) return; state.quiz=true; quizRetries=2; const q=QUESTIONS[RI(QUESTIONS.length)]; currentQ=q; quizQ.textContent=q.q; quizMedia.innerHTML=q.img||''; quizChoices.innerHTML=''; q.choices.forEach((c,i)=>{ const b=document.createElement('button'); b.className='choice'; b.textContent=c; b.addEventListener('click',()=>answer(i)); quizChoices.appendChild(b); }); quizExplain.style.display='none'; quizExplain.textContent=''; retryCountEl.textContent=quizRetries; btnRetry.disabled=true; btnContinue.disabled=true; quizShow(); }
    function answer(i){ if(!currentQ) return; const ok=(i===currentQ.correct); if(ok){ SFX.bonus(); quizExplain.textContent='Correct! '+currentQ.explain; quizExplain.style.display='block'; state.bonus++; updateHUD(); btnContinue.disabled=false; btnRetry.disabled=true; } else { SFX.death(); quizExplain.textContent='Nope. You have '+quizRetries+' more chance(s).'; quizExplain.style.display='block'; if(quizRetries>0){ btnRetry.disabled=false; } else { btnRetry.disabled=true; btnContinue.disabled=true; loseLife('Out of chances! '+currentQ.explain); } quizRetries--; retryCountEl.textContent=Math.max(0,quizRetries); } }
    function quizShow(){ $('#quizModal').classList.add('show'); $('#quizModal').setAttribute('aria-hidden','false'); }
    function quizClose(){ $('#quizModal').classList.remove('show'); $('#quizModal').setAttribute('aria-hidden','true'); }
    $('#btnRetry').addEventListener('click', ()=>{ quizExplain.style.display='none'; $('#btnRetry').disabled=true; });
    $('#btnContinue').addEventListener('click', ()=>{ quizClose(); state.quiz=false; });
    $('#btnGiveUp').addEventListener('click', ()=>{ loseLife('Gave up!'); });

    function loseLife(msg){
      quizClose();
      state.running=false;
      startExplosion(state.player.x, state.player.y);
      setTimeout(()=>{
        state.lives--; updateHUD();
        if(state.lives<=0){ return gameOver(); }
        state.player.x=1; state.player.y=1; state.player.dir=[1,0]; state.player.turnDir=[1,0]; state.player.turnBuffer=0; state.effects.invuln=14;
        state.running=true; state.quiz=false;
      }, 900);
    }

    function gameOver(){
      const score = state.planes + state.bonus;
      document.getElementById('goScore').textContent = score;
      document.getElementById('goLevel').textContent = state.level;
      document.getElementById('goPlanes').textContent = state.planes;
      document.getElementById('goBonus').textContent = state.bonus;
      const list=readHS(); list.unshift({t:Date.now(), sc:score}); list.sort((a,b)=>b.sc-a.sc); writeHS(list.slice(0,20)); renderHS();
      document.getElementById('gameOverModal').classList.add('show'); document.getElementById('gameOverModal').setAttribute('aria-hidden','false');
    }
    document.getElementById('btnRestart').addEventListener('click', ()=>{ document.getElementById('gameOverModal').classList.remove('show'); document.getElementById('gameOverModal').setAttribute('aria-hidden','true'); resetLevel(); state.running=true; });

    function startExplosion(x,y){
      const parts=[]; const t=state.tile, cx=x*t+t/2, cy=y*t+t/2;
      for(let i=0;i<30;i++){ parts.push({x:cx, y:cy, vx:(Math.random()*2-1)*3, vy:(Math.random()*2-1)*3, life:RI(20)+10}); }
      state.explosion=parts;
    }
    function drawExplosion(){ const p=state.explosion; if(!p) return; for(const s of p){ ctx.fillStyle='rgba(255, 99, 132, .8)'; ctx.beginPath(); ctx.arc(s.x, s.y, 3, 0, Math.PI*2); ctx.fill(); s.x+=s.vx; s.y+=s.vy; s.vy+=0.05; s.life--; } state.explosion = p.filter(s=>s.life>0); }

    // Start & Help
    btnStart.addEventListener('click', ()=>{ try{ ensureAudio(); quizClose(); endClose(); document.getElementById('gameOverModal').classList.remove('show'); resetLevel(); }catch(e){ if(errBar){ errBar.style.display='block'; errBar.textContent='Start error: '+e.message; } } });
    btnHelp.addEventListener('click', ()=>{ alert("External build (CSP-friendly):\\n• Put this HTML and the JS file in the same folder\\n• If embedding in an iframe, include sandbox='allow-scripts allow-same-origin'\\n• v4 gameplay: default 7 bots, longer wander"); });

    // End modal helpers
    const endModal=$('#endModal'); function endShow(){ endModal.classList.add('show'); endModal.setAttribute('aria-hidden','false'); } function endClose(){ endModal.classList.remove('show'); endModal.setAttribute('aria-hidden','true'); }

    // Boot
    renderHS(); forceStageSize(); resetLevel();
  }
})();