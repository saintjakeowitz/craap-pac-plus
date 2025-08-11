# CRAAP! — Pac‑Style PLUS (GitHub Pages build)

A single‑file canvas game with a big information literacy quiz bank.

## Quick deploy (no terminal)

1. Create a new public repo on GitHub (e.g., `craap-pac-plus`).
2. Upload **both files** from this folder: `index.html` and `app.js` (drag & drop in the GitHub web UI).
3. Commit the changes.
4. Go to **Settings → Pages**.
   - **Source:** Deploy from a branch
   - **Branch:** `main` (or `master`) / **root**
   - Save. Wait ~30–90 seconds.
5. Your site will be available at: `https://YOUR-USERNAME.github.io/REPO-NAME/`

### Embedding in LibGuides (iframe)
```html
<iframe
  src="https://YOUR-USERNAME.github.io/REPO-NAME/"
  width="100%"
  height="720"
  loading="lazy"
  style="border:0; border-radius:12px; box-shadow:0 10px 30px rgba(0,0,0,.2);"
  sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
></iframe>
```

**Tip:** If it looks blank when embedded, open the page directly in a new tab. If it works there, the host is blocking scripts—ensure the iframe includes `allow-scripts`.

## What’s inside
- Default **7 robots**, longer **wander** phase, wrap‑around movement
- Two‑try quizzes; correct = +1 ⭐ bonus; fail twice = lose a life
- Local high scores (per-browser)
- Parallax background, fun sfx (audio starts after Start click)

No frameworks, no build step. All logic is in `app.js`.
