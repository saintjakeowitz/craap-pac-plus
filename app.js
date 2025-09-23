(function () {
  // Show that JS loaded at all
  const out = document.getElementById('screen');
  if (out) out.innerHTML = '<div class="notice">Loaded app.js ✅</div>';

  // Try to read & parse the JSON block
  try {
    const el = document.querySelector('#game-content');
    if (!el) throw new Error('Missing <script id="game-content" type="application/json"> block.');

    const raw = el.textContent;
    if (out) out.insertAdjacentHTML('beforeend', `<div class="notice">Found JSON (length ${raw.length})</div>`);

    const parsed = JSON.parse(raw); // <-- if this fails, we’ll print why
    if (out) out.insertAdjacentHTML('beforeend', `<div class="notice">JSON parsed ✅</div>`);
  } catch (e) {
    if (out) out.insertAdjacentHTML('beforeend', `<pre class="notice" style="color:#c00">Error: ${e.message}</pre>`);
    console.error(e);
  }
})();
