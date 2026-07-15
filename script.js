// p11 E2Verse - Metaverse like Earth2
let balance = 1420;
let credits = 850;
let owned = JSON.parse(localStorage.getItem('p11_owned') || '[]');
let codex = JSON.parse(localStorage.getItem('p11_codex') || '[]');
let tileData = JSON.parse(localStorage.getItem('p11_tileData') || '{}'); // BIRTH state: vitality, builds[], aura (p6+p5+p9+p10 cross)
let map, currentTile;
const tileRects = {}; // tileId -> Leaflet rectangle, so sells can recolor the map

// All switchable views. showX() hides every view then reveals one.
const P11_VIEWS = ['map-view', 'estate-view', 'voice-view', 'live-view', 'notebook-view', 'magic-view'];

// === LAND VALUE ENGINE ===
// A tile's market value is DERIVED, not invented: base price grown by the same
// vitality/aura the mutation engine already tracks. Display == code, always.
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
  P11_VIEWS.forEach(v => {
    const el = document.getElementById(v);
    if (el) el.style.display = (v === id) ? 'block' : 'none';
  });
  // Highlight the nav button that opened this view (matches by onclick handler name).
  const handler = { 'map-view':'showMap', 'estate-view':'showEstate', 'voice-view':'showVoice',
                    'live-view':'showLive', 'notebook-view':'showNotebook', 'magic-view':'showMagic' }[id];
  document.querySelectorAll('nav button').forEach(b => {
    const attr = b.getAttribute('onclick') || '';
    b.classList.toggle('active', handler && attr.indexOf(handler) === 0);
  });
}

function connectWallet() {
  alert('Wallet connected (mock). p10 stable credits linked.');
}

function initMap() {
  map = L.map('map').setView([20, 0], 2);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OSM contributors | Virtual land only'
  }).addTo(map);

  // Demo tiles - in real would be dynamic grid
  const demoTiles = [
    {id:1, lat:37.5, lng:127, name:"Seoul Tile", price:50},
    {id:2, lat:40.7, lng:-74, name:"NYC Prime", price:120},
    {id:3, lat:51.5, lng:-0.1, name:"London", price:80},
    {id:4, lat:35.7, lng:139.7, name:"Tokyo", price:95}
  ];

  demoTiles.forEach(t => {
    const rect = L.rectangle([
      [t.lat-0.2, t.lng-0.2],
      [t.lat+0.2, t.lng+0.2]
    ], {color: owned.includes(t.id) ? '#c5a46e' : '#3a3124', weight:2}).addTo(map);
    tileRects[t.id] = rect;
    rect.bindTooltip(() => tileTooltip(t), {sticky:true});
    rect.on('click', () => buyTile(t, rect));
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
    alert('Already owned. Develop it.');
    return;
  }
  const cost = tile.price;
  if (credits < cost) {
    alert('Need more Harvest Credits. p10 bridge (legal framing).');
    return;
  }
  credits -= cost;
  owned.push(tile.id);
  localStorage.setItem('p11_owned', JSON.stringify(owned));
  if (rect) rect.setStyle({color: '#c5a46e'});

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

  // BIRTH 1 trigger — first mutation on claim
  const s = (window.getP6LungSurprise && window.getP6LungSurprise()) || 0.42;
  const boost = mutateTileFromCodex(tile.id, s, 0.28);
  addToCodex(`Claimed ${tile.name} for ${cost} Cr. Value now ${tileMarketValue(tile.id).toFixed(0)} Cr.`);
  updateUI();
  alert(`Bought ${tile.name} for ${cost} Cr!\nLive value: ${tileMarketValue(tile.id).toFixed(0)} Cr. Develop it to grow value.`);
}

function claimWithVoice() {
  if (!navigator.mediaDevices) {
    alert('Mic needed for p6 voice. Fallback claim.');
    return;
  }
  const status = document.getElementById('voice-status');
  status.textContent = 'Recording p6 Lung... speak your claim.';

  navigator.mediaDevices.getUserMedia({audio:true}).then(stream => {
    const rec = new MediaRecorder(stream);
    rec.ondataavailable = e => {
      // Simulate p6
      const surprise = (window.getP6LungSurprise && window.getP6LungSurprise()) || (Math.random() * 0.5 + 0.3);
      const ache = 0.25 + Math.random()*0.4; // 창발 pain
      status.textContent = `p6 Surprise: ${surprise.toFixed(2)}. Tile claimed with boost!`;

      // Auto buy + BIRTH 1 Codex Mutation
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
      const boost = mutateTileFromCodex(demo.id, surprise, ache);
      addToCodex(`Voice claimed ${demo.name} for ${paid} Cr. Value now ${tileMarketValue(demo.id).toFixed(0)} Cr.`);
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

// === FEATURE A: MY LAND (portfolio) ===
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
        <button onclick="castMagicOnTile(${id}, '${(name+'').replace(/'/g,'')}'); renderEstate();">🪄 Develop (+value)</button>
        <button class="sell-btn" onclick="sellTile(${id})">💱 Sell for ${value.toFixed(0)} Cr</button>
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

// === FEATURE B: TRADING (sell back to market) ===
// Sell realizes the tile's CURRENT market value into credits — the exact number
// shown in the portfolio (tileMarketValue), so gains/losses are honest. The tile
// leaves your holdings, the map recolors, and the trade is logged to the Codex.
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

  // Free the demo tile so it can be re-bought; recolor its rect back to unowned.
  if (tileRects[id]) tileRects[id].setStyle({ color: '#3a3124' });
  delete tileData[id];
  saveTileData();

  addToCodex(`Sold ${name} for ${value} Cr (paid ${paid}, ${gain >= 0 ? '+' : ''}${gain}). Traded on E2Verse market.`);
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
    liveDiv.innerHTML = `<h2>p9 Live in Metaverse</h2><p>Anchor live to your tile. p10 stable entry + surprise boosts permanent tile aura.</p>
    <button onclick="igniteTileRitual(${owned[0]}, 'OwnedTile')">🔥 Ignite Live Ritual on Owned Tile (p9+p10)</button>`;
  }
}

function showNotebook() {
  showView('notebook-view');
  const list = document.getElementById('codex');
  list.innerHTML = codex.length ? codex.map(c => `<div>${c}</div>`).join('') : '<p>No entries. Claim with voice.</p>';
  reobserveCodex(); // ALWAYS LEARNING: re-observe triggers tile value mutation
}

function addToCodex(text) {
  codex.unshift(text);
  if (codex.length > 10) codex.pop();
  localStorage.setItem('p11_codex', JSON.stringify(codex));
}

function updateUI() {
  const bal = document.getElementById('balance');
  if (bal) bal.textContent = `${balance} $EROS · ${credits} Credits`;
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

// BIRTH 1: ALWAYS LEARNING Codex Mutation — p6 surprise + 창발 pain (ache) mutates owned tile value/vitality
function mutateTileFromCodex(tileId, surprise, ache = 0.3) {
  if (!tileData[tileId]) tileData[tileId] = { vitality: 1.0, builds: [], aura: 0, name: 'Unknown' };
  const boost = surprise * (1 + ache * 0.9); // p6 Ache-Breath + p1 variable DNA
  tileData[tileId].vitality = (tileData[tileId].vitality || 1) + boost;
  tileData[tileId].aura = (tileData[tileId].aura || 0) + surprise * 0.5;
  saveTileData();
  return boost;
}

function reobserveCodex() {
  Object.keys(tileData).forEach(id => {
    const t = tileData[id];
    if (t.vitality > 1.2) {
      const drift = (Math.random() - 0.45) * 0.07; // 창발 self-mutation (no central)
      t.vitality *= (1 + drift);
      if (t.vitality < 0.6) t.vitality = 0.6;
    }
  });
  saveTileData();
  // Reflect autonomous value drift live if the user is watching their holdings.
  updateUI();
  const estate = document.getElementById('estate-view');
  if (estate && estate.style.display !== 'none') renderEstate();
}

// BIRTH 2: p5 Magic Builds — voice surprise casts emergent structures (p5 spell + p6 lung)
function castMagicOnTile(tileId, name) {
  if (!owned.includes(parseInt(tileId))) {
    alert('Own tile first');
    return;
  }
  const surprise = (window.getP6LungSurprise && window.getP6LungSurprise()) || (0.4 + Math.random()*0.5);
  const ache = 0.2 + Math.random() * 0.6; // 창발 pain fuels stronger spell
  const power = surprise * (1.1 + ache);

  if (!tileData[tileId]) tileData[tileId] = { vitality: 1, builds: [], aura: 0, name };
  const type = power > 0.75 ? 'Breath Spire' : (power > 0.45 ? 'Ache Obelisk' : 'Spore Bloom');
  tileData[tileId].builds.push({type, power: power.toFixed(2), at: Date.now()});
  tileData[tileId].vitality += power * 0.55;
  saveTileData();

  addToCodex(`p5 Magic: ${type} on ${name} — value now ${tileMarketValue(tileId).toFixed(0)} Cr (power ${power.toFixed(2)})`);
  updateUI();
  alert(`✨ ${type} emerged! Vitality +${(power*0.55).toFixed(2)}.\nTile value now ${tileMarketValue(tileId).toFixed(0)} Cr.`);
}

// BIRTH 3: p9/p10 Tile Ritual — live anchored to tile + stable credit entry + FOMO aura boost
function igniteTileRitual(tileId, name) {
  const surprise = (window.getP6LungSurprise && window.getP6LungSurprise()) || 0.5;
  const cost = Math.floor(7 + surprise * 14);
  if (credits < cost) { alert('p10 credits low. FOMO soon.'); return; }
  credits -= cost;
  updateUI();

  if (!tileData[tileId]) tileData[tileId] = { vitality: 1, builds: [], aura: 0, name };
  const boost = surprise * 1.3;
  tileData[tileId].aura = (tileData[tileId].aura || 0) + boost;
  tileData[tileId].vitality += boost * 0.4;
  saveTileData();

  addToCodex(`p9 Ritual on ${name} • p10 paid ${cost} Cr • aura+${boost.toFixed(2)} • value ${tileMarketValue(tileId).toFixed(0)} Cr`);
  updateUI();
  alert(`📡 Ritual live on ${name}! Aura +${boost.toFixed(2)}.\nTile value now ${tileMarketValue(tileId).toFixed(0)} Cr.`);
}

function showMagic() {
  showView('magic-view');
}

function demoCastMagic() {
  if (owned.length === 0) { alert('Claim a tile with voice first'); return; }
  const id = owned[0];
  castMagicOnTile(id, 'DemoTile');
}

function initP11() {
  updateUI();
  showView('map-view');
  setTimeout(() => {
    if (!window.mapInitialized) {
      initMap();
      window.mapInitialized = true;
    }
  }, 100);

  // p6 cross ready
  if (window.getP6LungSurprise) console.log('[p11] p6 Lung Surprise Eye connected');

  // ALWAYS LEARNING loop: Codex mutates tile value autonomously
  setInterval(reobserveCodex, 42000);

  console.log('[p11] 3 Emergent Births: 1.Codex Mutation 2.p5 Magic Builds 3.p9/p10 Tile Rituals. Legion one.');
}

// === NIOBE VIRAL CROSS: p20/21 Fate + p18 Meme Clip + p15 Glow + p16 → p11 metaverse aura/claim boost
function consumeCrossViralityToMetaverse() {
  let auraBoost = 0.1;
  try {
    const f = JSON.parse(localStorage.getItem('p20_fate_to_p11')||localStorage.getItem('p21_fate_to_p11')||'null');
    if (f) auraBoost += (f.relicPower||f.aura? 0.18:0.12);
    const clip = JSON.parse(localStorage.getItem('p18_clip_to_p11')||'null'); if(clip) auraBoost += clip.surprise*0.5 || 0.15;
    const glow = JSON.parse(localStorage.getItem('p15_voice_to_p11')||'null'); if(glow) auraBoost += 0.14;
    const ad = JSON.parse(localStorage.getItem('p16_ad_to_p11')||'null'); if(ad) auraBoost += 0.1;
  } catch(e){}
  return auraBoost;
}

// Hook into claim (if owned tiles)
const _oldClaim = window.claimTile || function(){};
window.claimTile = function(...a) { const b = consumeCrossViralityToMetaverse(); const r=_oldClaim.apply(this,a); if(r && typeof r==='object') r.vitality=(r.vitality||1)+b; return r; };

console.log('[p11] Cross virality consumer active (Destiny Duo + Meme UGC + Glow + Ad). Legion one.');

window.onload = initP11;