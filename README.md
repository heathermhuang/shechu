# 社畜鼓励器 · shechu.com

Web edition of [Slaves Encourager](https://github.com/thisemailrectrash-cpu/slaves-encourager) (MIT). Static site, no backend: settings live in the visitor's `localStorage`.

Ported from upstream: salary engine (`public/engine.js` ← `Engine.cs`), flip/slide digits, countdown, pay cycles, rest/extra-shift calendar, goals, expenses, opening-income confirmation, privacy and mini modes, three themes, six languages.
Not ported (desktop-only): stocks/OCR/browser extension, pin/tray, home-text editor.

```bash
npm test          # engine tests ported from upstream EngineTests.cs
npm run i18n      # regenerate public/i18n.js from scripts/catalog.tsv
npm run deploy    # wrangler deploy → shechu.com + www.shechu.com
```

Local preview: `python3 -m http.server 8787 --directory public`.

The custom-domain routes in `wrangler.jsonc` need shechu.com to be an active zone in the same Cloudflare account.
