/* ==========================================================
   Flight of the InfoLit — Vanilla Implementation (app.js)
   Patched: tolerant grading, seeded RNG, ARIA, modal focus trap,
   timer pause in modals, inline self-tests, no ?. on assignment
   ========================================================== */

(function(){
  "use strict";

  /*** Utilities *************************************************************/
  const $ = sel => document.querySelector(sel);
  const $$ = sel => Array.from(document.querySelectorAll(sel));
  const clamp = (v,min,max)=>Math.max(min,Math.min(max,v));
  const nowSec = ()=> Math.floor(Date.now()/1000);
  const fmtTime = (s)=> { const m = Math.floor(s/60), r = s%60; return `${m}:${String(r).padStart(2,'0')}`; };

  // Parse seed from URL (for deterministic randomness)
  const urlObj = new URL(location.href);
  const seedParam = urlObj.searchParams.get("seed") || "";

  // Seeded RNG (xmur3 + sfc32)
  function xmur3(str){ for(var i=0,h=1779033703^str.length;i<str.length;i++) h=Math.imul(h^str.charCodeAt(i),3432918353), h=h<<13|h>>>19; return function(){ h=Math.imul(h^h>>>16,2246822507); h=Math.imul(h^h>>>13,3266489909); return (h^h>>>16)>>>0; } }
  function sfc32(a,b,c,d){ return function(){ a|=0;b|=0;c|=0;d|=0; var t=(a+b|0)+d|0; d=d+1|0; a=b^b>>>9; b=c+(c<<3)|0; c=(c<<21|c>>>11); c=c+t|0; return (t>>>0)/4294967296; } }
  const seeded = seedParam ? (function(){ const g=xmur3(seedParam); return sfc32(g(),g(),g(),g()); })() : null;
  const rand = ()=> seeded ? seeded() : Math.random();
  const choice = arr => arr[Math.floor(rand()*arr.length)];
  const shuffle = (arr)=>{ const a = arr.slice(); for(let i=a.length-1;i>0;i--){ const j=Math.floor(rand()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; } return a; };

  // Local persistence
  const storageKey = "flight-infolit-v1";
  const persist = (data)=>{ try{ localStorage.setItem(storageKey, JSON.stringify(data)); }catch(e){} };
  const restore = ()=>{ try{ return JSON.parse(localStorage.getItem(storageKey)||"{}"); }catch(e){ return {}; } };

  // Hash utils (completion codes)
  async function sha256(str){
    const enc = new TextEncoder().encode(str);
    const buf = await crypto.subtle.digest("SHA-256", enc);
    const view = new DataView(buf);
    let hex="";
    for(let i=0;i<view.byteLength;i+=4){
      const v=view.getUint32(i);
      hex += ("00000000"+v.toString(16)).slice(-8);
    }
    return hex;
  }

  /*** State *****************************************************************/
  const content = JSON.parse($("#game-content").textContent);
  let settings = content.settings;
  const state = {
    seed: seedParam || Math.random().toString(36).slice(2),
    levelIndex: 0,
    score: 0,
    hintsUsed: 0,
    correct: 0,
    total: 0,
    startedAt: nowSec(),
    remaining: settings.timerSec[settings.difficulty] || 780,
    perSkill: {}, // id -> {correct,total}
    assessmentMode: !!settings.assessmentMode,
    showAdminOnStart: (location.hash||"").toLowerCase().includes("#admin")
  };

  // Reduced motion
  const prefersReduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /*** Rendering scaffolding **************************************************/
  const screen = $("#screen");
  function render(node){
    screen.innerHTML = "";
    screen.appendChild(node);
    if (screen && typeof screen.focus === "function") screen.focus();
  }

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

  // Progress bar
  function progressBar(perc){
    const d = document.createElement("div");
    d.className = "progress"; d.innerHTML = `<div style="width:${perc}%" aria-hidden="true"></div>`;
    d.setAttribute("aria-label","Progress");
    d.setAttribute("role","progressbar");
    d.setAttribute("aria-valuemin","0"); d.setAttribute("aria-valuemax","100");
    d.setAttribute("aria-valuenow", String(Math.round(perc)));
    d.setAttribute("aria-valuetext", `${Math.round(perc)}% complete`);
    return d;
  }

  // Safer tips rendering (no HTML injection)
  function tipsList(items){
    const ul=document.createElement("ul");
    items.forEach(t=>{ const li=document.createElement("li"); li.textContent=t; ul.appendChild(li); });
    return ul.outerHTML;
  }

  // Modal helpers with focus trap & restore and aria-hidden on app
  const modalBackdrop = $("#modal-backdrop");
  const modalTitle = $("#modal-title");
  const modalDesc = $("#modal-desc");
  const modalClose = $("#modal-close");
  let lastFocus=null;

  // Timer pause flag
  let timerId=null;
  let pausedForModal=false;

  function openModal(title, html){
    lastFocus = document.activeElement;
    modalTitle.textContent = title;
    modalDesc.innerHTML = html;
    $("#app").setAttribute("aria-hidden","true");
    modalBackdrop.style.display = "flex";
    modalClose.focus();
    document.addEventListener("focus", trapFocus, true);
    // pause timer
    if (timerId){ clearInterval(timerId); pausedForModal = true; }
  }
  function closeModal(){
    modalBackdrop.style.display = "none";
    $("#app").removeAttribute("aria-hidden");
    document.removeEventListener("focus", trapFocus, true);
    lastFocus?.focus();
    // resume timer
    if (pausedForModal){ startTimer(); pausedForModal = false; }
  }
  function trapFocus(e){
    if (modalBackdrop.style.display === "flex" && !modalBackdrop.contains(e.target)) {
      e.stopPropagation();
      modalClose.focus();
    }
  }
  modalClose.addEventListener("click", closeModal);
  modalBackdrop.addEventListener("click", (e)=>{ if(e.target===modalBackdrop) closeModal(); });
  window.addEventListener("keydown",(e)=>{ if(e.key==="Escape" && modalBackdrop.style.display==="flex") closeModal(); });

  // Admin hotkey: Ctrl + .
  window.addEventListener("keydown",(e)=>{ if(e.ctrlKey && e.key === "."){ e.preventDefault(); showAdmin(); } });

  /*** Screens ***************************************************************/
  function homeScreen(){
    const wrap = document.createElement("div");
    wrap.className = "grid";
    const deco = document.createElement("div");
    deco.className = "deco";
    deco.innerHTML = `
      <h2 class="title" style="font-size:26px">Welcome Aboard</h2>
      <p>Fasten your seatbelts: you’ll taxi through bite-size levels that sharpen your research radar — keyword finesse, Boolean aerobatics, source sorting, database matchmaking, and credibility checks. Tone? Whimsical Wonka, but your librarian-pilot is serious about rigor.</p>
      <div class="notice">
        <strong>Keyboard:</strong> <span class="kbd">Tab</span>, <span class="kbd">Shift+Tab</span>, <span class="kbd">Enter</span>/<span class="kbd">Space</span> to activate; arrows where noted.  
        <strong>Accessibility:</strong> No essential info by color alone; visible focus; reduced motion respected.
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
      <p class="muted">Need tweaks for your users? Use Admin &gt; Export/Import to adjust content.</p>
    `));
    $("#admin").addEventListener("click", showAdmin);

    if(state.showAdminOnStart){ showAdmin(); }
  }

  async function endScreen(){
    const elapsed = nowSec() - state.startedAt;
    const lines = [];
    lines.push(`Flight of the InfoLit — Progress Summary`);
    lines.push(`Score: ${state.score}`);
    lines.push(`Time: ${fmtTime(elapsed)}`);
    for(const [k,v] of Object.entries(state.perSkill)){
      lines.push(`${k}: ${v.correct}/${v.total}`);
    }
    lines.push(`Tips: Keep building synonyms with OR; use Advanced Search fields in Primo; try phrase search in JSTOR; filter dates and subjects in EBSCOhost.`);
    const summaryText = lines.join("\n");

    // Completion code (assessment mode shows hash)
    let code = "";
    if(state.assessmentMode){
      const ts = Date.now();
      const str = `${state.score}|${ts}|${content.meta.secretSalt}`;
      code = await sha256(str);
    }

    const wrap = document.createElement("div");
    wrap.className = "grid";
    const pane = document.createElement("div");
    pane.className = "card";
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
            <li><strong>Primo VE Advanced:</strong> use field filters (Title/Subject), date ranges, and Resource Type.</li>
            <li><strong>JSTOR:</strong> phrase searches in quotes, narrow by subject &amp; date, leverage stable PDFs.</li>
            <li><strong>EBSCOhost:</strong> subject headings, peer-review limiter, adjust for exact phrase &amp; date.</li>
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

    // fill per-skill list
    const ul = $("#skill-list");
    for(const [k,v] of Object.entries(state.perSkill)){
      const li=document.createElement("li"); li.textContent = `${k}: ${v.correct}/${v.total}`;
      ul.appendChild(li);
    }

    $("#copy").addEventListener("click", async ()=>{
      try{
        await navigator.clipboard.writeText(summaryText);
        $("#copy").textContent = "Copied!";
        setTimeout(()=> $("#copy").textContent="Copy Progress", 1200);
      }catch(e){
        openModal("Copy Progress", `<p>Couldn't access clipboard. Select and copy manually:</p><pre>${summaryText.replace(/</g,"&lt;")}</pre>`);
      }
    });
    $("#again").addEventListener("click", ()=> { resetGame(); startGame(); });
    $("#share").addEventListener("click", ()=>{
      const url = new URL(location.href);
      url.searchParams.set("seed", state.seed);
      history.replaceState({}, "", url.toString());
      navigator.clipboard?.writeText(url.toString());
      openModal("Shareable Link", `<p>Link copied to clipboard. Anyone with the link gets the same randomized order.</p>`);
    });
  }

  /*** Level runners **********************************************************/
  function levelTitleRow(level){
    const row = document.createElement("div");
    row.appendChild(hud());
    const bar = progressBar( (state.levelIndex/settings.enabledLevels.length)*100 );
    row.appendChild(bar);
    row.style.marginBottom="12px";

    // Bind immediately after nodes exist
    queueMicrotask(()=>{
      $("#teach-btn")?.addEventListener("click", ()=> openModal("Teach Me", tipsList(level.tips)));
      $("#hint-btn")?.addEventListener("click", ()=> showHint(level));
    });

    return row;
  }

  function showHint(level){
    state.hintsUsed++;
    state.score = Math.max(0, state.score - settings.hintPenalty);
    const hint = (level.tips && level.tips[0]) || "Focus on the key concept nouns and consistent operators.";
    openModal("Hint", `<p>${hint}</p><p class="muted">(-${settings.hintPenalty} points)</p>`);
    const s = $("#score");
    if (s) s.textContent = `Score ${state.score}`;
  }

  function recordSkill(id, correct, total){
    if(!state.perSkill[id]) state.perSkill[id] = {correct:0,total:0};
    state.perSkill[id].correct += correct;
    state.perSkill[id].total += total;
  }

  // LEVEL A: Keyword chips
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
      b.className="chip";
      b.type="button";
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
      const group = (arr, set) => {
        const picks = arr.filter(t => set.includes(t));
        if (picks.length > 1) {
          arr = arr.filter(t => !set.includes(t));
          arr.push("(" + picks.join(" OR ") + ")");
        }
        return arr;
      };
      let parts = selected.slice();
      parts = group(parts, ["asylum","institutionalization","institution"]);
      parts = group(parts, ["deinstitutionalization","community care"]);
      parts = group(parts, ["sleep","sleep quality","sleep duration"]);
      $("#query-out").value = parts.join(" AND ");
    }
    $("#query-out").value = "";

    $("#submit").addEventListener("click", ()=>{
      const userQ = $("#query-out").value.trim();
      const ok = validateQuery(userQ, prompt);
      const why = ok ? "Chef’s kiss. 📚 You grouped key concepts and used quotes/synonyms well." :
                       "Close! Try grouping synonyms in (parentheses) and keep multi-word phrases in quotes.";
      if(ok){ state.score += settings.correctReward; state.correct++; }
      state.total++;
      recordSkill(level.id, ok?1:0, 1);
      openModal("Result", `<p>${why}</p><p class="muted">Model example: <code>${prompt.good_queries[0].replace(/</g,"&lt;")}</code></p>`);
      nextLevel();
    });

    function validateQuery(q, prompt){
      const text = q.toLowerCase();
      const hasAny = (arr) => arr.some(term => {
        const needle = term.toLowerCase().replace(/["()]/g, "").trim();
        const plain = needle.replace(/\*/g, "");
        return text.includes(needle) || (plain && text.includes(plain));
      });
      const groups = prompt.target.map(t => {
        const cleaned = t.toLowerCase().replace(/["()]/g,"").trim();
        if (cleaned.includes(" or ")) {
          return cleaned.split(/\s+or\s+/).map(s => s.trim());
        }
        return [cleaned];
      });
      return groups.every(terms => hasAny(terms));
    }
  }

  // LEVEL B: Boolean (patched grading)
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

    function tokenizeConcepts(s){
      const t = s.toLowerCase().replace(/["]/g,"").replace(/\s+/g," ").trim();
      const notParts = [];
      t.replace(/\bnot\b\s+([^()]+?)(?=$|\s\b(and|or|not)\b)/g, (_, x)=> { notParts.push(x.trim()); return "";});
      const words = t.replace(/\b(and|or|not)\b/g, " ").split(" ").map(w=>w.trim()).filter(Boolean);
      return { words: new Set(words), notParts: notParts.map(s => s.trim()) };
    }

    $("#submit").addEventListener("click", ()=>{
      const user = $("#bool").value;
      const ans  = q.answer;

      const u = tokenizeConcepts(user);
      const a = tokenizeConcepts(ans);

      const requiredPositives = Array.from(a.words).filter(w => !["and","or","not"].includes(w));
      const hasAllPositives = requiredPositives.every(w => u.words.has(w));
      const respectsNots    = a.notParts.every(n => !user.toLowerCase().includes(n.toLowerCase()));

      const ok = hasAllPositives && respectsNots;

      if(ok){ state.score += settings.correctReward; state.correct++; }
      state.total++;
      recordSkill(level.id, ok?1:0, 1);
      openModal("Result", `<p>${ok?"Smooth operator! 🥳":"Not quite."}</p><p class="muted">Model answer: <code>${q.answer.replace(/</g,"&lt;")}</code></p>`);
      nextLevel();
    });
  }

  // LEVEL C: Source sort
  function runSourceSort(level){
    const cards = shuffle(level.cards);
    const card = document.createElement("div");
    card.className="card";
    card.innerHTML = `
      ${levelTitleRow(level).outerHTML}
      <h3 class="title" style="font-size:22px">${level.title}</h3>
      <p class="muted">Assign each source card to its bucket. Press <span class="kbd">Enter</span> on a card to select it, then <span class="kbd">Enter</span> on a bucket to move. You can also drag with a mouse.</p>

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
    let selectedCard=null;

    cards.forEach((c,i)=>{
      const el = document.createElement("div");
      el.className="pill";
      el.setAttribute("tabindex","0");
      el.setAttribute("role","listitem");
      el.textContent = c.text;
      el.draggable = true;
      el.dataset.cid = String(i);

      el.addEventListener("dragstart", e=>{ e.dataTransfer.setData("text/plain", el.dataset.cid); });
      el.addEventListener("keydown", e=>{
        if(e.key==="Enter" || e.key===" "){
          selectedCard = el;
          el.setAttribute("data-selected","true");
        }
      });
      cardsBox.appendChild(el);
      mapping.set(el.dataset.cid, null);
    });

    level.buckets.forEach(name=>{
      const dz = document.createElement("div");
      dz.className="dropzone";
      dz.setAttribute("tabindex","0");
      dz.setAttribute("aria-label", `Bucket ${name}`);
      dz.innerHTML = `<h4>${name}</h4><div class="choices" data-bucket="${name}"></div>`;
      dz.addEventListener("dragover", e=>{ e.preventDefault(); });
      dz.addEventListener("drop", e=>{
        e.preventDefault();
        const cid = e.dataTransfer.getData("text/plain");
        const cardEl = $$(".pill").find(p=>p.dataset.cid===cid);
        if(cardEl){
          dz.querySelector(".choices").appendChild(cardEl);
          mapping.set(cid, name);
          cardEl.removeAttribute("data-selected");
          selectedCard=null;
        }
      });
      dz.addEventListener("keydown", e=>{
        if(e.key==="Enter" || e.key===" "){
          if(selectedCard){
            dz.querySelector(".choices").appendChild(selectedCard);
            mapping.set(selectedCard.dataset.cid, name);
            selectedCard.removeAttribute("data-selected");
            selectedCard=null;
          }
        }
      });
      zones.appendChild(dz);
    });

    $("#submit").addEventListener("click", ()=>{
      let correct=0;
      cards.forEach((c,idx)=>{
        const assigned = mapping.get(String(idx));
        if(assigned === c.bucket) correct++;
      });
      const ok = correct === cards.length;
      if(ok){ state.score += settings.correctReward; state.correct+=cards.length; }
      state.total+=cards.length;
      recordSkill(level.id, correct, cards.length);
      openModal("Result", `<p>${ok?"Perfect landing!":"You drifted off course on a few."}</p><p>${correct}/${cards.length} correct.</p>`);
      nextLevel();
    });
  }

  // LEVEL D: Database match
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
    const tWrap = $("#topics");
    const dWrap = $("#dbs");

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
      tWrap.appendChild(row);
      selects.push(row.querySelector("select"));
    });

    dWrap.innerHTML = tipsList([
      "JSTOR: Humanities/social sciences; older coverage; phrase searches; great PDFs.",
      "PubMed: Health/biomed; use MeSH; clinical queries.",
      "PsycINFO: Psychology/behavior; strong thesaurus/subjects.",
      "Primo VE: Catalog & more; Advanced fields for Title/Subject; Resource Type filters."
    ]);

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

  // LEVEL E: Credibility quiz — show 5 per run
  function runEvaluation(level){
    const items = shuffle(level.items).slice(0, 5);
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
    const form = $("#quiz");
    items.forEach((it,idx)=>{
      const fs = document.createElement("fieldset");
      fs.style.margin="8px 0";
      fs.setAttribute("role","group");
      fs.setAttribute("aria-label", `Question ${idx+1}`);
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
      let correct=0, total=items.length;
      items.forEach((it,idx)=>{
        const pick = form.querySelector(`input[name="q${idx}"]:checked`);
        if(pick && Number(pick.value)===it.answer) correct++;
      });
      if(correct===total){ state.score += settings.correctReward; }
      state.correct+=correct; state.total+=total;
      recordSkill(level.id, correct, total);
      openModal("Result", `<p>${correct}/${total} correct.</p>`);
      nextLevel();
    });
  }

  // LEVEL F: Lightning — show 8 per run
  function runLightning(level){
    const items = shuffle(level.signals).slice(0, 8);
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

    const qs = $("#qs");
    const picks=[];
    items.forEach((it)=>{
      const box=document.createElement("div");
      box.className="notice"; box.style.margin="8px 0";
      box.innerHTML = `<p><strong>${it.q}</strong></p>
        ${it.choices.map((c,i)=>`<button class="btn ghost" data-i="${i}">${c}</button>`).join(" ")}`;
      qs.appendChild(box);
      const rowPicks = {pick:null};
      picks.push(rowPicks);
      box.querySelectorAll("button").forEach(btn=>{
        btn.addEventListener("click", ()=>{
          box.querySelectorAll("button").forEach(b=>b.classList.remove("selected"));
          btn.classList.add("selected");
          rowPicks.pick = Number(btn.dataset.i);
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

  /*** Timer / Flow ***********************************************************/
  function tick(){
    state.remaining = clamp(state.remaining-1, 0, 999999);
    const t = $("#timer");
    if (t) t.textContent = fmtTime(state.remaining);
    if(state.remaining<=0){
      clearInterval(timerId);
      return endScreen();
    }
  }

  function startTimer(){
    clearInterval(timerId);
    timerId = setInterval(tick, 1000);
  }

  function nextLevel(){
    const pctLeft = state.remaining / (settings.timerSec[settings.difficulty]||780);
    const bonus = Math.round(settings.timeBonusMax * pctLeft * 0.2);
    state.score += bonus;

    state.levelIndex++;
    if(state.levelIndex >= settings.enabledLevels.length){ clearInterval(timerId); endScreen(); }
    else { runCurrentLevel(); }

    const s = $("#score");
    if (s) s.textContent = `Score ${state.score}`;
  }

  function runCurrentLevel(){
    persist({seed:state.seed, score:state.score, idx:state.levelIndex, assess: state.assessmentMode});
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

  function resetGame(){
    state.levelIndex = 0;
    state.score = 0; state.correct=0; state.total=0; state.hintsUsed=0;
    state.startedAt = nowSec();
    state.remaining = settings.timerSec[settings.difficulty] || 780;
    state.perSkill = {};
  }

  function startGame(){
    resetGame();
    startTimer();
    runCurrentLevel();
  }

  /*** Admin Panel ************************************************************/
  function showAdmin(){
    const currentJSON = JSON.stringify(content, null, 2);
    openModal("Educator/Admin Panel", `
      <div class="notice"><strong>Assessment Mode:</strong> ${state.assessmentMode ? "ON" : "OFF"} (locks hints; shows completion code)</div>
      <div style="display:flex; gap:8px; flex-wrap:wrap; margin:10px 0">
        <button class="btn" id="toggle-assess">${state.assessmentMode ? "Disable" : "Enable"} Assessment</button>
        <button class="btn secondary" id="enable-all">Enable All Levels</button>
      </div>
      <h3>Import/Export Content JSON</h3>
      <p class="muted">Edit the JSON to customize prompts, tips, or to add new levels. Keep IDs stable.</p>
      <textarea id="json" rows="14" style="width:100%; border:1px solid var(--pink-c); border-radius:8px; padding:8px">${currentJSON}</textarea>
      <div class="footer-actions" style="margin-top:10px">
        <button class="btn" id="apply">Apply JSON</button>
        <button class="btn ghost" id="download">Download JSON</button>
      </div>
    `);
    $("#toggle-assess").addEventListener("click", ()=>{
      state.assessmentMode = !state.assessmentMode;
      settings.assessmentMode = state.assessmentMode;
      persist({ ...restore(), assess: state.assessmentMode });
      showAdmin();
    });
    $("#enable-all").addEventListener("click", ()=>{
      settings.enabledLevels = content.levels.map(l=>l.id);
      showAdmin();
    });
    $("#apply").addEventListener("click", ()=>{
      try{
        const obj = JSON.parse($("#json").value);
        Object.assign(content, obj);
        settings = content.settings;
        closeModal();
        openModal("Success", "<p>Content updated.</p>");
      }catch(e){
        openModal("Error", `<p>JSON parse error: ${e.message}</p>`);
      }
    });
    $("#download").addEventListener("click", ()=>{
      const blob = new Blob([$("#json").value], {type:"application/json"});
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = "gameContent.json"; a.click();
      URL.revokeObjectURL(url);
    });
  }

  /*** Minimal inline tests ***************************************************/
  function selfTests(){
    let passed=0,total=0;
    total++; if(clamp(10,0,5)===5) passed++;
    total++; { const a=[1,2,3]; const b=shuffle(a); if(a.length===b.length && a!==b) passed++; }
    total++; sha256("abc").then(hex=>{ if(hex.length===64) passed++; console.info(`Self-tests: ${passed}/${total}`); });
  }
  selfTests();

  /*** Boot ******************************************************************/
  homeScreen();
})();
