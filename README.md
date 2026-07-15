# E2Verse — Virtual Land on a Real-World Map

Own virtual land tiles on a real-world map. Buy tiles, develop them to grow their
value, host live tours, and trade them back to the market.

**Disclaimer:** Fictional virtual land only. Not real property. Not an investment.
18+. Balances (Gems, Credits) are in-app only and have no real-world value.

## Features
- **Map** — click a tile to buy it with Credits. Prime locations are limited.
- **My Land** — your portfolio with each tile's live value, gain/loss, and Develop/Sell actions.
- **Voice Claim** — speak to claim a tile; a stronger voice gives a bigger opening boost.
- **Live** — host a live tour anchored to a tile you own, boosting its aura.
- **Develop** — build a structure (Garden / Monument / Tower) on owned land to raise its value.
- **Ledger** — a running log of your buys, sales, builds, and tours.

## Value model
A tile's market value is derived, never invented — the number shown in the
portfolio is the exact number paid out on sale:

```
value = basePrice × vitality × (1 + aura × 0.3)
```

Vitality and aura grow only through the actions above (buy, develop, live tour),
with small market drift over time.

## Run locally
Open `index.html` in a browser, or serve the folder:

```
python3 -m http.server 8000
```

Then visit http://localhost:8000. No build step — plain HTML/CSS/JS (Leaflet for the map).

## Files
- `index.html` — layout and views
- `script.js` — land value engine, buy/sell/develop/live, ledger
- `style.css` — theme and layout
- `manifest.json`, `sw.js` — PWA metadata
