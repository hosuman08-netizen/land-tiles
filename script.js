// p11 E2Verse - Metaverse like Earth2
let balance = 1420;
let credits = 850;
let owned = JSON.parse(localStorage.getItem('p11_owned') || '[]');
let codex = JSON.parse(localStorage.getItem('p11_codex') || '[]');
let tileData = JSON.parse(localStorage.getItem('p11_tileData') || '{}'); // BIRTH state: vitality, builds[], aura (p6+p5+p9+p10 cross)
let map, currentTile;

// All switchable views. showX() hides every view then reveals one.
const P11_VIEWS = ['map-view', 'voice-view', 'live-view', 'notebook-view', 'magic-view'];

function showView(id) {
  P11_VIEWS.forEach(v => {
    const el = document.getElementById(v);
    if (el) el.style.display = (v === id) ? 'block' : 'none';
  });
  // Highlight the nav button that opened this view (matches by onclick handler name).
  const handler = { 'map-view':'showMap', 'voice-view':'showVoice', 'live-view':'showLive',
                    'notebook-view':'showNotebook', 'magic-view':'showMagic' }[id];
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
    rect.on('click', () => buyTile(t, rect));
  });
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
  rect.setStyle({color: '#c5a46e'});

  // BIRTH 1 trigger
  const s = (window.getP6LungSurprise && window.getP6LungSurprise()) || 0.42;
  const boost = mutateTileFromCodex(tile.id, s, 0.28);
  addToCodex(`Claimed ${tile.name} for ${cost} credits. p6 voice rec. Vitality +${boost.toFixed(2)}`);
  updateUI();
  alert(`Bought ${tile.name}! FOMO value. Codex mutated tile.`);
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
      credits -= 15;
      owned.push(demo.id);
      localStorage.setItem('p11_owned', JSON.stringify(owned));
      const boost = mutateTileFromCodex(demo.id, surprise, ache);
      addToCodex(`Voice claimed ${demo.name} surprise ${surprise.toFixed(2)} vitality+${boost.toFixed(2)}. p6 embodiment.`);
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
    hold.textContent = n === 0 ? '◇ 0 tiles owned' : `◆ ${n} tile${n > 1 ? 's' : ''} owned`;
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

  addToCodex(`p5 Magic: ${type} on ${name} (power ${power.toFixed(2)}, surprise ${surprise.toFixed(2)})`);
  alert(`✨ ${type} emerged! Tile vitality +${(power*0.55).toFixed(1)}`);
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

  addToCodex(`p9 Ritual on ${name} • p10 paid ${cost} • surprise ${surprise.toFixed(2)} • aura+${boost.toFixed(2)}`);
  alert(`📡 Ritual live on ${name}! Tile permanently mutated.`);
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