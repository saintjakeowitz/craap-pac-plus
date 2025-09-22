/* ==========================================================
   Flight of the InfoLit — GitHub Pages Static Version
   • WCAG 2.1 AA: keyboardable, visible focus, ARIA dialog
   • No external deps; fetches ./data/gameContent.json
   • Admin panel: Ctrl+. or #admin
   • Completion code: SHA-256(score|timestamp|salt)
   ========================================================== */
(() => {
  "use strict";

  /*** DOM helpers ***/
  const $ = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));

  /*** Utils ***/
  const clamp = (v,min,max)=>Math.max(min,Math.min(max,v));
  const choice = a => a[Math.floor(Math.random()*a.length)];
  const shuffle = (arr)=>{ const a=arr.slice(); for(let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; } return a; };
  const nowSec = ()=> Math.floor(Date.now()/1000);
  const fmtTime=(s)=>{const m=Math.floor(s/60),r=s%60; return `${m}:${String(r).padStart(2,'0')}`;};
  const storageKey="flight-infolit-v1";
  const persist = data=>{ try{ localStorage.setItem(storageKey, JSON.stringify(data)); }catch{} };
  const restore = ()=>{ try{ return JSON.parse(localStorage.getItem(storageKey)||"{}"); }catch{ return {}; } };

  async function sha256(str){
    const enc = new TextEncoder().encode(str);
    const buf = await crypto.subtle.digest("SHA-256", enc);
    const view = new DataView(buf);
    let hex="";
    for(let i=0;i<view.byteLength;i+=4){ hex += ("00000000"+view.getUint32(i).toString(16)).slice(-8); }
    return hex;
  }

  /*** Modal ***/
  const modalBackdrop = $("#modal-backdrop");
  const modalTitle = $("#modal-title");
  const modalDesc = $("#modal-desc");
  const modalClose = $("#modal-close");
  function openModal(title, html){
    modalTitle.textContent = title;
    modalDesc.innerHTML = html;
    modalBackdrop.style.display = "flex";
    modalClose.focus();
  }
  function closeModal(){ modalBackdrop.style.display = "none"; }
  modalClose.addEventListener("click", closeModal);
  modalBackdrop.addEventListener("click", (e)=>{ if(e.target===modalBackdrop) closeModal(); });
  window.addEventListener("keydown",(e)=>{ if(e.key==="Escape" && modalBackdrop.style.display==="flex") closeModal(); });

  /*** State ***/
  let content = null;   // loaded JSON
  let settings = null;

  const state = {
    seed: (new URL(location.href)).searchParams.get("seed") || Math.random().toString(36).slice(2),
    levelIndex: 0,
    score: 0,
    hintsUsed: 0,
    correct: 0,
    total: 0,
    perSkill: {},
    startedAt: nowSec(),
    remaining: 0,
    assessmentMode: false,
    showAdminOnStart: (location.hash||"").toLowerCase().includes("#admin")
  };

  const prefersReduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /*** HUD ***/
  function hud(){
    const totalLevels = settings.enabledLevels.length;
    const wrap = document.createElement("div");
    wrap.className = "hud";
    wrap.setAttribute("role","group");
    wrap.innerHTML = `
      <div class="stat"><span aria-hidden="true">🏁</span> <span>Level ${state.levelIndex+1}/${totalLevels}</span></div>
      <div class="stat"><span aria-hidden="true">⏱</span> <span id="timer">${fmtTime(state.remaining)}</span></div>
      <div class="stat"><span aria-hidden="true">⭐</span> <span id="score">Score ${state.score}</span></div>
      <div class="stat">
        <button class="btn ghost" id="teach-btn" aria-haspopup="dialog" aria-controls="modal-backdrop">Teach Me</button>
        <button class="btn secondary" id="hint-btn" ${state.assessmentMode ? "disabled" : ""} aria-label="Get a hint (reduces score)">Hint</button>
      </div>
    `;
    return wrap;
  }
  function progressBar(perc){
    const d = document.createElement("div");
    d.className = "progress"; d.innerHTML = `<div style="width:${perc}%" aria-hidden="true"></div>`;
    d.setAttribute("aria-label","Progress");
    d.setAttribute("role","progressbar");
    d.setAttribute("aria-valuemin","0"); d.setAttribute("aria-valuemax","100");
    d.setAttribute("aria-valuenow", String(Math.round(perc)));
    return d;
  }
  function levelTitleRow(level){
    const row = document.createElement("div");
    row.appendChild(hud());
    const tipsBtn = ()=> openModal("Teach Me", `<ul>${level.tips.map(t=>`<li>${t}</li>`).join("")}</ul>`);
    setTimeout(()=> $("#teach-btn")?.addEventListener("click", tipsBtn), 0);
    setTimeout(()=> $("#hint-btn")?.addEventListener("click", ()=> showHint(level)), 0);
    row.appendChild(progressBar( (state.levelIndex/settings.enabledLevels.length)*100 ));
    row.style.marginBottom="12px";
    return row;
  }
  function showHint(level){
    state.hintsUsed++;
    state.score = Math.max(0, state.score - settings.hintPenalty);
    $("#score").textContent = `Score ${state.score}`;
    openModal("Hint", `<p>${(level.tips && level.tips[0]) || "Focus on consistent concepts & operators."}</p><p class="muted">(-${settings.hintPenalty} points)</p>`);
  }
  function recordSkill(id, correct, total){
    if(!state.perSkill[id]) state.perSkill[id] = {correct:0,total:0};
    state.perSkill[id].correct += correct;
    state.perSkill[id].total += total;
  }

  /*** Screens ***/
  const screen = $("#screen");
  function render(node){ screen.innerHTML=""; screen.appendChild(node); }

  function homeScreen(){
    const wrap = document.createElement("div");
    wrap.className="grid";
    const deco = document.createElement("div");
    deco.className="deco";
    deco.innerHTML = `
      <h2 class="title" style="font-size:26px">Welcome Aboard</h2>
      <p>Taxi through bite-size levels that sharpen your research radar: keywords, Boolean, source sorting, database matchmaking, and credibility checks. Tone? Whimsical Wonka; rigor? chef’s kiss.</p>
      <div class="notice">
        <strong>Keyboard:</strong> <span class="kbd">Tab</span>, <span class="kbd">Shift+Tab</span>, <span class="kbd">Enter</span>/<span class="kbd">Space</span>; arrows where noted.  
        <strong>Accessibility:</strong> Visible focus, ARIA dialog, reduced motion respected.
      </div>
      <div style="display:flex; gap:8px; flex-wrap:wrap; margin-top:12px">
        <button class="btn" id="start">Start</button>
        <button class="btn secondary" id="how">How to Play</button>
        <button class="btn ghost" id="access">Accessibility</button>
        <button class="btn ghost" id="admin" aria-label="Open Admin (instructor) panel">Educator/Admin</button>
      </div>
    `;
    wrap.appendChild(deco);
    render(wrap);

    $("#start").addEventListener("click", startGame);
    $("#how").addEventListener("click", ()=> openModal("How to Play", `
      <ul>
        <li>Complete each mini-level. Submit to check answers. Hints reduce points.</li>
        <li>Timer gently nudges velocity; speed earns a small bonus.</li>
        <li>“Teach Me” gives concise tips with examples for each skill.</li>
        <li>End screen shows score breakdown and a copy-paste summary for LMS.</li>
      </ul>
    `));
    $("#access").addEventListener("click", ()=> openModal("Accessibility", `
      <ul>
        <li>WCAG 2.1 AA considerations: contrast, focus states, keyboard access.</li>
        <li>ARIA roles/labels on dialogs and key components.</li>
        <li>Respects <em>prefers-reduced-motion</em>.</li>
      </ul>
      <p class="muted">Need tweaks? Use Admin → Import/Export JSON to adjust content.</p>
    `));
    $("#admin").addEventListener("click", showAdmin);
    if(state.showAdminOnStart) showAdmin();
  }

  async function endScreen(){
    const elapsed = nowSec() - state.startedAt;
    const lines = [];
    lines.push(`Flight of the InfoLit — Progress Summary`);
    lines.push(`Score: ${state.score}`);
    lines.push(`Time: ${fmtTime(elapsed)}`);
    for(const [k,v] of Object.entries(state.perSkill)){ lines.push(`${k}: ${v.correct}/${v.total}`); }
    lines.push(`Tips: Build synonyms with OR; use Primo Advanced fields; phrase search in JSTOR; date & subject filters in EBSCOhost.`);
    const summaryText = lines.join("\n");

    let code = "";
    if(state.assessmentMode){
      const ts = Date.now();
      code = await sha256(`${state.score}|${ts}|${content.meta.secretSalt}`);
    }

    const wrap = document.createElement("div");
    wrap.className="grid";
    const pane = document.createElement("div");
    pane.className="card";
    pane.innerHTML = `
      <h2 class="title" style="font-size:26px">Touchdown! ✈️</h2>
      <div class="hud" style="margin-bottom:12px">
        <div>Final Score: <strong>${state.score}</strong></div>
        <div>Time: <strong>${fmtTime(elapsed)}</strong></div>
      </div>
      <div class="grid cols-2">
        <div>
          <h3>Per-Skill</h3>
          <ul id="skill-list"></ul>
        </div>
        <div>
          <h3>Study Tips</h3>
          <ul>
            <li><strong>Primo VE Advanced:</strong> field filters (Title/Subject), date ranges, Resource Type.</li>
            <li><strong>JSTOR:</strong> phrase searches, narrow by subject & date, stable PDFs.</li>
            <li><strong>EBSCOhost:</strong> subject headings, peer-review limiter, phrase & date tweaks.</li>
          </ul>
        </div>
      </div>
      <div style="margin-top:10px">
        <button class="btn" id="copy">Copy Progress</button>
        <button class="btn secondary" id="again">Play Again</button>
        <button class="btn ghost" id="share">Share Link (keeps seed)</button>
      </div>
      ${state.assessmentMode ? `<p class="notice" style="margin-top:12px"><strong>Completion Code:</strong> <span id="code">${code.slice(0,16)}…</span> <span class="muted">(SHA-256)</span></p>`:``}
    `;
    wrap.appendChild(pane);
    render(wrap);

    const ul = $("#skill-list");
    for(const [k,v] of Object.entries(state.perSkill)){
      const li=document.createElement("li"); li.textContent = `${k}: ${v.correct}/${v.total}`;
      ul.appendChild(li);
    }

    $("#copy").addEventListener("click", async ()=>{
      try{ await navigator.clipboard.writeText(summaryText); $("#copy").textContent = "Copied!"; setTimeout(()=>$("#copy").textContent="Copy Progress",1200);}catch{}
    });
    $("#again").addEventListener("click", ()=>{ resetGame(); startGame(); });
    $("#share").addEventListener("click", ()=>{
      const url = new URL(location.href);
      url.searchParams.set("seed", state.seed);
      history.replaceState({}, "", url.toString());
      navigator.clipboard?.writeText(url.toString());
      openModal("Shareable Link", `<p>Link copied. Anyone with the link gets the same randomized order.</p>`);
    });
  }

  /*** Levels ***/
  function runCurrentLevel(){
    persist({seed:state.seed, score:state.score, idx:state.levelIndex});
    const id = settings.enabledLevels[state.levelIndex];
    const level = content.levels.find(l=>l.id===id);
    if(!level){ return nextLevel(); }
    switch(level.type){
      case "chips": return runKeywords(level);
      case "boolean": return runBoolean(level);
      case "sort": return runSourceSort(level);
      case "match": return runDatabaseMatch(level);
      case "quiz": return runEvaluation(level);
      case "signals": return runLightning(level);
      default: return nextLevel();
    }
  }
  function runKeywords(level){
    const prompt = choice(level.prompts);
    const chips = shuffle(prompt.chips);
    const card = document.createElement("div");
    card.className="card";
    card.innerHTML = `
      ${levelTitleRow(level).outerHTML}
      <h3 class="title" style="font-size:22px">${level.title}</h3>
      <p><strong>Topic:</strong> ${prompt.topic}</p>
      <p class="muted">Toggle the chips to compose a strong query (quotes for phrases, OR for synonyms).</p>
      <div class="choices" id="chipbox" role="group" aria-label="Keyword chips"></div>
      <div style="margin-top:12px">
        <label for="query-out"><strong>Query</strong> (editable):</label>
        <textarea id="query-out" rows="3" style="width:100%; border:1px solid var(--pink-c); border-radius:8px; padding:8px"></textarea>
      </div>
      <div class="footer-actions" style="margin-top:12px">
        <button class="btn" id="submit">Submit</button>
      </div>
    `;
    render(card);
    const box = $("#chipbox");
    chips.forEach((txt)=>{
      const b = document.createElement("button");
      b.className="chip"; b.type="button";
      b.setAttribute("aria-pressed","false");
      b.textContent = txt;
      b.addEventListener("click", ()=>{
        const pressed = b.getAttribute("aria-pressed")==="true";
        b.setAttribute("aria-pressed", String(!pressed));
        updateQuery();
      });
      box.appendChild(b);
    });
    function updateQuery(){
      const selected = $$(".chip[aria-pressed='true']").map(el=>el.textContent);
      $("#query-out").value = selected.join(" AND ");
    }
    $("#query-out").value = "";

    $("#submit").addEventListener("click", ()=>{
      const userQ = $("#query-out").value.trim().toLowerCase();
      const ok = prompt.target.every(t=> userQ.includes(t.toLowerCase()));
      const why = ok ? "Chef’s kiss. 📚 You grouped key concepts and used quotes/synonyms well."
                     : "Close! Try grouping synonyms in (parentheses) and keep multi-word phrases in quotes.";
      if(ok){ state.score += settings.correctReward; state.correct++; }
      state.total++;
      recordSkill(level.id, ok?1:0, 1);
      openModal("Result", `<p>${why}</p><p class="muted">Model example: <code>${prompt.good_queries[0]}</code></p>`);
      nextLevel();
    });
  }
  function runBoolean(level){
    const q = choice(level.questions);
    const card = document.createElement("div");
    card.className="card";
    card.innerHTML = `
      ${levelTitleRow(level).outerHTML}
      <h3 class="title" style="font-size:22px">${level.title}</h3>
      <p>${q.stem}</p>
      <label for="bool">Enter a Boolean query (use AND/OR/NOT, quotes, parentheses):</label>
      <textarea id="bool" rows="3" style="width:100%; border:1px solid var(--pink-c); border-radius:8px; padding:8px" aria-describedby="bool-help"></textarea>
      <p id="bool-help" class="muted">Example form: <code>“phrase” AND (syn1 OR syn2) NOT excluded</code></p>
      <div class="footer-actions" style="margin-top:12px">
        <button class="btn" id="submit">Submit</button>
      </div>
    `;
    render(card);
    $("#submit").addEventListener("click", ()=>{
      const user = $("#bool").value.trim().replace(/\s+/g," ").toLowerCase();
      const ans  = q.answer.trim().toLowerCase();
      const tokens = ans.split(/\s+/).filter(x=>x!=="");
      const ok = tokens.every(t => user.includes(t));
      if(ok){ state.score += settings.correctReward; state.correct++; }
      state.total++;
      recordSkill(level.id, ok?1:0, 1);
      openModal("Result", `<p>${ok?"Smooth operator! 🥳":"Not quite."}</p><p class="muted">Model answer: <code>${q.answer}</code></p>`);
      nextLevel();
    });
  }
  function runSourceSort(level){
    const cards = shuffle(level.cards);
    const card = document.createElement("div");
    card.className="card";
    card.innerHTML = `
      ${levelTitleRow(level).outerHTML}
      <h3 class="title" style="font-size:22px">${level.title}</h3>
      <p class="muted">Assign each source card to its bucket. Use buttons to move (keyboard) or drag with a mouse.</p>

      <div class="grid cols-2">
        <div>
          <h4>Cards</h4>
          <div id="cards" class="choices" role="list"></div>
        </div>
        <div>
          <h4>Buckets</h4>
          <div class="dropzones" id="zones"></div>
        </div>
      </div>
      <div class="footer-actions" style="margin-top:12px">
        <button class="btn" id="submit">Submit</button>
      </div>
    `;
    render(card);
    const cardsBox = $("#cards");
    const zones = $("#zones");
    const mapping = new Map();

    cards.forEach((c)=>{
      const el = document.createElement("div");
      el.className="pill"; el.tabIndex=0; el.setAttribute("role","listitem");
      el.textContent=c.text; el.draggable=true;
      el.addEventListener("dragstart", e=>{ e.dataTransfer.setData("text/plain", c.text); });
      el.addEventListener("keydown", e=>{
        if(e.key==="Enter" || e.key===" "){ zones.querySelector(".dropzone")?.focus(); }
      });
      cardsBox.appendChild(el); mapping.set(el, null);
    });

    level.buckets.forEach(name=>{
      const dz = document.createElement("div");
      dz.className="dropzone"; dz.tabIndex=0; dz.setAttribute("aria-label", `Bucket ${name}`);
      dz.innerHTML = `<h4>${name}</h4><div class="choices" data-bucket="${name}"></div>`;
      dz.addEventListener("dragover", e=>{ e.preventDefault(); });
      dz.addEventListener("drop", e=>{
        e.preventDefault();
        const label = e.dataTransfer.getData("text/plain");
        const el = $$(".pill").find(p=>p.textContent===label);
        if(el){ dz.querySelector(".choices").appendChild(el); mapping.set(el, name); }
      });
      dz.addEventListener("keydown", e=>{
        if(e.key==="Enter" || e.key===" "){
          const activeCard = cardsBox.querySelector(".pill:focus") || $$(".pill").find(p=>p===document.activeElement);
          if(activeCard){ dz.querySelector(".choices").appendChild(activeCard); mapping.set(activeCard, name); }
        }
      });
      zones.appendChild(dz);
    });

    $("#submit").addEventListener("click", ()=>{
      let correct=0;
      cards.forEach((c)=>{
        const el = $$(".pill").find(p=>p.textContent===c.text);
        if(mapping.get(el)===c.bucket) correct++;
      });
      if(correct===cards.length){ state.score += settings.correctReward; state.correct+=cards.length; }
      state.total+=cards.length;
      recordSkill(level.id, correct, cards.length);
      openModal("Result", `<p>${correct}/${cards.length} correct.</p>`);
      nextLevel();
    });
  }
  function runDatabaseMatch(level){
    const pairs = shuffle(level.pairs);
    const dbs = shuffle(Array.from(new Set(pairs.map(p=>p.db))));
    const card = document.createElement("div");
    card.className="card";
    card.innerHTML = `
      ${levelTitleRow(level).outerHTML}
      <h3 class="title" style="font-size:22px">${level.title}</h3>
      <p class="muted">Match each topic to the best database/platform.</p>
      <div class="grid cols-2">
        <div>
          <h4>Topics</h4>
          <div id="topics"></div>
        </div>
        <div>
          <h4>Databases</h4>
          <div id="dbs"></div>
        </div>
      </div>
      <div class="footer-actions" style="margin-top:12px">
        <button class="btn" id="submit">Submit</button>
      </div>
    `;
    render(card);
    const tWrap=$("#topics"), dWrap=$("#dbs");
    const selects=[];
    pairs.forEach((p)=>{
      const row = document.createElement("div");
      row.style.margin="8px 0";
      row.innerHTML = `<label><strong>${p.topic}</strong><br/>
        <select data-ans="${p.db}" style="margin-top:6px; padding:6px; border-radius:8px; border:1px solid var(--pink-c)">
          <option value="">Select…</option>
          ${dbs.map(d=>`<option value="${d}">${d}</option>`).join("")}
        </select>
      </label>`;
      tWrap.appendChild(row); selects.push(row.querySelector("select"));
    });
    dWrap.innerHTML = `<ul class="muted">
      <li><strong>JSTOR:</strong> Humanities/social sciences; older coverage; phrase searches; great PDFs.</li>
      <li><strong>PubMed:</strong> Health/biomed; use MeSH; clinical queries.</li>
      <li><strong>PsycINFO:</strong> Psychology/behavior; strong thesaurus/subjects.</li>
      <li><strong>Primo VE:</strong> Catalog &amp; more; Advanced fields for Title/Subject; Resource Type filters.</li>
    </ul>`;

    $("#submit").addEventListener("click", ()=>{
      let correct=0;
      selects.forEach(sel=>{ if(sel.value===sel.dataset.ans) correct++; });
      if(correct===selects.length){ state.score += settings.correctReward; state.correct+=selects.length; }
      state.total+=selects.length;
      recordSkill(level.id, correct, selects.length);
      openModal("Result", `<p>${correct}/${selects.length} correct.</p>`);
      nextLevel();
    });
  }
  function runEvaluation(level){
    const items = shuffle(level.items).slice(4); // tune per difficulty if desired
    const card = document.createElement("div");
    card.className="card";
    card.innerHTML = `
      ${levelTitleRow(level).outerHTML}
      <h3 class="title" style="font-size:22px">${level.title}</h3>
      <form id="quiz"></form>
      <div class="footer-actions" style="margin-top:12px">
        <button class="btn" id="submit">Submit</button>
      </div>
    `;
    render(card);
    const form=$("#quiz");
    items.forEach((it,idx)=>{
      const fs=document.createElement("fieldset");
      fs.style.margin="8px 0"; fs.role="group"; fs.ariaLabel=`Question ${idx+1}`;
      fs.innerHTML = `
        <legend><strong>${it.prompt}</strong></legend>
        ${it.options.map((opt,i)=>`
          <label style="display:block; margin:6px 0">
            <input type="radio" name="q${idx}" value="${i}"> ${opt}
          </label>`).join("")}
      `;
      form.appendChild(fs);
    });
    $("#submit").addEventListener("click", ()=>{
      let correct=0,total=items.length;
      items.forEach((it,idx)=>{
        const pick=form.querySelector(`input[name="q${idx}"]:checked`);
        if(pick && Number(pick.value)===it.answer) correct++;
      });
      if(correct===total){ state.score += settings.correctReward; }
      state.correct+=correct; state.total+=total;
      recordSkill(level.id, correct, total);
      openModal("Result", `<p>${correct}/${total} correct.</p>`);
      nextLevel();
    });
  }
  function runLightning(level){
    const items = shuffle(level.signals);
    const card = document.createElement("div");
    card.className="card";
    card.innerHTML = `
      ${levelTitleRow(level).outerHTML}
      <h3 class="title" style="font-size:22px">${level.title}</h3>
      <div id="qs"></div>
      <div class="footer-actions" style="margin-top:12px">
        <button class="btn" id="submit">Submit</button>
      </div>
    `;
    render(card);
    const qs=$("#qs"); const picks=[];
    items.forEach((it)=>{
      const box=document.createElement("div");
      box.className="notice"; box.style.margin="8px 0";
      box.innerHTML = `<p><strong>${it.q}</strong></p>
        ${it.choices.map((c,i)=>`<button class="btn ghost" data-i="${i}">${c}</button>`).join(" ")}`;
      qs.appendChild(box);
      const row={pick:null}; picks.push(row);
      box.querySelectorAll("button").forEach(btn=>{
        btn.addEventListener("click", ()=>{
          box.querySelectorAll("button").forEach(b=>b.classList.remove("selected"));
          btn.classList.add("selected");
          row.pick = Number(btn.dataset.i);
        });
      });
    });
    $("#submit").addEventListener("click", ()=>{
      let correct=0;
      items.forEach((it,i)=>{ if(picks[i].pick===it.answer) correct++; });
      if(correct===items.length){ state.score += settings.correctReward; }
      state.correct+=correct; state.total+=items.length;
      recordSkill(level.id, correct, items.length);
      openModal("Result", `<p>${correct}/${items.length} correct.</p>`);
      nextLevel();
    });
  }

  /*** Flow ***/
  let timerId=null;
  function tick(){
    state.remaining = clamp(state.remaining-1, 0, 1e6);
    $("#timer")?.textContent = fmtTime(state.remaining);
    if(state.remaining<=0){ clearInterval(timerId); endScreen(); }
  }
  function startTimer(){ clearInterval(timerId); timerId=setInterval(tick,1000); }

  function nextLevel(){
    const pctLeft = state.remaining / (settings.timerSec[settings.difficulty]||780);
    const bonus = Math.round(settings.timeBonusMax * pctLeft * 0.2);
    state.score += bonus;

    state.levelIndex++;
    if(state.levelIndex >= settings.enabledLevels.length){ clearInterval(timerId); endScreen(); }
    else { runCurrentLevel(); }
    $("#score")?.textContent = `Score ${state.score}`;
  }
  function resetGame(){
    state.levelIndex=0; state.score=0; state.correct=0; state.total=0; state.hintsUsed=0;
    state.perSkill={}; state.startedAt=nowSec();
    state.remaining = settings.timerSec[settings.difficulty] || 780;
    state.assessmentMode = !!settings.assessmentMode;
  }
  function startGame(){
    resetGame(); startTimer(); runCurrentLevel();
  }

  /*** Admin ***/
  function showAdmin(){
    const jsonStr = JSON.stringify(content, null, 2);
    openModal("Educator/Admin Panel", `
      <div class="notice"><strong>Assessment Mode:</strong> ${state.assessmentMode ? "ON" : "OFF"} (locks hints; shows completion code)</div>
      <div style="display:flex; gap:8px; flex-wrap:wrap; margin:10px 0">
        <button class="btn" id="toggle-assess">${state.assessmentMode ? "Disable" : "Enable"} Assessment</button>
        <button class="btn secondary" id="enable-all">Enable All Levels</button>
        <label class="btn ghost" for="import-json" style="cursor:pointer">Import JSON<input id="import-json" type="file" accept="application/json" style="display:none"></label>
        <button class="btn ghost" id="download">Export JSON</button>
      </div>
      <textarea id="json" rows="14" style="width:100%; border:1px solid var(--pink-c); border-radius:8px; padding:8px">${jsonStr}</textarea>
      <div class="footer-actions" style="margin-top:10px">
        <button class="btn" id="apply">Apply JSON</button>
      </div>
    `);
    $("#toggle-assess").addEventListener("click", ()=>{
      state.assessmentMode = !state.assessmentMode;
      settings.assessmentMode = state.assessmentMode;
      showAdmin();
    });
    $("#enable-all").addEventListener("click", ()=>{
      settings.enabledLevels = content.levels.map(l=>l.id);
      showAdmin();
    });
    $("#apply").addEventListener("click", ()=>{
      try{
        const obj = JSON.parse($("#json").value);
        content = obj; settings = content.settings;
        closeModal(); openModal("Success","<p>Content updated.</p>");
      }catch(e){ openModal("Error", `<p>JSON parse error: ${e.message}</p>`); }
    });
    $("#download").addEventListener("click", ()=>{
      const blob = new Blob([$("#json").value], {type:"application/json"});
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = "gameContent.json"; a.click();
      URL.revokeObjectURL(url);
    });
    $("#import-json").addEventListener("change", (e)=>{
      const file = e.target.files?.[0]; if(!file) return;
      const reader = new FileReader();
      reader.onload = () => { $("#json").value = reader.result; };
      reader.readAsText(file);
    });
  }

  // Admin hotkey: Ctrl + .
  window.addEventListener("keydown",(e)=>{ if(e.ctrlKey && e.key === "."){ e.preventDefault(); showAdmin(); } });

  /*** Boot: load content then home ***/
  async function init(){
    try{
      const res = await fetch("data/gameContent.json", {cache:"no-store"});
      content = await res.json();
      settings = content.settings;
      // Timer baseline
      state.remaining = settings.timerSec[settings.difficulty] || 780;
      // Direct #admin open
      if(state.showAdminOnStart){ setTimeout(showAdmin, 50); }
      homeScreen();
      // Self-tests (non-blocking)
      selfTests();
    }catch(e){
      openModal("Load Error", `<p>Couldn't load game content: ${String(e)}</p>`);
    }
  }

  function selfTests(){
    let passed=0,total=0;
    total++; if(clamp(10,0,5)===5) passed++;
    total++; { const a=[1,2,3], b=shuffle(a); if(a.length===b.length && a!==b) passed++; }
    total++; sha256("abc").then(hex=>{ if(hex.length===64) passed++; console.info(`Self-tests: ${passed}/${total}`); });
  }

  // helpers used in multiple places
  function levelTitleRow(level){ return window.__levelTitleRow(level); } // small indirection
  window.__levelTitleRow = (level)=> levelTitleRowImpl(level);
  function levelTitleRowImpl(level){
    const row = document.createElement("div");
    row.appendChild(hud());
    const tipsBtn = ()=> openModal("Teach Me", `<ul>${level.tips.map(t=>`<li>${t}</li>`).join("")}</ul>`);
    setTimeout(()=> $("#teach-btn")?.addEventListener("click", tipsBtn), 0);
    setTimeout(()=> $("#hint-btn")?.addEventListener("click", ()=> showHint(level)), 0);
    row.appendChild(progressBar( (state.levelIndex/settings.enabledLevels.length)*100 ));
    row.style.marginBottom="12px";
    return row;
  }

  init();
})();
