
## Color & Style Tokens
- Primary crimson: `#940731`
- Pinks/accents: `#db4a6a`, `#d54264`, `#da4969`
- Neutrals: white `#ffffff`, very dark gray `#111111`
- Spacing: 4, 8, 12, 16, 24, 32 px
- Font stack: system fonts (no third-party fonts)
- Art-Deco hints: geometric frame gradients; inline SVG planes

## Host on GitHub Pages
1. Create a **public repo** (e.g., `flight-of-the-infolit`).
2. Add the files above at the repo root.
3. Commit & push.
4. In **Settings → Pages**, set:
   - **Source**: `Deploy from a branch`
   - **Branch**: `main` (or `master`) / `/root`
5. Wait for Pages to build; your site will be live at  
   `https://<your-username>.github.io/<repo-name>/`

## Embed (LibGuides / Primo VE)
Use an iFrame:
```html
<iframe
  title="Flight of the InfoLit game"
  src="https://<your-username>.github.io/<repo-name>/"
  width="100%"
  height="1000"
  loading="lazy"
  style="border:0"
></iframe>
