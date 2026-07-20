// E2Verse — virtual land on a real-world map (fictional, 18+, no real property)
let gems = 1420;
let credits = 850;
let owned = JSON.parse(localStorage.getItem('p11_owned') || '[]');
let ledger = JSON.parse(localStorage.getItem('p11_ledger') || '[]');
let tileData = JSON.parse(localStorage.getItem('p11_tileData') || '{}'); // per-tile state: vitality, builds[], aura
let map, currentTile;
const tileRects = {}; // tileId -> Leaflet rectangle, so sells can recolor the map

// All switchable views. showView() hides every view then reveals one.
const VIEWS = ['map-view', 'estate-view', 'voice-view', 'live-view', 'ledger-view', 'develop-view'];

// === LAND VALUE ENGINE ===
// A tile's market value is DERIVED, not invented: base price grown by the same
// vitality/aura the develop engine already tracks. Display == code, always.
//   value = basePrice × vitality × (1 + aura × AURA_WEIGHT)
// This is the number shown in the portfolio and paid out on sale — one source of truth.
const AURA_WEIGHT = 0.3;

function tileMarketValue(tileId) {
  const t = tileData[tileId];
  if (!t) return 0;
  const base = t.basePrice || 0;
  const vitality = t.vitality || 1;
  const aura = t.aura || 0;
  return base * vitality * (1 + aura * AURA_WEIGHT);
}

// Whole-portfolio worth = sum of every owned tile's live market value.
function portfolioValue() {
  return owned.reduce((sum, id) => sum + tileMarketValue(id), 0);
}

function showView(id) {
  VIEWS.forEach(v => {
    const el = document.getElementById(v);
    if (el) el.style.display = (v === id) ? 'block' : 'none';
  });
  // Highlight the nav button that opened this view (matches by onclick handler name).
  const handler = { 'map-view':'showMap', 'estate-view':'showEstate', 'voice-view':'showVoice',
                    'live-view':'showLive', 'ledger-view':'showLedger', 'develop-view':'showDevelop' }[id];
  document.querySelectorAll('nav button').forEach(b => {
    const attr = b.getAttribute('onclick') || '';
    b.classList.toggle('active', handler && attr.indexOf(handler) === 0);
  });
}

function connectWallet() {
  const el = document.getElementById('balance');
  if (el) el.classList.add('linked');
  const btn = document.querySelector('.wallet button');
  if (btn) { btn.textContent = 'Wallet Linked'; btn.disabled = true; }
  addToLedger('Wallet linked. Balances active.');
  updateUI();
}

// Featured prime locations — always drawn, hand-priced landmarks.
const demoTiles = [
  {id:1, lat:37.5, lng:127, name:"Seoul Tile", price:50},
  {id:2, lat:40.7, lng:-74, name:"NYC Prime", price:120},
  {id:3, lat:51.5, lng:-0.1, name:"London", price:80},
  {id:4, lat:35.7, lng:139.7, name:"Tokyo", price:95}
];

// The world is a grid: any lat/lng snaps to a 0.4°×0.4° cell with a STABLE id.
// Same cell → same id → same price, every visit. No randomness in what land costs.
const GRID = 0.4;
function cellOf(lat, lng) {
  const gLat = Math.round(lat / GRID) * GRID;
  const gLng = Math.round(lng / GRID) * GRID;
  // id encodes the cell so ownership persists across sessions and reloads.
  const id = `c_${Math.round(gLat*10)}_${Math.round(gLng*10)}`;
  return { id, lat: +gLat.toFixed(4), lng: +gLng.toFixed(4) };
}

// Deterministic land price from location: proximity to a prime hub drives value.
// Closer to a world city = pricier. Pure function of coordinates — display == code.
function cellPrice(lat, lng) {
  let nearest = Infinity;
  demoTiles.forEach(h => {
    const d = Math.hypot(lat - h.lat, lng - h.lng);
    if (d < nearest) nearest = d;
  });
  // 18 Cr frontier land → up to ~140 Cr next to a hub. Smooth, honest falloff.
  const proximity = Math.max(0, 1 - nearest / 60);
  return Math.round(18 + proximity * proximity * 122);
}

// Human-readable name for an arbitrary cell (e.g. "Parcel 41.2°N, 12.5°E").
function cellName(lat, lng) {
  const ns = lat >= 0 ? 'N' : 'S';
  const ew = lng >= 0 ? 'E' : 'W';
  return `Parcel ${Math.abs(lat).toFixed(1)}°${ns}, ${Math.abs(lng).toFixed(1)}°${ew}`;
}

// Draw one tile's rectangle on the map (owned = gold, available = faint), wire buy.
function drawTileRect(t) {
  if (tileRects[t.id]) map.removeLayer(tileRects[t.id]);
  const isOwned = owned.includes(t.id);
  const half = GRID / 2;
  const rect = L.rectangle([
    [t.lat - half, t.lng - half],
    [t.lat + half, t.lng + half]
  ], {
    color: isOwned ? '#c5a46e' : '#5a4a30',
    weight: isOwned ? 2.5 : 1.5,
    fillColor: isOwned ? '#c5a46e' : '#3a3124',
    fillOpacity: isOwned ? 0.22 : 0.06
  }).addTo(map);
  tileRects[t.id] = rect;
  rect.bindTooltip(() => tileTooltip(t), {sticky:true});
  rect.on('click', () => buyTile(t, rect));
  return rect;
}

function initMap() {
  map = L.map('map').setView([20, 0], 2);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OSM contributors | Virtual land only'
  }).addTo(map);

  // Featured landmark tiles, always shown.
  demoTiles.forEach(t => drawTileRect(t));

  // Every tile you already own gets drawn where it sits — the map is your holdings.
  owned.forEach(id => {
    if (tileRects[id]) return; // already a featured tile
    const t = tileData[id];
    if (t && typeof t.lat === 'number' && typeof t.lng === 'number') {
      drawTileRect({ id, lat: t.lat, lng: t.lng, name: t.name, price: t.basePrice || t.paid || 0 });
    }
  });

  // Click ANYWHERE on the world → survey the land cell there and offer to claim it.
  map.on('click', e => {
    const cell = cellOf(e.latlng.lat, e.latlng.lng);
    if (tileRects[cell.id]) { tileRects[cell.id].fire('click'); return; } // existing tile
    const price = cellPrice(cell.lat, cell.lng);
    const tile = { id: cell.id, lat: cell.lat, lng: cell.lng, name: cellName(cell.lat, cell.lng), price };
    // Survey first: confirm before spending, so a stray map click never buys land.
    if (credits < price) { alert(`${tile.name}\nSurvey price ${price} Cr — not enough Credits.`); return; }
    if (!confirm(`${tile.name}\nSurvey value: ${price} Credits.\nClaim this land?`)) return;
    buyTile(tile, null);
  });
}

// Hover label: shows price to buy, or live market value + gain if already owned.
function tileTooltip(t) {
  if (owned.includes(t.id)) {
    const val = tileMarketValue(t.id);
    const paid = (tileData[t.id] && tileData[t.id].paid) || t.price;
    const gain = paid ? ((val - paid) / paid) * 100 : 0;
    const sign = gain >= 0 ? '+' : '';
    return `${t.name} — OWNED<br>Value ${val.toFixed(0)} Cr (${sign}${gain.toFixed(0)}%)`;
  }
  return `${t.name}<br>Buy for ${t.price} Credits`;
}

function buyTile(tile, rect) {
  if (owned.includes(tile.id)) {
    alert('You already own this tile. Develop it to grow its value.');
    return;
  }
  const cost = tile.price;
  if (credits < cost) {
    alert('Not enough Credits for this tile.');
    return;
  }
  credits -= cost;
  owned.push(tile.id);
  localStorage.setItem('p11_owned', JSON.stringify(owned));
  // Reflect the claim on the map: recolor an existing rect, or draw a brand-new
  // owned tile where the user clicked. The map now mirrors your holdings.
  if (rect) {
    rect.setStyle({ color: '#c5a46e', weight: 2.5, fillColor: '#c5a46e', fillOpacity: 0.22 });
  } else if (map) {
    drawTileRect({ id: tile.id, lat: tile.lat, lng: tile.lng, name: tile.name, price: tile.price });
  }

  // Record the full asset so the portfolio & value engine have real data.
  // basePrice = purchase price is the anchor market value grows from.
  tileData[tile.id] = Object.assign({ vitality: 1.0, builds: [], aura: 0 }, tileData[tile.id] || {}, {
    name: tile.name,
    basePrice: tile.price,
    paid: cost,
    lat: tile.lat, lng: tile.lng,
    boughtAt: Date.now()
  });
  saveTileData();

  // First development pulse on claim.
  const s = (window.getVoiceSurprise && window.getVoiceSurprise()) || 0.42;
  mutateTile(tile.id, s, 0.28);
  addToLedger(`Claimed ${tile.name} for ${cost} Cr. Value now ${tileMarketValue(tile.id).toFixed(0)} Cr.`);
  updateUI();
  alert(`Bought ${tile.name} for ${cost} Cr!\nLive value: ${tileMarketValue(tile.id).toFixed(0)} Cr. Develop it to grow value.`);
}

function claimWithVoice() {
  if (!navigator.mediaDevices) {
    alert('A microphone is needed for voice claim. Falling back to a standard claim.');
    return;
  }
  const status = document.getElementById('voice-status');
  status.textContent = 'Recording... speak your claim.';

  navigator.mediaDevices.getUserMedia({audio:true}).then(stream => {
    const rec = new MediaRecorder(stream);
    rec.ondataavailable = e => {
      const surprise = (window.getVoiceSurprise && window.getVoiceSurprise()) || (Math.random() * 0.5 + 0.3);
      const energy = 0.25 + Math.random()*0.4;
      status.textContent = `Voice energy: ${surprise.toFixed(2)}. Tile claimed with a boost!`;

      // Auto buy + first development pulse
      const demo = {id: Date.now(), lat:20, lng:0, name:"Voice Tile", price:20};
      const paid = 15;
      credits -= paid;
      owned.push(demo.id);
      localStorage.setItem('p11_owned', JSON.stringify(owned));
      tileData[demo.id] = Object.assign({ vitality: 1.0, builds: [], aura: 0 }, {
        name: demo.name, basePrice: demo.price, paid: paid,
        lat: demo.lat, lng: demo.lng, boughtAt: Date.now()
      });
      saveTileData();
      mutateTile(demo.id, surprise, energy);
      addToLedger(`Voice claimed ${demo.name} for ${paid} Cr. Value now ${tileMarketValue(demo.id).toFixed(0)} Cr.`);
      updateUI();
      stream.getTracks().forEach(t=>t.stop());
    };
    rec.start();
    setTimeout(()=>rec.stop(), 3000);
  });
}

function showMap() {
  showView('map-view');
  if (!window.mapInitialized) {
    initMap();
    window.mapInitialized = true;
  }
  setTimeout(() => { if (map) map.invalidateSize(); }, 50);
}

// === MY LAND (portfolio) ===
// Every owned tile rendered with its LIVE market value, gain/loss vs paid,
// vitality/aura, builds, and real Develop + Sell actions. Ownership made tangible.
function showEstate() {
  showView('estate-view');
  renderEstate();
}

function renderEstate() {
  const wrap = document.getElementById('estate-list');
  if (!wrap) return;

  if (owned.length === 0) {
    wrap.innerHTML = '<p class="estate-empty">No land yet. Buy a tile on the Map or claim one by Voice.</p>';
    const sum = document.getElementById('estate-summary');
    if (sum) sum.textContent = '';
    return;
  }

  let totalPaid = 0, totalValue = 0;
  const cards = owned.map(id => {
    const t = tileData[id] || {};
    const name = t.name || `Tile ${id}`;
    const paid = t.paid || t.basePrice || 0;
    const value = tileMarketValue(id);
    totalPaid += paid; totalValue += value;
    const gain = paid ? ((value - paid) / paid) * 100 : 0;
    const up = gain >= 0;
    const sign = up ? '+' : '';
    const builds = (t.builds || []).length;
    return `<div class="estate-card">
      <div class="estate-card-head">
        <span class="estate-name">${name}</span>
        <span class="estate-val ${up ? 'up' : 'down'}">${value.toFixed(0)} Cr <em>${sign}${gain.toFixed(0)}%</em></span>
      </div>
      <div class="estate-meta">
        paid ${paid} Cr · vitality ${(t.vitality||1).toFixed(2)} · aura ${(t.aura||0).toFixed(2)}${builds ? ` · ${builds} build${builds>1?'s':''}` : ''}
      </div>
      <div class="estate-actions">
        <button onclick="developTile('${id}', '${(name+'').replace(/'/g,'')}'); renderEstate();">🏗 Develop (+value)</button>
        <button class="sell-btn" onclick="sellTile('${id}')">💱 Sell for ${value.toFixed(0)} Cr</button>
      </div>
    </div>`;
  }).join('');
  wrap.innerHTML = cards;

  const netGain = totalPaid ? ((totalValue - totalPaid) / totalPaid) * 100 : 0;
  const nsign = netGain >= 0 ? '+' : '';
  const sum = document.getElementById('estate-summary');
  if (sum) sum.innerHTML =
    `Portfolio: <strong>${totalValue.toFixed(0)} Cr</strong> across ${owned.length} tile${owned.length>1?'s':''} · invested ${totalPaid} Cr · <span class="${netGain>=0?'up':'down'}">${nsign}${netGain.toFixed(0)}%</span>`;
}

// === TRADING (sell back to market) ===
// Sell realizes the tile's CURRENT market value into credits — the exact number
// shown in the portfolio (tileMarketValue), so gains/losses are honest. The tile
// leaves your holdings, the map recolors, and the trade is logged to the Ledger.
function sellTile(id) {
  id = typeof id === 'string' && /^\d+$/.test(id) ? parseInt(id) : id;
  const idx = owned.indexOf(id);
  if (idx === -1) { alert('You do not own this tile.'); return; }

  const t = tileData[id] || {};
  const value = Math.round(tileMarketValue(id));
  const paid = t.paid || t.basePrice || 0;
  const name = t.name || `Tile ${id}`;
  const gain = value - paid;

  if (!confirm(`Sell ${name} for ${value} Credits?\nPaid ${paid} · realized ${gain >= 0 ? '+' : ''}${gain} Cr.`)) return;

  // Payout + remove from holdings
  credits += value;
  owned.splice(idx, 1);
  localStorage.setItem('p11_owned', JSON.stringify(owned));

  // Return the land to the market. Featured landmark tiles recolor to available
  // and stay clickable; a surveyed cell simply leaves the map (frontier again).
  const isFeatured = demoTiles.some(d => d.id === id);
  if (tileRects[id]) {
    if (isFeatured) {
      tileRects[id].setStyle({ color: '#5a4a30', weight: 1.5, fillColor: '#3a3124', fillOpacity: 0.06 });
    } else {
      map.removeLayer(tileRects[id]);
      delete tileRects[id];
    }
  }
  delete tileData[id];
  saveTileData();

  addToLedger(`Sold ${name} for ${value} Cr (paid ${paid}, ${gain >= 0 ? '+' : ''}${gain}). Traded on E2Verse market.`);
  updateUI();
  renderEstate();
  alert(`💱 Sold ${name} for ${value} Cr.\nRealized ${gain >= 0 ? '+' : ''}${gain} Cr vs your ${paid} Cr entry.`);
}

function showVoice() {
  showView('voice-view');
}

function showLive() {
  showView('live-view');
  const liveDiv = document.getElementById('live-view');
  if (owned.length > 0) {
    const name = (tileData[owned[0]] && tileData[owned[0]].name) || 'your tile';
    liveDiv.innerHTML = `<h2>Live on Your Land</h2><p>Host a live tour anchored to your tile. A live session permanently boosts that tile's aura.</p>
    <button onclick="hostLiveTour('${owned[0]}', '${(name+'').replace(/'/g,'')}')">🔴 Host Live Tour on ${name}</button>`;
  } else {
    liveDiv.innerHTML = `<h2>Live on Your Land</h2><p>Live tours of owned lands. Buy or claim a tile first, then host a tour from here.</p>`;
  }
}

function showLedger() {
  showView('ledger-view');
  const list = document.getElementById('ledger');
  list.innerHTML = ledger.length ? ledger.map(c => `<div>${c}</div>`).join('') : '<p>No activity yet. Buy or claim a tile to start.</p>';
  reobserveLand(); // background value drift re-runs when you open the ledger
}

function addToLedger(text) {
  ledger.unshift(text);
  if (ledger.length > 10) ledger.pop();
  localStorage.setItem('p11_ledger', JSON.stringify(ledger));
}

function updateUI() {
  const bal = document.getElementById('balance');
  if (bal) bal.textContent = `${gems} Gems · ${credits} Credits`;
  const hold = document.getElementById('holdings');
  if (hold) {
    const n = owned.length;
    if (n === 0) {
      hold.textContent = '◇ 0 tiles owned';
    } else {
      const worth = portfolioValue();
      hold.textContent = `◆ ${n} tile${n > 1 ? 's' : ''} · ${worth.toFixed(0)} Cr est. value`;
    }
    hold.classList.toggle('has-tiles', n > 0);
  }
}

function saveTileData() {
  localStorage.setItem('p11_tileData', JSON.stringify(tileData));
}

// Development pulse: voice energy + activity grows an owned tile's value/vitality/aura.
function mutateTile(tileId, surprise, energy = 0.3) {
  if (!tileData[tileId]) tileData[tileId] = { vitality: 1.0, builds: [], aura: 0, name: 'Unknown' };
  const boost = surprise * (1 + energy * 0.9);
  tileData[tileId].vitality = (tileData[tileId].vitality || 1) + boost;
  tileData[tileId].aura = (tileData[tileId].aura || 0) + surprise * 0.5;
  saveTileData();
  return boost;
}

function reobserveLand() {
  Object.keys(tileData).forEach(id => {
    const t = tileData[id];
    if (t.vitality > 1.2) {
      const drift = (Math.random() - 0.45) * 0.07; // small market drift
      t.vitality *= (1 + drift);
      if (t.vitality < 0.6) t.vitality = 0.6;
    }
  });
  saveTileData();
  // Reflect market drift live if the user is watching their holdings.
  updateUI();
  const estate = document.getElementById('estate-view');
  if (estate && estate.style.display !== 'none') renderEstate();
}

// Develop: build a structure on an owned tile, raising its value.
function developTile(tileId, name) {
  // Normalize: numeric tile ids come back as pure-digit strings from onclick;
  // surveyed-cell ids stay strings. Match whichever form is in `owned`.
  if (typeof tileId === 'string' && /^\d+$/.test(tileId)) tileId = parseInt(tileId);
  if (!owned.includes(tileId)) {
    alert('Buy or claim this tile first.');
    return;
  }
  const surprise = (window.getVoiceSurprise && window.getVoiceSurprise()) || (0.4 + Math.random()*0.5);
  const energy = 0.2 + Math.random() * 0.6;
  const power = surprise * (1.1 + energy);

  if (!tileData[tileId]) tileData[tileId] = { vitality: 1, builds: [], aura: 0, name };
  const type = power > 0.75 ? 'Tower' : (power > 0.45 ? 'Monument' : 'Garden');
  tileData[tileId].builds.push({type, power: power.toFixed(2), at: Date.now()});
  tileData[tileId].vitality += power * 0.55;
  saveTileData();

  addToLedger(`Built ${type} on ${name} — value now ${tileMarketValue(tileId).toFixed(0)} Cr (power ${power.toFixed(2)})`);
  updateUI();
  alert(`✨ ${type} built! Vitality +${(power*0.55).toFixed(2)}.\nTile value now ${tileMarketValue(tileId).toFixed(0)} Cr.`);
}

// Live tour: host a live session anchored to a tile. Costs credits, boosts aura.
function hostLiveTour(tileId, name) {
  const surprise = (window.getVoiceSurprise && window.getVoiceSurprise()) || 0.5;
  const cost = Math.floor(7 + surprise * 14);
  if (credits < cost) { alert(`Not enough Credits — a live tour costs ${cost} Cr.`); return; }
  credits -= cost;
  updateUI();

  if (!tileData[tileId]) tileData[tileId] = { vitality: 1, builds: [], aura: 0, name };
  const boost = surprise * 1.3;
  tileData[tileId].aura = (tileData[tileId].aura || 0) + boost;
  tileData[tileId].vitality += boost * 0.4;
  saveTileData();

  addToLedger(`Live tour on ${name} • paid ${cost} Cr • aura +${boost.toFixed(2)} • value ${tileMarketValue(tileId).toFixed(0)} Cr`);
  updateUI();
  alert(`🔴 Live tour on ${name}! Aura +${boost.toFixed(2)}.\nTile value now ${tileMarketValue(tileId).toFixed(0)} Cr.`);
}

function showDevelop() {
  showView('develop-view');
}

function demoDevelop() {
  if (owned.length === 0) { alert('Buy or claim a tile first.'); return; }
  const id = owned[0];
  const name = (tileData[id] && tileData[id].name) || `Tile ${id}`;
  developTile(id, name);
  showEstate();
}

function initApp() {
  updateUI();
  showView('map-view');
  setTimeout(() => {
    if (!window.mapInitialized) {
      initMap();
      window.mapInitialized = true;
    }
  }, 100);

  // Background market drift updates tile values over time.
  setInterval(reobserveLand, 42000);
}

window.onload = initApp;
