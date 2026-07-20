/* ============================================================================
   E2Verse — virtual land on a real-world map
   ----------------------------------------------------------------------------
   FICTIONAL SIMULATION. Not real property. Not an investment. No real money.
   Every counterparty ("agent") in this market is a deterministic NPC produced
   by the code below. Nothing here touches a blockchain, a bank, or a deed.

   DESIGN RULE — display == code:
   Every number a player sees is produced by a pure function of (tile id, world
   clock, player state). No Math.random() anywhere in a value, price, yield,
   rarity or market path. Reload the page and the same tile is worth the same.
   ========================================================================== */
'use strict';

/* ===========================================================================
   1. DETERMINISTIC CORE
   Hashing + seeded PRNG give every tile a stable identity forever.
   ========================================================================= */

// FNV-1a 32-bit. Same string -> same integer, on every device, every session.
function hash32(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

// mulberry32 — tiny, fast, well-distributed seeded PRNG.
function rngFor(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// One draw from a seeded stream — used when we need a single stable number.
function rand1(key) { return rngFor(hash32(key))(); }

// Weighted deterministic pick.
function pickWeighted(key, items, weights) {
  const r = rand1(key);
  const total = weights.reduce((a, b) => a + b, 0);
  let acc = 0;
  for (let i = 0; i < items.length; i++) {
    acc += weights[i] / total;
    if (r < acc) return items[i];
  }
  return items[items.length - 1];
}

function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

/* ---------------------------------------------------------------------------
   SIMULATED CLOCK — disclosed to the player, never hidden.
   1 simulated day = 4 real minutes, so a market cycle is legible in one sitting.
   Yields, rent, offer arrival and the value index all run on this clock.
------------------------------------------------------------------------------ */
const SIM_DAY_MS = 4 * 60 * 1000;
const SIM_HOUR_MS = SIM_DAY_MS / 24;
const EPOCH = Date.UTC(2026, 0, 1);

function simDay(t) { return Math.floor(((t === undefined ? Date.now() : t) - EPOCH) / SIM_DAY_MS); }
function simHours(t) { return ((t === undefined ? Date.now() : t) - EPOCH) / SIM_HOUR_MS; }

// World genesis, fixed. Used for supply growth so the curve is stable.
const GENESIS_DAY = simDay(Date.UTC(2026, 6, 20));
function worldAge(d) { return Math.max(0, d - GENESIS_DAY); }

/* ---------------------------------------------------------------------------
   MARKET INDEX — the one global price signal.
   A smooth multi-period cycle plus a small seeded daily shock. Mean ~1.00.
   Deterministic per sim-day: the chart you saw an hour ago still reads the same.
------------------------------------------------------------------------------ */
function marketIndex(d) {
  const cycle = 1
    + 0.155 * Math.sin(d / 23.5)
    + 0.075 * Math.sin(d / 7.13 + 1.3)
    + 0.035 * Math.sin(d / 3.01 + 2.7);
  const shock = (rand1('mkt|' + d) - 0.5) * 0.045;
  return +(cycle + shock).toFixed(5);
}

/* ===========================================================================
   2. WORLD MODEL — grid, hubs, tiers, sediment, resources, rarity
   ========================================================================= */

// The world is a fixed grid. Any lat/lng snaps to a 0.4° cell with a STABLE id.
const GRID = 0.4;

// Charter supply cap. Scarcity is a real number in the valuation, not a slogan.
const SUPPLY_CAP = 64000;

// A "claim block" holds N parcels; a parcel is 10m x 10m (Earth2-style unit).
const PARCEL_M2 = 100;

const HUBS = [
  { id: 'nyc',    name: 'New York',      lat:  40.7128, lng:  -74.0060, weight: 1.15, region: 'Manhattan Grid' },
  { id: 'tokyo',  name: 'Tokyo',         lat:  35.6762, lng:  139.6503, weight: 1.10, region: 'Kanto Plain' },
  { id: 'sf',     name: 'San Francisco', lat:  37.7749, lng: -122.4194, weight: 1.08, region: 'Bay Shore' },
  { id: 'london', name: 'London',        lat:  51.5074, lng:   -0.1278, weight: 1.05, region: 'Thames Bend' },
  { id: 'paris',  name: 'Paris',         lat:  48.8566, lng:    2.3522, weight: 1.02, region: 'Seine Left Bank' },
  { id: 'seoul',  name: 'Seoul',         lat:  37.5665, lng:  126.9780, weight: 1.00, region: 'Han Basin' },
  { id: 'dubai',  name: 'Dubai',         lat:  25.2048, lng:   55.2708, weight: 0.98, region: 'Gulf Crescent' },
  { id: 'sydney', name: 'Sydney',        lat: -33.8688, lng:  151.2093, weight: 0.95, region: 'Harbour Arc' },
  { id: 'sao',    name: 'Sao Paulo',     lat: -23.5505, lng:  -46.6333, weight: 0.92, region: 'Paulista Ridge' },
  { id: 'lagos',  name: 'Lagos',         lat:   6.5244, lng:    3.3792, weight: 0.90, region: 'Gulf of Guinea' }
];

// Otherside-style sediment: five ground types, each with its own card frame.
const SEDIMENTS = [
  { id: 'biogenic', name: 'Biogenic Swamp',  frame: '#6f8f5a', mult: 1.00 },
  { id: 'chemical', name: 'Chemical Goo',    frame: '#b08a3e', mult: 1.10 },
  { id: 'rainbow',  name: 'Rainbow Atmos',   frame: '#c2749b', mult: 1.24 },
  { id: 'cosmic',   name: 'Cosmic Dream',    frame: '#7e7ad0', mult: 1.42 },
  { id: 'infinite', name: 'Infinite Expanse', frame: '#d8c17a', mult: 1.65 }
];
const SEDIMENT_WEIGHTS = [40, 27, 18, 10, 5];

// Four replenishing resources, one per cardinal face of every claim block.
const RESOURCES = {
  anima: { name: 'Anima', color: '#c9a3e0', sym: '✦' },
  ore:   { name: 'Ore',   color: '#d09a72', sym: '◆' },
  shard: { name: 'Shard', color: '#7fb8d9', sym: '❖' },
  root:  { name: 'Root',  color: '#8fbf85', sym: '❀' }
};
const RES_KEYS = ['anima', 'ore', 'shard', 'root'];

// Land tier bands (Earth2-style T1S/T1/T2/T3): same coordinate, different class.
const TIERS = {
  T1S: { label: 'T1S', dots: 4, mult: 11.0, note: 'Charter class' },
  T1:  { label: 'T1',  dots: 3, mult: 4.20, note: 'Prime class' },
  T2:  { label: 'T2',  dots: 2, mult: 1.90, note: 'Standard class' },
  T3:  { label: 'T3',  dots: 1, mult: 1.00, note: 'Frontier class' }
};

function cellOf(lat, lng) {
  const gLat = clamp(Math.round(lat / GRID) * GRID, -84, 84);
  let l = lng;
  while (l > 180) l -= 360;
  while (l < -180) l += 360;
  const gLng = Math.round(l / GRID) * GRID;
  return {
    id: 'c_' + Math.round(gLat * 10) + '_' + Math.round(gLng * 10),
    lat: +gLat.toFixed(4),
    lng: +gLng.toFixed(4)
  };
}
function cellLatLng(id) {
  const m = /^c_(-?\d+)_(-?\d+)$/.exec(id);
  if (!m) return null;
  return { lat: +(+m[1] / 10).toFixed(4), lng: +(+m[2] / 10).toFixed(4) };
}
function neighborIds(id) {
  const p = cellLatLng(id);
  if (!p) return [];
  return [
    cellOf(p.lat + GRID, p.lng).id,
    cellOf(p.lat - GRID, p.lng).id,
    cellOf(p.lat, p.lng + GRID).id,
    cellOf(p.lat, p.lng - GRID).id
  ];
}

// Great-circle distance, km. Location premium must decay over real distance.
function haversineKm(aLat, aLng, bLat, bLng) {
  const R = 6371;
  const dLat = (bLat - aLat) * Math.PI / 180;
  const dLng = (bLng - aLng) * Math.PI / 180;
  const s = Math.sin(dLat / 2) ** 2 +
    Math.cos(aLat * Math.PI / 180) * Math.cos(bLat * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

function nearestHub(lat, lng) {
  let best = null, bestKm = Infinity;
  for (const h of HUBS) {
    const km = haversineKm(lat, lng, h.lat, h.lng);
    if (km < bestKm) { bestKm = km; best = h; }
  }
  return { hub: best, km: bestKm };
}

/* Location factor — exponential distance decay to the nearest hub.
   Grounded in the hedonic finding that distance to landmarks explains price
   even in a world with teleportation: visitor spillover is local. */
function locationFactor(lat, lng) {
  const n = nearestHub(lat, lng);
  const decay = Math.exp(-n.km / 320);
  return { f: 1 + n.hub.weight * 5.4 * decay, hub: n.hub, km: n.km };
}

function cellName(lat, lng) {
  const ns = lat >= 0 ? 'N' : 'S';
  const ew = lng >= 0 ? 'E' : 'W';
  return 'Parcel ' + Math.abs(lat).toFixed(1) + '°' + ns + ', ' + Math.abs(lng).toFixed(1) + '°' + ew;
}

/* ---------------------------------------------------------------------------
   TILE TRAITS — the full rarity data model. Pure function of the cell id.
------------------------------------------------------------------------------ */
const metaCache = new Map();

function cellMeta(id) {
  if (metaCache.has(id)) return metaCache.get(id);
  const p = cellLatLng(id);
  if (!p) return null;

  const loc = locationFactor(p.lat, p.lng);

  // Tier: mostly location, with a stable slice of luck so hub-adjacent land
  // is not automatically top class and frontier land can still surprise.
  const tierRoll = rand1('tier|' + id);
  const tierScore = (loc.f - 1) / 6.4 + tierRoll * 0.28;
  const tier = tierScore > 0.80 ? 'T1S' : tierScore > 0.50 ? 'T1' : tierScore > 0.22 ? 'T2' : 'T3';

  const sediment = pickWeighted('sed|' + id, SEDIMENTS, SEDIMENT_WEIGHTS);

  // Four cardinal resources, each with its own rarity tier 1..3.
  const dirs = ['N', 'E', 'S', 'W'];
  const resources = dirs.map(function (d) {
    const k = RES_KEYS[Math.floor(rand1('res|' + id + '|' + d) * 4) % 4];
    const rt = pickWeighted('rt|' + id + '|' + d, [1, 2, 3], [62, 28, 10]);
    return { dir: d, key: k, tier: rt };
  });

  // Artifact ("Relic") on roughly 10% of blocks, like Otherside's Koda.
  const hasArtifact = rand1('art|' + id) < 0.10;
  const artifact = hasArtifact ? {
    name: pickWeighted('artn|' + id,
      ['Sunken Codex', 'Ashfall Beacon', 'Drift Anchor', 'Vitruvian Arch', 'Echo Lantern'],
      [30, 25, 20, 15, 10]),
    tier: pickWeighted('artt|' + id, [1, 2, 3], [55, 32, 13])
  } : null;

  // Size: a claim block holds 1..4 parcels of 10m x 10m.
  const parcels = 1 + Math.floor(rand1('sz|' + id) * 4);

  // Memorability: hub-bearing blocks and round coordinates are easier to
  // remember, and memorability is a documented driver of virtual land price.
  const isHubBlock = loc.km < 30;
  const roundCoord = (Math.abs(Math.round(p.lat * 10)) % 100 === 0) && (Math.abs(Math.round(p.lng * 10)) % 100 === 0);
  const memorability = 1 * (isHubBlock ? 1.50 : 1) * (roundCoord ? 1.12 : 1);

  const resMult = 1 + resources.reduce(function (s, r) { return s + (r.tier - 1) * 0.07; }, 0);
  const artMult = artifact ? 1 + 0.12 * artifact.tier : 1;
  const rarityMult = sediment.mult * resMult * artMult;

  // Composite rarity score 0..100, purely for display ranking.
  const rarityScore = Math.round(clamp(
    (TIERS[tier].dots / 4) * 42 +
    ((sediment.mult - 1) / 0.65) * 26 +
    ((resMult - 1) / 0.84) * 20 +
    (artifact ? 6 + artifact.tier * 2 : 0), 0, 100));

  const meta = {
    id: id,
    lat: p.lat,
    lng: p.lng,
    name: isHubBlock ? (loc.hub.name + ' Core') : cellName(p.lat, p.lng),
    hub: loc.hub,
    km: loc.km,
    locF: loc.f,
    tier: tier,
    sediment: sediment,
    resources: resources,
    artifact: artifact,
    parcels: parcels,
    areaM2: parcels * PARCEL_M2,
    memorability: memorability,
    rarityMult: rarityMult,
    rarityScore: rarityScore,
    region: loc.hub.region
  };
  metaCache.set(id, meta);
  return meta;
}

/* ---------------------------------------------------------------------------
   OWNERSHIP OF THE REST OF THE WORLD.
   Cells the player does not hold still have a state, so the map can show
   "never minted" vs "held by an agent" vs "for sale" vs "leased".
   Virgin (never-minted) land is the frontier premium Upland's mint creates.
------------------------------------------------------------------------------ */
const AGENT_NAMES = ['Kestrel', 'Vantah', 'Orino', 'Delve', 'Mirrow', 'Solaz', 'Corvid', 'Halcy',
  'Nyx Holdings', 'Bramble Co', 'Tessera', 'Ferro Group', 'Aurel', 'Nine Rivers'];

function baseCellState(id) {
  const r = rand1('own|' + id);
  if (r < 0.55) return 'virgin';   // never owned by anyone — mint premium
  if (r < 0.88) return 'held';     // an agent holds it, not for sale
  if (r < 0.96) return 'listed';   // an agent has it on the market
  return 'leased';                 // an agent has it out on lease
}
function agentFor(id) {
  return AGENT_NAMES[Math.floor(rand1('agent|' + id) * AGENT_NAMES.length) % AGENT_NAMES.length];
}

/* ===========================================================================
   3. PERSISTENT STATE
   ========================================================================= */

const LS = {
  owned: 'p11_owned',
  tiles: 'p11_tileData',
  ledger: 'p11_ledger',
  wallet: 'p11_wallet',
  market: 'p11_market'
};

function load(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) { return fallback; }
}
function save(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { /* quota */ }
}

// Legacy migration: ids were sometimes numbers, ledger entries plain strings.
let owned = (load(LS.owned, []) || []).map(String);
let tileData = load(LS.tiles, {}) || {};
let ledger = (load(LS.ledger, []) || []).map(function (e) {
  return typeof e === 'string' ? { t: Date.now(), text: e, kind: 'note' } : e;
});

/* Two currencies with two distinct jobs — the header states both:
   CREDITS (Cr) = the trading currency. Buy land, receive rent, settle sales.
   GEMS   (◇) = build-hours. Committed while a structure rises, then RETURNED
                in full on completion. Gems are never destroyed; they are tied up.
   That is the whole point: time pressure without loss. */
const wallet = Object.assign({ credits: 850, gems: 1420, gemsLocked: 0, escrow: 0, linked: false },
  load(LS.wallet, {}) || {});

const market = Object.assign({
  myListings: {},     // tileId -> {ask, expiresDay, acceptCredit, acceptSwap, listedAt, resolved:[]}
  myBids: [],         // {id, tileId, amount, placedAt, status}
  boughtFromAgents: [], // agent-listed tile ids the player has purchased
  soldToAgents: [],   // tile ids the player has sold back into the market
  collections: {},    // regionId -> {claimedAt}
  treasures: {},      // 'sector|day' -> true once collected
  jewelsSold: {},     // 'tileId|day' -> true
  jewelsHeld: [],     // {tileId, day, kind, grade}
  lastTick: 0
}, load(LS.market, {}) || {});


/* ── 5H retention loop (land-tiles sim) ───────────────────── */
function ltDayKey(off){const d=new Date();d.setDate(d.getDate()+(off||0));return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');}
function bumpLtStreak(kind){
  try{
    let st=JSON.parse(localStorage.getItem('lt_streak')||'{}');
    const t0=ltDayKey(0);
    if(st.last!==t0){
      const y=ltDayKey(-1), y2=ltDayKey(-2);
      if(st.last&&st.last!==y&&st.last===y2&&(st.count||0)>=3){
        const ready=!st.shieldLast||((new Date(t0)-new Date(st.shieldLast))/86400000)>=7;
        if(ready){st.shieldLast=t0;st.last=y;try{legionTrack('streak_freeze',{count:st.count})}catch(e){}}
      }
      st.count=(st.last===y)?(st.count||0)+1:1; st.last=t0;
      localStorage.setItem('lt_streak',JSON.stringify(st));
      try{legionTrack('streak',{count:st.count,kind:kind||'act'})}catch(e){}
    }
    const k='lt_day_'+t0; let day=JSON.parse(localStorage.getItem(k)||'{"buys":0,"bids":0}');
    if(kind==='buy') day.buys=(day.buys||0)+1;
    if(kind==='bid') day.bids=(day.bids||0)+1;
    localStorage.setItem(k,JSON.stringify(day));
    renderLtLoop();
  }catch(e){}
}
function renderLtLoop(){
  try{
    let el=document.getElementById('ltLoop');
    if(!el){
      el=document.createElement('div'); el.id='ltLoop';
      el.style.cssText='margin:8px 12px;padding:10px;border:1px solid #2a2438;border-radius:12px;font-size:12px;display:flex;flex-wrap:wrap;gap:8px;align-items:center;background:#0e1218';
      const host=document.querySelector('header')||document.querySelector('h1')||document.body;
      host.insertAdjacentElement('afterend', el);
    }
    const st=JSON.parse(localStorage.getItem('lt_streak')||'{}');
    const day=JSON.parse(localStorage.getItem('lt_day_'+ltDayKey(0))||'{}');
    const end=new Date(); end.setHours(24,0,0,0);
    const ms=Math.max(0,end-Date.now());
    const clock=Math.floor(ms/3600000)+'h '+Math.floor((ms%3600000)/60000)+'m';
    const own=(typeof owned!=='undefined'&&owned)?owned.length:0;
    el.innerHTML='<span>🔥 '+(st.count||0)+'d</span><span>today buy '+(day.buys||0)+'</span><span>bid '+(day.bids||0)+'</span><span>owned '+own+'</span><span>reset '+clock+'</span>'
      +'<button type="button" id="ltShare" style="margin-left:auto;padding:6px 10px;border:0;border-radius:8px;background:#1c1826;color:#ece8f1">share</button>'
      +'<span style="opacity:.65;font-size:11px">fictional land sim · not real estate</span>';
    const b=document.getElementById('ltShare');
    if(b) b.onclick=function(){
      const text='Land Tiles sim · 🔥'+(st.count||0)+'d · owned '+own+' · https://hosuman08-netizen.github.io/land-tiles/\nFICTIONAL ONLY';
      if(navigator.share) navigator.share({text}).catch(function(){});
      else if(navigator.clipboard) navigator.clipboard.writeText(text);
      try{legionTrack('share_peak',{})}catch(e){}
    };
  }catch(e){}
}

function saveAll() {
  save(LS.owned, owned);
  save(LS.tiles, tileData);
  save(LS.ledger, ledger.slice(0, 40));
  save(LS.wallet, wallet);
  save(LS.market, market);
}
function saveTileData() { save(LS.tiles, tileData); }

function isOwned(id) { return owned.indexOf(String(id)) !== -1; }

/* ===========================================================================
   4. VALUATION ENGINE — the NLV (Net Land Value)
   One headline number, and a full breakdown behind it. Nothing is hidden:
   every multiplier below is shown to the player in the tile panel.
   ========================================================================= */

const BASE_PARCEL_CR = 6;

// Claimed supply grows on a saturating curve toward the charter cap.
function claimedSupply(d) {
  const age = worldAge(d);
  const agents = SUPPLY_CAP * (0.29 + 0.55 * (1 - Math.exp(-age / 9000)));
  return Math.min(SUPPLY_CAP, Math.round(agents) + owned.length);
}
function scarcityFactor(d) {
  return 1 + 0.6 * (claimedSupply(d) / SUPPLY_CAP);
}

/* Estate: a maximally-connected run of owned cells sharing an edge.
   Decentraland's rule — parcels must be adjacent, nothing may split them.
   Bigger contiguous blocks are worth more per cell. */
let estateCache = null;
function estates() {
  if (estateCache) return estateCache;
  const set = new Set(owned);
  const seen = new Set();
  const out = [];
  owned.forEach(function (id) {
    if (seen.has(id)) return;
    const stack = [id], group = [];
    seen.add(id);
    while (stack.length) {
      const cur = stack.pop();
      group.push(cur);
      neighborIds(cur).forEach(function (n) {
        if (set.has(n) && !seen.has(n)) { seen.add(n); stack.push(n); }
      });
    }
    out.push(group);
  });
  estateCache = out;
  return out;
}
function invalidateDerived() { estateCache = null; valueCache.clear(); }

function estateOf(id) {
  const all = estates();
  for (const g of all) if (g.indexOf(id) !== -1) return g;
  return null;
}
function estateFactor(id) {
  const g = estateOf(id);
  if (!g || g.length < 2) return 1;
  return 1 + Math.min(0.42, 0.07 * (g.length - 1));
}

/* Collections: hold N blocks inside a hub region and the whole set earns more.
   Upland's model — a one-off bonus after a hold period, plus a standing
   multiplier while the set stays intact. */
const COLLECTION_RADIUS_KM = 900;
const COLLECTION_TIERS = [
  { need: 3, yieldMult: 1.15, bonusGems: 300, holdDays: 2 },
  { need: 6, yieldMult: 1.40, bonusGems: 900, holdDays: 3 }
];

function regionHoldings(hubId) {
  const hub = HUBS.filter(function (h) { return h.id === hubId; })[0];
  if (!hub) return [];
  return owned.filter(function (id) {
    const m = cellMeta(id);
    return m && haversineKm(m.lat, m.lng, hub.lat, hub.lng) <= COLLECTION_RADIUS_KM;
  });
}
function collectionState(hubId) {
  const held = regionHoldings(hubId);
  let active = null;
  for (const t of COLLECTION_TIERS) if (held.length >= t.need) active = t;
  const next = COLLECTION_TIERS.filter(function (t) { return held.length < t.need; })[0] || null;
  return { held: held, count: held.length, active: active, next: next, claimed: !!market.collections[hubId] };
}
function collectionFactor(id) {
  const m = cellMeta(id);
  if (!m) return 1;
  const st = collectionState(m.hub.id);
  return st.active ? st.active.yieldMult : 1;
}

/* ---------------------------------------------------------------------------
   REGIONAL DEMAND — a deterministic field over the ten value hubs.
   The valuation already prices *distance* to a hub (locationFactor). Demand
   adds the dimension a real land market has: *time*. Each hub runs hot or cool
   on a slow, fully-seeded drift, lifted by global scarcity and by your own
   footprint in its region. It is discovery + display only — it never feeds NLV,
   so appraisals stay anchored in fundamentals and the two never quietly entangle.
------------------------------------------------------------------------------ */
const DEMAND_BANDS = [
  { max: 0.40, key: 'cool',    label: 'Cool',    color: '#6f8196' },
  { max: 0.60, key: 'steady',  label: 'Steady',  color: '#9a8f6a' },
  { max: 0.80, key: 'warm',    label: 'Warm',    color: '#c5a46e' },
  { max: 1.01, key: 'surging', label: 'Surging', color: '#e8cf94' }
];
function demandBand(temp) {
  for (const b of DEMAND_BANDS) if (temp <= b.max) return b;
  return DEMAND_BANDS[DEMAND_BANDS.length - 1];
}
// The raw field at a hub on a given day — pure function of (hub, day, holdings).
function demandTemp(hub, day) {
  const ph = rand1('hubphase|' + hub.id) * Math.PI * 2;
  // Two out-of-phase slow waves make a believable multi-day cycle, fully seeded.
  const drift = 0.5 + 0.30 * Math.sin(day / 6 + ph) + 0.14 * Math.sin(day / 2.3 + ph * 1.7);
  const weightTilt = clamp((hub.weight - 0.90) / 0.25, 0, 1);   // prime hubs run hotter
  const scar = claimedSupply(day) / SUPPLY_CAP;                 // the whole market tightening
  const mine = owned.length ? regionHoldings(hub.id).length : 0;
  const ownLift = Math.min(0.16, mine * 0.05);                  // your own region heats up
  return { temp: clamp(0.14 + 0.30 * drift + 0.26 * weightTilt + 0.16 * scar + ownLift, 0, 1), mine: mine };
}
function hubDemand(hub, d) {
  const day = d === undefined ? simDay() : d;
  const now = demandTemp(hub, day);
  const prev = demandTemp(hub, Math.max(GENESIS_DAY, day - 7)).temp;  // honest 7-day trend
  return { temp: now.temp, band: demandBand(now.temp), delta: now.temp - prev, mine: now.mine };
}

// Value cache keyed by tile+day so portfolio loops stay cheap.
const valueCache = new Map();
let cachedDay = -1;

/* The valuation. Returns the number AND the reasons for it. */
function valuate(id, d) {
  const day = d === undefined ? simDay() : d;
  if (day !== cachedDay) { valueCache.clear(); cachedDay = day; }
  const key = id + '|' + day;
  if (valueCache.has(key)) return valueCache.get(key);

  const m = cellMeta(id);
  if (!m) return { nlv: 0, parts: [] };

  const t = tileData[id] || {};
  const mine = isOwned(id);

  const base = BASE_PARCEL_CR * m.parcels;
  const vitality = mine ? (t.vitality || 1) : 1;
  const aura = mine ? (t.aura || 0) : 0;
  const popularity = vitality * (1 + aura * 0.30);
  const est = mine ? estateFactor(id) : 1;
  const coll = mine ? collectionFactor(id) : 1;
  const scar = scarcityFactor(day);
  const mkt = marketIndex(day);

  const nlv = base * m.locF * TIERS[m.tier].mult * m.rarityMult * m.memorability
    * popularity * est * coll * scar * mkt;

  const parts = [
    { label: 'Base (' + m.parcels + ' parcel' + (m.parcels > 1 ? 's' : '') + ' × ' + BASE_PARCEL_CR + ' Cr)', val: base, unit: 'Cr' },
    { label: 'Location — ' + Math.round(m.km) + ' km from ' + m.hub.name, mult: m.locF },
    { label: 'Land tier ' + m.tier + ' (' + TIERS[m.tier].note + ')', mult: TIERS[m.tier].mult },
    { label: 'Rarity — ' + m.sediment.name + (m.artifact ? ' + ' + m.artifact.name : ''), mult: m.rarityMult },
    { label: 'Memorability', mult: m.memorability },
    { label: 'Popularity — vitality ' + vitality.toFixed(2) + ', aura ' + aura.toFixed(2), mult: popularity },
    { label: 'Estate adjacency' + (mine && estateOf(id) ? ' (' + estateOf(id).length + ' blocks)' : ''), mult: est },
    { label: 'Collection set', mult: coll },
    { label: 'Scarcity — ' + claimedSupply(day).toLocaleString() + ' / ' + SUPPLY_CAP.toLocaleString() + ' claimed', mult: scar },
    { label: 'Market index (sim-day ' + day + ')', mult: mkt }
  ];

  const res = { nlv: nlv, parts: parts, meta: m };
  valueCache.set(key, res);
  return res;
}
function nlv(id) { return valuate(id).nlv; }
function portfolioValue() { return owned.reduce(function (s, id) { return s + nlv(id); }, 0); }

/* Value history. Owned tiles record real snapshots each sim-day; days with no
   snapshot are filled by re-indexing today's fundamentals with that day's
   market index. The chart labels which is which — no invented trades. */
function valueSeries(id, days) {
  const n = days || 30;
  const today = simDay();
  const t = tileData[id] || {};
  const hist = {};
  (t.hist || []).forEach(function (p) { hist[p[0]] = p[1]; });
  const cur = valuate(id, today);
  const curIdx = marketIndex(today) || 1;
  const out = [];
  for (let k = n - 1; k >= 0; k--) {
    const d = today - k;
    // Today is ALWAYS the live valuation, never a stale snapshot: the last point
    // of every chart must equal the NLV printed next to it.
    if (d === today) out.push({ d: d, v: cur.nlv, real: true });
    else if (hist[d] !== undefined) out.push({ d: d, v: hist[d], real: true });
    else out.push({ d: d, v: cur.nlv * (marketIndex(d) / curIdx), real: false });
  }
  return out;
}
function change30d(id) {
  const s = valueSeries(id, 30);
  const a = s[0].v, b = s[s.length - 1].v;
  return a > 0 ? ((b - a) / a) * 100 : 0;
}
function portfolioSeries(days) {
  const n = days || 30;
  const today = simDay();
  const out = [];
  for (let k = n - 1; k >= 0; k--) {
    const d = today - k;
    let sum = 0;
    owned.forEach(function (id) {
      const t = tileData[id] || {};
      const hist = (t.hist || []).filter(function (p) { return p[0] === d; })[0];
      if (d === today) sum += valuate(id, today).nlv;      // live, matches the header
      else if (hist) sum += hist[1];
      else sum += valuate(id, today).nlv * (marketIndex(d) / (marketIndex(today) || 1));
    });
    out.push({ d: d, v: sum });
  }
  return out;
}

/* ===========================================================================
   5. OWNERSHIP STATE MACHINE
   A block is in exactly one state. Transitions are guarded so the simulation
   cannot contradict itself (no selling a leased block, no double-listing).
   ========================================================================= */
function tileState(id) {
  const t = tileData[id];
  if (!t) return 'none';
  if (t.build && Date.now() < t.build.endsAt) return 'developing';
  if (t.rental && t.rental.tenantName) return 'leased';
  if (t.rental) return 'rent-listed';
  if (market.myListings[id]) return 'listed';
  return 'idle';
}
const STATE_LABEL = {
  idle: 'Idle', developing: 'Under construction', leased: 'Leased out',
  'rent-listed': 'Offered for lease', listed: 'Listed for sale', none: '—'
};
function guard(id, action) {
  const s = tileState(id);
  const rules = {
    sell:    { ok: ['idle'], why: 'Recall the block first — a listed, leased or building block cannot be sold.' },
    list:    { ok: ['idle'], why: 'Only an idle block can be listed for sale.' },
    rent:    { ok: ['idle'], why: 'Only an idle block can be offered for lease.' },
    develop: { ok: ['idle', 'listed', 'rent-listed', 'leased'], why: 'A block already under construction cannot start another build.' }
  };
  const r = rules[action];
  if (!r) return { ok: true };
  return r.ok.indexOf(s) !== -1 ? { ok: true } : { ok: false, why: r.why, state: s };
}

/* ===========================================================================
   6. YIELD — resources, jewels, lease income
   Every stream accrues from a timestamp, so it is exact and survives reload.
   ========================================================================= */

const RES_CAP_HOURS = 48;          // reservoir fills in 48 sim-hours, then idles
function resourceRate(id) {        // units per sim-hour
  const m = cellMeta(id);
  if (!m) return 0;
  const tierSum = m.resources.reduce(function (s, r) { return s + r.tier; }, 0);
  return +(tierSum * 0.34 * collectionFactor(id)).toFixed(3);
}
function pendingResources(id) {
  const t = tileData[id];
  if (!t) return { units: 0, pct: 0, byKind: {} };
  const last = t.lastHarvest || t.boughtAt || Date.now();
  const hrs = Math.min(RES_CAP_HOURS, (Date.now() - last) / SIM_HOUR_MS);
  const units = resourceRate(id) * hrs;
  const m = cellMeta(id);
  const byKind = {};
  if (m) {
    const tierSum = m.resources.reduce(function (s, r) { return s + r.tier; }, 0) || 1;
    m.resources.forEach(function (r) {
      byKind[r.key] = (byKind[r.key] || 0) + units * (r.tier / tierSum);
    });
  }
  return { units: units, pct: hrs / RES_CAP_HOURS, byKind: byKind, hrs: hrs };
}
function totalPendingResources() {
  return owned.reduce(function (s, id) { return s + pendingResources(id).units; }, 0);
}
const RESOURCE_CR = 0.55;          // settlement rate, units -> Credits
function harvestAll() {
  let units = 0;
  owned.forEach(function (id) {
    const p = pendingResources(id);
    if (p.units <= 0.01) return;
    units += p.units;
    tileData[id].lastHarvest = Date.now();
  });
  if (units <= 0.01) { toast('Nothing has accrued yet.', 'warn'); return; }
  const cr = Math.round(units * RESOURCE_CR);
  wallet.credits += cr;
  addToLedger('Harvested ' + units.toFixed(1) + ' resource units across ' + owned.length + ' block(s) → +' + cr + ' Cr.', 'yield');
  saveAll(); invalidateDerived(); updateUI(); renderVault();
  toast('Harvest settled: +' + cr + ' Cr', 'good');
}

/* Jewels: one may surface on a block each sim-day and it decays after 7 sim-days.
   Whether a jewel appears is fixed per (block, day) — unknown in advance,
   identical on every reload. That is a real variable-ratio schedule, not a fake. */
const JEWEL_KINDS = ['Amber Core', 'Pale Quartz', 'Tide Opal', 'Iron Bloom', 'Dusk Garnet', 'Solar Beryl'];
const JEWEL_LIFE_DAYS = 7;
function jewelOn(id, d) {
  const m = cellMeta(id);
  if (!m) return null;
  const chance = 0.16 + (TIERS[m.tier].dots - 1) * 0.07;
  if (rand1('jew|' + id + '|' + d) >= chance) return null;
  const kind = JEWEL_KINDS[Math.floor(rand1('jk|' + id + '|' + d) * JEWEL_KINDS.length) % JEWEL_KINDS.length];
  const grade = pickWeighted('jg|' + id + '|' + d, [1, 2, 3], [60, 30, 10]);
  return { tileId: id, day: d, kind: kind, grade: grade, value: Math.round((8 + grade * 11) * TIERS[m.tier].mult / 2) };
}
function liveJewels() {
  const today = simDay();
  const out = [];
  owned.forEach(function (id) {
    const t = tileData[id];
    const from = Math.max(today - JEWEL_LIFE_DAYS + 1, t && t.boughtAt ? simDay(t.boughtAt) : today - JEWEL_LIFE_DAYS + 1);
    for (let d = from; d <= today; d++) {
      if (market.jewelsSold[id + '|' + d]) continue;
      const j = jewelOn(id, d);
      if (j) { j.expiresIn = JEWEL_LIFE_DAYS - (today - d); out.push(j); }
    }
  });
  return out.sort(function (a, b) { return a.expiresIn - b.expiresIn; });
}

/* Lease. Decentraland's rule is enforced: a leased block cannot be sold and
   cannot receive purchase offers until it is recalled. */
function suggestedRent(id) { return Math.max(1, +(nlv(id) * 0.012).toFixed(1)); }
function rentBand(id) {
  const s = suggestedRent(id);
  return { lo: +(s * 0.33).toFixed(1), hi: +(s * 2.1).toFixed(1), mid: s };
}
function tenantArrivalHours(id, rate) {
  const s = suggestedRent(id) || 1;
  const ratio = rate / s;
  const base = 3 + 42 * Math.pow(clamp(ratio, 0.2, 2.4), 2.6);
  const jitter = 0.7 + rand1('ten|' + id + '|' + Math.round(rate * 10)) * 0.6;
  return clamp(base * jitter, 2, 260);
}
function refreshRentals() {
  let changed = false;
  owned.forEach(function (id) {
    const t = tileData[id];
    if (!t || !t.rental) return;
    const r = t.rental;
    if (!r.tenantName) {
      const due = r.listedAt + tenantArrivalHours(id, r.rate) * SIM_HOUR_MS;
      if (Date.now() >= due) {
        r.tenantName = agentFor(id + '|tenant|' + r.listedAt);
        r.startedAt = due;
        r.paidThrough = simDay(due);
        r.termDays = 5 + Math.floor(rand1('term|' + id + '|' + r.listedAt) * 10);
        addToLedger('Tenant ' + r.tenantName + ' leased ' + tName(id) + ' at ' + r.rate + ' Cr/sim-day.', 'lease');
        changed = true;
      }
    } else {
      const nowDay = simDay();
      const endDay = r.paidThrough === undefined ? nowDay : r.paidThrough;
      const daysDue = Math.max(0, Math.min(nowDay, simDay(r.startedAt) + r.termDays) - endDay);
      if (daysDue > 0) {
        r.pending = (r.pending || 0) + daysDue * r.rate;
        r.paidThrough = endDay + daysDue;
        changed = true;
      }
      if (nowDay >= simDay(r.startedAt) + r.termDays) {
        r.expired = true;
      }
    }
  });
  if (changed) saveTileData();
}
function collectRent() {
  let cr = 0;
  owned.forEach(function (id) {
    const t = tileData[id];
    if (t && t.rental && t.rental.pending) { cr += t.rental.pending; t.rental.pending = 0; }
  });
  cr = Math.round(cr);
  if (cr <= 0) { toast('No lease income has accrued yet.', 'warn'); return; }
  wallet.credits += cr;
  addToLedger('Collected ' + cr + ' Cr in lease income.', 'lease');
  saveAll(); updateUI(); renderVault();
  toast('Lease income collected: +' + cr + ' Cr', 'good');
}

/* ===========================================================================
   7. BUILDING — Gems are committed, not consumed
   Upland's Spark model: the resource is locked for the build duration and
   returned in full on completion. Time pressure with zero loss.
   ========================================================================= */
const BLUEPRINTS = {
  garden:   { name: 'Garden',   gems: 60,  hours: 6,  vit: 0.22, icon: '❀' },
  monument: { name: 'Monument', gems: 180, hours: 18, vit: 0.62, icon: '◈' },
  tower:    { name: 'Tower',    gems: 420, hours: 48, vit: 1.45, icon: '▲' }
};
function availableGems() { return wallet.gems - wallet.gemsLocked; }
function startBuild(id, key) {
  const bp = BLUEPRINTS[key];
  if (!bp) return;
  const g = guard(id, 'develop');
  if (!g.ok) { toast(g.why, 'warn'); return; }
  if (availableGems() < bp.gems) {
    toast('Need ' + bp.gems + ' free Gems — you have ' + availableGems() + ' (' + wallet.gemsLocked + ' committed).', 'warn');
    return;
  }
  // Voice energy from the last claim gives a permanent build bonus on that block.
  const voice = (tileData[id] && tileData[id].voiceEnergy) || 0;
  const boost = 1 + voice * 0.6;
  wallet.gemsLocked += bp.gems;
  tileData[id].build = {
    key: key, gems: bp.gems, startedAt: Date.now(),
    endsAt: Date.now() + bp.hours * SIM_HOUR_MS, vit: bp.vit * boost
  };
  addToLedger('Committed ' + bp.gems + ' Gems to a ' + bp.name + ' on ' + tName(id) + '. Gems return on completion.', 'build');
  saveAll(); invalidateDerived(); updateUI(); renderAll();
  toast(bp.gems + ' Gems committed · ' + bp.name + ' rising', 'good');
}
function collectBuild(id) {
  const t = tileData[id];
  if (!t || !t.build || Date.now() < t.build.endsAt) return;
  const b = t.build;
  const bp = BLUEPRINTS[b.key];
  wallet.gemsLocked = Math.max(0, wallet.gemsLocked - b.gems);
  t.vitality = (t.vitality || 1) + b.vit;
  t.builds = t.builds || [];
  t.builds.push({ type: bp.name, vit: +b.vit.toFixed(3), at: Date.now() });
  delete t.build;
  addToLedger(bp.name + ' completed on ' + tName(id) + '. ' + b.gems + ' Gems returned · vitality +' + b.vit.toFixed(2) + '.', 'build');
  saveAll(); invalidateDerived(); updateUI(); renderAll();
  toast(bp.name + ' complete · ' + b.gems + ' Gems returned', 'good');
}

/* ===========================================================================
   8. SECONDARY MARKET — agent listings, offers, escrow, bids
   Prices here come from agent demand, not from the valuation formula. That is
   the point: NLV is an appraisal, the market is what someone will actually pay.
   ========================================================================= */

/* Every block whose base state is "listed" carries a real, standing ask.
   That is what makes the green map layer honest: if a cell reads "for sale",
   you can open it and buy it at the price shown. The order book below is just
   a curated daily feed of the best-priced ones, not a separate universe. */
function askFor(id, d) {
  const day = d === undefined ? simDay() : d;
  // Ask drifts each sim-day between a 12% discount and a 38% markup on appraisal.
  const mult = 0.88 + rand1('ask|' + id + '|' + day) * 0.50;
  const v = valuate(id, day).nlv;
  return { ask: Math.max(1, Math.round(v * mult)), nlv: v, spread: mult - 1, seller: agentFor(id) };
}
function isBuyable(id) {
  return !isOwned(id) && baseCellState(id) === 'listed' &&
    market.boughtFromAgents.indexOf(id) === -1 && market.soldToAgents.indexOf(id) === -1;
}

// The daily order book: the keenest asks currently standing near the hubs.
function agentListings(d) {
  const day = d === undefined ? simDay() : d;
  const out = [];
  const seen = {};
  HUBS.forEach(function (hub) {
    const r = rngFor(hash32('book|' + day + '|' + hub.id));
    for (let i = 0; i < 60 && out.length < 60; i++) {
      const cell = cellOf(hub.lat + (r() - 0.5) * 12, hub.lng + (r() - 0.5) * 12);
      if (seen[cell.id] || !isBuyable(cell.id)) continue;
      seen[cell.id] = true;
      const a = askFor(cell.id, day);
      out.push({
        id: cell.id, seller: a.seller, ask: a.ask, nlv: a.nlv, spread: a.spread,
        expiresDay: day + 1 + Math.floor(rand1('exp|' + cell.id + '|' + day) * 3)
      });
    }
  });
  return out.sort(function (a, b) { return a.spread - b.spread; }).slice(0, 12);
}

function buyFromAgent(id) {
  const day = simDay();
  if (!isBuyable(id)) { toast('That block is no longer for sale.', 'warn'); return; }
  const l = askFor(id, day);
  if (wallet.credits < l.ask) { toast('Not enough Credits — ask is ' + l.ask + ' Cr.', 'warn'); return; }
  wallet.credits -= l.ask;
  market.boughtFromAgents.push(id);
  acquire(id, l.ask, 'Bought from ' + l.seller + ' on the exchange');
  toast('Acquired from ' + l.seller + ' for ' + l.ask + ' Cr', 'good');
  try{bumpLtStreak('buy');}catch(e){}
}

/* Offers on the player's own listings.
   Arrival and size are a pure function of (listing, elapsed sim-hours, ask/NLV).
   Ask below appraisal -> offers arrive fast and near the ask.
   Ask far above appraisal -> offers are rare and lowball. Real price discovery. */
function offersFor(id) {
  const L = market.myListings[id];
  if (!L) return [];
  const v = valuate(id).nlv || 1;
  const ratio = L.ask / v;
  const gapHours = clamp(2.5 * Math.pow(clamp(ratio, 0.4, 2.5), 3.1), 1.5, 90);
  const elapsed = (Date.now() - L.listedAt) / SIM_HOUR_MS;
  const count = Math.min(6, Math.floor(elapsed / gapHours));
  const out = [];
  for (let k = 1; k <= count; k++) {
    const seed = 'offer|' + id + '|' + L.listedAt + '|' + k;
    const r = rngFor(hash32(seed));
    // Offers cluster below appraisal and creep toward the ask over time.
    const aggression = 0.70 + r() * 0.34 + Math.min(0.18, k * 0.035);
    const amount = Math.max(1, Math.round(Math.min(L.ask, v * aggression)));
    const wantsSwap = L.acceptSwap && r() < 0.28;
    out.push({
      key: seed,
      idx: k,
      buyer: AGENT_NAMES[Math.floor(r() * AGENT_NAMES.length) % AGENT_NAMES.length],
      amount: amount,
      at: L.listedAt + k * gapHours * SIM_HOUR_MS,
      swap: wantsSwap,
      resolved: (L.resolved || []).indexOf(seed) !== -1
    });
  }
  return out.filter(function (o) { return !o.resolved; }).reverse();
}

async function listForSale(id) {
  const g = guard(id, 'list');
  if (!g.ok) { toast(g.why, 'warn'); return; }
  const v = Math.round(nlv(id));
  const res = await formDialog({
    title: 'List ' + tName(id) + ' for sale',
    note: 'Appraisal (NLV) is ' + v + ' Cr. Ask below appraisal and offers arrive quickly; ask far above and the book goes quiet.',
    fields: [
      { key: 'ask', label: 'Ask price (Cr)', type: 'number', value: v, min: 1 },
      { key: 'days', label: 'Expires in (sim-days)', type: 'number', value: 5, min: 1, max: 30 },
      { key: 'acceptCredit', label: 'Accept Credit offers below ask', type: 'check', value: true },
      { key: 'acceptSwap', label: 'Accept block-for-block swap offers', type: 'check', value: false }
    ],
    confirmText: 'List on exchange'
  });
  if (!res) return;
  market.myListings[id] = {
    ask: Math.max(1, Math.round(+res.ask)),
    expiresDay: simDay() + Math.max(1, Math.round(+res.days)),
    acceptCredit: !!res.acceptCredit,
    acceptSwap: !!res.acceptSwap,
    listedAt: Date.now(),
    resolved: []
  };
  addToLedger('Listed ' + tName(id) + ' at ' + market.myListings[id].ask + ' Cr (appraisal ' + v + ' Cr).', 'market');
  saveAll(); renderAll(); redrawMap();
  toast('Listed at ' + market.myListings[id].ask + ' Cr', 'good');
}

function delistTile(id) {
  if (!market.myListings[id]) return;
  delete market.myListings[id];
  addToLedger('Withdrew ' + tName(id) + ' from the exchange.', 'market');
  saveAll(); renderAll(); redrawMap();
  toast('Listing withdrawn', 'info');
}

function acceptOffer(id, key) {
  const L = market.myListings[id];
  if (!L) return;
  const o = offersFor(id).filter(function (x) { return x.key === key; })[0];
  if (!o) return;
  wallet.credits += o.amount;
  L.resolved = L.resolved || [];
  L.resolved.push(key);
  const paid = (tileData[id] && tileData[id].paid) || 0;
  releaseTile(id);
  delete market.myListings[id];
  market.soldToAgents.push(id);
  addToLedger('Sold ' + tName(id) + ' to ' + o.buyer + ' for ' + o.amount + ' Cr (cost ' + paid + ' Cr, ' +
    (o.amount - paid >= 0 ? '+' : '') + (o.amount - paid) + ').', 'market');
  saveAll(); invalidateDerived(); updateUI(); renderAll(); redrawMap();
  toast('Sold to ' + o.buyer + ' for ' + o.amount + ' Cr', 'good');
}
function rejectOffer(id, key) {
  const L = market.myListings[id];
  if (!L) return;
  L.resolved = L.resolved || [];
  L.resolved.push(key);
  saveAll(); renderMarket();
  toast('Offer declined · escrow released', 'info');
}

/* Bids on blocks that are NOT listed. Credits move into escrow immediately and
   are returned if the holder declines — the escrow is what makes a bid credible. */
async function placeBid(id) {
  try{ /* retention */ }catch(e){}
  if (isOwned(id)) { toast('You already hold this block.', 'warn'); return; }
  const st = baseCellState(id);
  if (st === 'virgin') { toast('Never-minted land cannot be bid on — claim it directly.', 'warn'); return; }
  if (st === 'leased') { toast('This block is out on lease. It cannot receive purchase offers until recalled.', 'warn'); return; }
  if (market.myBids.filter(function (b) { return b.tileId === id && b.status === 'open'; }).length) {
    toast('You already have an open bid on this block.', 'warn'); return;
  }
  const v = Math.round(nlv(id));
  const res = await formDialog({
    title: 'Bid on ' + tName(id),
    note: 'Held by ' + agentFor(id) + '. Appraisal ' + v + ' Cr. Your Credits move to escrow until the holder responds.',
    fields: [{ key: 'amount', label: 'Your bid (Cr)', type: 'number', value: Math.round(v * 1.05), min: 1 }],
    confirmText: 'Place bid · escrow'
  });
  if (!res) return;
  const amount = Math.max(1, Math.round(+res.amount));
  if (wallet.credits < amount) { toast('Not enough Credits to escrow ' + amount + ' Cr.', 'warn'); return; }
  wallet.credits -= amount;
  wallet.escrow += amount;
  const bid = {
    id: 'b' + Date.now(), tileId: id, amount: amount, placedAt: Date.now(),
    status: 'open', holder: agentFor(id), nlvAt: v
  };
  market.myBids.push(bid);
  addToLedger('Bid ' + amount + ' Cr on ' + tName(id) + ' — escrowed pending ' + bid.holder + '.', 'market');
  saveAll(); updateUI(); renderAll();
  toast(amount + ' Cr moved to escrow', 'info');
}

/* Holder response: deterministic, based on bid vs appraisal, after a delay. */
function resolveBids() {
  let changed = false;
  market.myBids.forEach(function (b) {
    if (b.status !== 'open') return;
    const waitH = 4 + rand1('bw|' + b.id) * 14;
    if (Date.now() - b.placedAt < waitH * SIM_HOUR_MS) return;
    const v = valuate(b.tileId).nlv || 1;
    const ratio = b.amount / v;
    // A holder accepts above ~1.04x appraisal; below that they mostly decline.
    const threshold = 1.02 + rand1('bt|' + b.id) * 0.16;
    if (ratio >= threshold) {
      b.status = 'accepted';
      wallet.escrow = Math.max(0, wallet.escrow - b.amount);
      acquire(b.tileId, b.amount, 'Bid accepted by ' + b.holder);
    } else {
      b.status = 'declined';
      wallet.escrow = Math.max(0, wallet.escrow - b.amount);
      wallet.credits += b.amount;
      addToLedger(b.holder + ' declined ' + b.amount + ' Cr for ' + tName(b.tileId) + '. Escrow returned.', 'market');
    }
    changed = true;
  });
  if (changed) { saveAll(); updateUI(); }
  return changed;
}
function cancelBid(bidId) {
  const b = market.myBids.filter(function (x) { return x.id === bidId; })[0];
  if (!b || b.status !== 'open') return;
  b.status = 'cancelled';
  wallet.escrow = Math.max(0, wallet.escrow - b.amount);
  wallet.credits += b.amount;
  addToLedger('Cancelled bid on ' + tName(b.tileId) + '. ' + b.amount + ' Cr released from escrow.', 'market');
  saveAll(); updateUI(); renderMarket();
  toast('Escrow released', 'info');
}

/* ===========================================================================
   9. BAZAAR — a separate book for items
   Land and items are priced on different books on purpose: mixing them would
   let jewel volume contaminate the land price signal.
   ========================================================================= */
function sellJewel(j) {
  const key = j.tileId + '|' + j.day;
  if (market.jewelsSold[key]) return;
  market.jewelsSold[key] = true;
  // Bazaar price moves with the item index, which is independent of land.
  const itemIdx = 0.85 + 0.3 * (0.5 + 0.5 * Math.sin(simDay() / 11.7));
  const cr = Math.max(1, Math.round(j.value * itemIdx));
  wallet.credits += cr;
  addToLedger('Sold ' + j.kind + ' (grade ' + j.grade + ') on the Bazaar for ' + cr + ' Cr.', 'bazaar');
  saveAll(); updateUI(); renderVault(); renderMarket();
  toast(j.kind + ' sold · +' + cr + ' Cr', 'good');
}

/* ===========================================================================
   10. TREASURE — a reason to pan and zoom
   The world is cut into 10 x 10 degree sectors. Each sector hides one cache
   per sim-day at a fixed point. Bring the viewport near it at zoom 5+ to find it.
   ========================================================================= */
const SECTOR = 10;
function sectorOf(lat, lng) {
  return Math.floor(lat / SECTOR) + '_' + Math.floor(lng / SECTOR);
}
function treasureIn(sector, d) {
  const parts = sector.split('_');
  const baseLat = +parts[0] * SECTOR, baseLng = +parts[1] * SECTOR;
  if (rand1('tre|' + sector + '|' + d) > 0.55) return null;
  const r = rngFor(hash32('trp|' + sector + '|' + d));
  return {
    sector: sector, day: d,
    lat: baseLat + r() * SECTOR,
    lng: baseLng + r() * SECTOR,
    cr: 20 + Math.floor(r() * 90)
  };
}
function collectTreasure(sector) {
  const d = simDay();
  const t = treasureIn(sector, d);
  if (!t || market.treasures[sector + '|' + d]) return;
  market.treasures[sector + '|' + d] = true;
  wallet.credits += t.cr;
  addToLedger('Recovered a survey cache in sector ' + sector + ' — +' + t.cr + ' Cr.', 'find');
  saveAll(); updateUI(); redrawMap();
  toast('Survey cache recovered · +' + t.cr + ' Cr', 'good');
}

/* ===========================================================================
   11. ACQUIRE / RELEASE — the two paths land enters and leaves the portfolio
   ========================================================================= */
function tName(id) {
  const t = tileData[id];
  if (t && t.name) return t.name;
  const m = cellMeta(id);
  return m ? m.name : String(id);
}

function acquire(id, cost, note) {
  try{bumpLtStreak('buy');}catch(e){}
  const m = cellMeta(id);
  if (!m) return;
  if (!isOwned(id)) owned.push(id);
  tileData[id] = Object.assign({ vitality: 1.0, aura: 0, builds: [], hist: [] }, tileData[id] || {}, {
    name: m.name, lat: m.lat, lng: m.lng,
    paid: cost, boughtAt: tileData[id] && tileData[id].boughtAt ? tileData[id].boughtAt : Date.now(),
    lastHarvest: Date.now()
  });
  invalidateDerived();
  snapshotValue(id);
  addToLedger((note || 'Claimed') + ' — ' + m.name + ' for ' + cost + ' Cr. NLV ' + Math.round(nlv(id)) + ' Cr.', 'claim');
  if (window.legionTrack) window.legionTrack('activate');
  checkCollections();
  saveAll(); updateUI(); renderAll(); redrawMap();
}

function releaseTile(id) {
  const i = owned.indexOf(id);
  if (i !== -1) owned.splice(i, 1);
  delete tileData[id];
  delete market.myListings[id];
  invalidateDerived();
}

/* Direct claim of never-minted land — the frontier path. */
async function claimVirgin(id, voiceEnergy) {
  const m = cellMeta(id);
  if (!m) return;
  if (isOwned(id)) { toast('You already hold this block.', 'warn'); return; }
  if (baseCellState(id) !== 'virgin') { toast('This block has an owner — buy or bid on the exchange.', 'warn'); return; }
  const day = simDay();
  // Mint price: appraisal discounted, because nobody has ever held it.
  const price = Math.max(1, Math.round(valuate(id, day).nlv * 0.72));
  const ok = await confirmDialog({
    title: 'Claim ' + m.name,
    body: 'Never minted — you would be its first holder.<br>' +
      'Mint price <b>' + price + ' Cr</b> · appraisal ' + Math.round(nlv(id)) + ' Cr · tier ' + m.tier + '.',
    confirmText: 'Claim for ' + price + ' Cr'
  });
  if (!ok) return;
  if (wallet.credits < price) { toast('Not enough Credits — mint price is ' + price + ' Cr.', 'warn'); return; }
  wallet.credits -= price;
  if (voiceEnergy) {
    tileData[id] = Object.assign({}, tileData[id] || {}, {
      voiceEnergy: voiceEnergy, vitality: 1 + voiceEnergy * 0.5, aura: voiceEnergy * 0.4
    });
  }
  acquire(id, price, 'Minted (first holder)');
  toast('Claimed ' + m.name + ' for ' + price + ' Cr', 'good');
}

/* Sell back into the market at appraisal minus a settlement spread.
   Kept because it is the guaranteed exit, but the exchange usually pays more. */
async function sellTile(id) {
  id = String(id);
  if (!isOwned(id)) { toast('You do not hold this block.', 'warn'); return; }
  const g = guard(id, 'sell');
  if (!g.ok) { toast(g.why, 'warn'); return; }
  const v = Math.round(nlv(id) * 0.94);   // 6% instant-settlement spread, disclosed
  const paid = (tileData[id] && tileData[id].paid) || 0;
  const ok = await confirmDialog({
    title: 'Instant settlement',
    body: 'Sell <b>' + tName(id) + '</b> straight back to the market for <b>' + v + ' Cr</b>.<br>' +
      'That is appraisal minus a 6% settlement spread. Cost basis ' + paid + ' Cr · realised ' +
      (v - paid >= 0 ? '+' : '') + (v - paid) + ' Cr.<br><span class="dlg-note">Listing on the exchange usually clears higher.</span>',
    confirmText: 'Settle for ' + v + ' Cr'
  });
  if (!ok) return;
  wallet.credits += v;
  releaseTile(id);
  market.soldToAgents.push(id);
  addToLedger('Settled ' + tName(id) + ' at ' + v + ' Cr (basis ' + paid + ', ' + (v - paid >= 0 ? '+' : '') + (v - paid) + ').', 'market');
  saveAll(); updateUI(); renderAll(); redrawMap();
  toast('Settled for ' + v + ' Cr', 'good');
}

/* Lease flow */
async function listForRent(id) {
  const g = guard(id, 'rent');
  if (!g.ok) { toast(g.why, 'warn'); return; }
  const band = rentBand(id);
  const res = await formDialog({
    title: 'Offer ' + tName(id) + ' for lease',
    note: 'Market band ' + band.lo + '–' + band.hi + ' Cr per sim-day (typical ' + band.mid + '). ' +
      'Cheaper finds a tenant sooner. A leased block cannot be sold until you recall it.',
    fields: [{ key: 'rate', label: 'Rate (Cr per sim-day)', type: 'number', value: band.mid, min: 0.1, step: 0.1 }],
    confirmText: 'Offer for lease'
  });
  if (!res) return;
  const rate = Math.max(0.1, +(+res.rate).toFixed(1));
  tileData[id].rental = { rate: rate, listedAt: Date.now(), pending: 0 };
  const eta = tenantArrivalHours(id, rate);
  addToLedger('Offered ' + tName(id) + ' for lease at ' + rate + ' Cr/sim-day.', 'lease');
  saveAll(); renderAll(); redrawMap();
  toast('Listed for lease · tenant expected in ~' + Math.round(eta) + ' sim-hours', 'good');
}
function recallLease(id) {
  const t = tileData[id];
  if (!t || !t.rental) return;
  if (t.rental.pending) {
    wallet.credits += Math.round(t.rental.pending);
    addToLedger('Recalled ' + tName(id) + ' · collected ' + Math.round(t.rental.pending) + ' Cr outstanding rent.', 'lease');
  } else {
    addToLedger('Recalled ' + tName(id) + ' from the lease board.', 'lease');
  }
  delete t.rental;
  saveAll(); updateUI(); renderAll(); redrawMap();
  toast('Block recalled · now idle', 'info');
}

/* Live tour — the original aura mechanic, kept and wired into the value engine. */
function hostLiveTour(id, name) {
  id = String(id);
  if (!isOwned(id)) { toast('Claim a block first.', 'warn'); return; }
  const voice = (tileData[id] && tileData[id].voiceEnergy) || 0.5;
  const cost = Math.floor(7 + voice * 14);
  if (wallet.credits < cost) { toast('A live tour costs ' + cost + ' Cr.', 'warn'); return; }
  wallet.credits -= cost;
  const boost = 0.25 + voice * 0.9;
  tileData[id].aura = (tileData[id].aura || 0) + boost;
  addToLedger('Live tour on ' + tName(id) + ' · paid ' + cost + ' Cr · aura +' + boost.toFixed(2) + '.', 'live');
  invalidateDerived(); snapshotValue(id); saveAll(); updateUI(); renderAll();
  toast('Live tour hosted · aura +' + boost.toFixed(2), 'good');
}

/* Collections payout */
function checkCollections() {
  HUBS.forEach(function (h) {
    const st = collectionState(h.id);
    if (!st.active || market.collections[h.id]) return;
    const first = st.held.map(function (id) { return (tileData[id] && tileData[id].boughtAt) || Date.now(); })
      .sort(function (a, b) { return a - b; })[0];
    const heldDays = (Date.now() - first) / SIM_DAY_MS;
    if (heldDays < st.active.holdDays) return;
    market.collections[h.id] = { claimedAt: Date.now(), tier: st.active.need };
    wallet.gems += st.active.bonusGems;
    addToLedger('Collection complete — ' + h.region + ' ×' + st.active.need + '. +' + st.active.bonusGems +
      ' Gems, yield ×' + st.active.yieldMult + ' while held.', 'collect');
    toast(h.region + ' collection complete · +' + st.active.bonusGems + ' Gems', 'good');
  });
}

/* Snapshot today's value for an owned block so the chart has real points. */
function snapshotValue(id) {
  const t = tileData[id];
  if (!t) return;
  t.hist = t.hist || [];
  const d = simDay();
  const v = valuate(id, d).nlv;
  const last = t.hist[t.hist.length - 1];
  if (last && last[0] === d) last[1] = v;
  else t.hist.push([d, v]);
  if (t.hist.length > 60) t.hist = t.hist.slice(-60);
}

/* ===========================================================================
   12. COMPARABLES — "where does my block sit in its region?"
   Sampled from real neighbouring cells and valued with the same engine.
   ========================================================================= */
function comparables(id) {
  const m = cellMeta(id);
  if (!m) return null;
  const vals = [];
  const r = rngFor(hash32('comp|' + id));
  for (let i = 0; i < 40; i++) {
    const lat = m.hub.lat + (r() - 0.5) * 9;
    const lng = m.hub.lng + (r() - 0.5) * 9;
    const c = cellOf(lat, lng);
    if (c.id === id) continue;
    const cm = cellMeta(c.id);
    if (!cm) continue;
    vals.push(valuate(c.id).nlv / cm.parcels);   // normalise: Cr per parcel
  }
  vals.sort(function (a, b) { return a - b; });
  const mine = valuate(id).nlv / m.parcels;
  const below = vals.filter(function (v) { return v < mine; }).length;
  return {
    region: m.region,
    n: vals.length,
    median: vals[Math.floor(vals.length / 2)] || 0,
    p25: vals[Math.floor(vals.length * 0.25)] || 0,
    p75: vals[Math.floor(vals.length * 0.75)] || 0,
    min: vals[0] || 0,
    max: vals[vals.length - 1] || 0,
    mine: mine,
    percentile: vals.length ? Math.round((below / vals.length) * 100) : 0,
    values: vals
  };
}

/* Region tape — recent clears in the region, from the same deterministic book. */
function regionTape(hubId, n) {
  const day = simDay();
  const out = [];
  const hub = HUBS.filter(function (h) { return h.id === hubId; })[0];
  if (!hub) return out;
  for (let k = 0; k < (n || 6); k++) {
    const r = rngFor(hash32('tape|' + hubId + '|' + (day - k)));
    const lat = hub.lat + (r() - 0.5) * 8;
    const lng = hub.lng + (r() - 0.5) * 8;
    const c = cellOf(lat, lng);
    const cm = cellMeta(c.id);
    if (!cm) continue;
    const v = valuate(c.id, day - k).nlv;
    out.push({
      id: c.id, name: cm.name, tier: cm.tier,
      price: Math.round(v * (0.86 + r() * 0.4)),
      buyer: AGENT_NAMES[Math.floor(r() * AGENT_NAMES.length) % AGENT_NAMES.length],
      day: day - k
    });
  }
  return out;
}

/* ===========================================================================
   13. TINY UI PRIMITIVES — toast, dialogs, sparkline, dots
   alert()/confirm() are gone: they block the thread and look nothing like the app.
   ========================================================================= */
function toast(msg, kind) {
  const wrap = document.getElementById('toasts');
  if (!wrap) return;
  const el = document.createElement('div');
  el.className = 'toast ' + (kind || 'info');
  el.textContent = msg;
  wrap.appendChild(el);
  announce(msg);
  setTimeout(function () { el.classList.add('out'); }, 2600);
  setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 3100);
}
function announce(msg) {
  const sr = document.getElementById('sr-status');
  if (sr) sr.textContent = msg;
}

let dlgResolve = null;
function closeDialog(val) {
  const root = document.getElementById('dialog-root');
  if (root) { root.className = 'dlg-root'; root.innerHTML = ''; }
  if (dlgResolve) { const r = dlgResolve; dlgResolve = null; r(val); }
}
function confirmDialog(o) {
  return new Promise(function (resolve) {
    dlgResolve = resolve;
    const root = document.getElementById('dialog-root');
    root.className = 'dlg-root open';
    root.innerHTML =
      '<div class="dlg-scrim" data-act="dlg-cancel"></div>' +
      '<div class="dlg" role="dialog" aria-modal="true" aria-label="' + esc(o.title) + '">' +
      '<h3>' + esc(o.title) + '</h3>' +
      '<div class="dlg-body">' + (o.body || '') + '</div>' +
      '<div class="dlg-actions">' +
      '<button data-act="dlg-cancel">' + esc(o.cancelText || 'Cancel') + '</button>' +
      '<button class="primary" data-act="dlg-ok">' + esc(o.confirmText || 'Confirm') + '</button>' +
      '</div></div>';
    const btn = root.querySelector('[data-act="dlg-ok"]');
    if (btn) btn.focus();
  });
}
function formDialog(o) {
  return new Promise(function (resolve) {
    dlgResolve = resolve;
    const root = document.getElementById('dialog-root');
    root.className = 'dlg-root open';
    const fields = o.fields.map(function (f) {
      if (f.type === 'check') {
        return '<label class="dlg-check"><input type="checkbox" data-f="' + f.key + '"' +
          (f.value ? ' checked' : '') + '><span>' + esc(f.label) + '</span></label>';
      }
      return '<label class="dlg-field"><span>' + esc(f.label) + '</span>' +
        '<input type="number" data-f="' + f.key + '" value="' + f.value + '"' +
        (f.min !== undefined ? ' min="' + f.min + '"' : '') +
        (f.max !== undefined ? ' max="' + f.max + '"' : '') +
        ' step="' + (f.step || 1) + '"></label>';
    }).join('');
    root.innerHTML =
      '<div class="dlg-scrim" data-act="dlg-cancel"></div>' +
      '<div class="dlg" role="dialog" aria-modal="true" aria-label="' + esc(o.title) + '">' +
      '<h3>' + esc(o.title) + '</h3>' +
      (o.note ? '<p class="dlg-note">' + esc(o.note) + '</p>' : '') +
      '<div class="dlg-form">' + fields + '</div>' +
      '<div class="dlg-actions">' +
      '<button data-act="dlg-cancel">Cancel</button>' +
      '<button class="primary" data-act="dlg-submit">' + esc(o.confirmText || 'Confirm') + '</button>' +
      '</div></div>';
    const first = root.querySelector('input');
    if (first) { first.focus(); if (first.select) first.select(); }
  });
}
function readDialogForm() {
  const root = document.getElementById('dialog-root');
  const out = {};
  root.querySelectorAll('[data-f]').forEach(function (el) {
    out[el.getAttribute('data-f')] = el.type === 'checkbox' ? el.checked : el.value;
  });
  return out;
}

function esc(s) {
  return String(s === undefined || s === null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Inline SVG sparkline. No chart library, no network.
function sparkline(points, w, h, id) {
  const W = w || 280, H = h || 56;
  if (!points.length) return '';
  const vals = points.map(function (p) { return p.v; });
  const lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
  const span = (hi - lo) || 1;
  const pad = 4;
  const xy = points.map(function (p, i) {
    const x = pad + (i / Math.max(1, points.length - 1)) * (W - pad * 2);
    const y = H - pad - ((p.v - lo) / span) * (H - pad * 2);
    return [x, y];
  });
  const line = xy.map(function (p, i) { return (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1); }).join(' ');
  const area = line + ' L' + xy[xy.length - 1][0].toFixed(1) + ' ' + H + ' L' + xy[0][0].toFixed(1) + ' ' + H + ' Z';
  const up = vals[vals.length - 1] >= vals[0];
  const stroke = up ? '#7fc99a' : '#d99a7f';
  const gid = 'g' + (id || Math.abs(hash32(line)).toString(36));
  return '<svg class="spark" viewBox="0 0 ' + W + ' ' + H + '" width="100%" height="' + H + '" role="img" ' +
    'aria-label="Value trend over the last ' + points.length + ' simulated days">' +
    '<defs><linearGradient id="' + gid + '" x1="0" y1="0" x2="0" y2="1">' +
    '<stop offset="0%" stop-color="' + stroke + '" stop-opacity=".28"/>' +
    '<stop offset="100%" stop-color="' + stroke + '" stop-opacity="0"/></linearGradient></defs>' +
    '<path d="' + area + '" fill="url(#' + gid + ')"/>' +
    '<path d="' + line + '" fill="none" stroke="' + stroke + '" stroke-width="1.6" ' +
    'stroke-linejoin="round" stroke-linecap="round"/>' +
    '<circle cx="' + xy[xy.length - 1][0].toFixed(1) + '" cy="' + xy[xy.length - 1][1].toFixed(1) +
    '" r="2.6" fill="' + stroke + '"/></svg>';
}

// Distribution bars for comparables.
function histogram(values, mine) {
  if (!values.length) return '';
  const lo = values[0], hi = values[values.length - 1];
  const span = (hi - lo) || 1;
  const bins = new Array(14).fill(0);
  values.forEach(function (v) { bins[Math.min(13, Math.floor(((v - lo) / span) * 14))]++; });
  const peak = Math.max.apply(null, bins) || 1;
  const mineBin = Math.min(13, Math.max(0, Math.floor(((mine - lo) / span) * 14)));
  return '<div class="hist" role="img" aria-label="Distribution of comparable block values in this region">' +
    bins.map(function (b, i) {
      return '<i class="' + (i === mineBin ? 'me' : '') + '" style="height:' +
        Math.max(6, (b / peak) * 100) + '%"></i>';
    }).join('') + '</div>';
}

function rarityDots(n, total) {
  let s = '<span class="dots" aria-hidden="true">';
  for (let i = 0; i < (total || 4); i++) s += '<i class="' + (i < n ? 'on' : '') + '"></i>';
  return s + '</span>';
}

function fmtCr(v) { return Math.round(v).toLocaleString(); }
function pct(v) { return (v >= 0 ? '+' : '') + v.toFixed(1) + '%'; }
function relTime(ms) {
  const h = ms / SIM_HOUR_MS;
  if (h < 1) return Math.max(1, Math.round(h * 60)) + ' sim-min';
  if (h < 48) return Math.round(h) + ' sim-h';
  return Math.round(h / 24) + ' sim-days';
}

/* ===========================================================================
   14. MAP — canvas-rendered, layer-coded, keyboard and touch aware
   ========================================================================= */
let map = null;
let cellLayer = null, ownedLayer = null, treasureLayer = null, ghost = null;
let heatLayer = null, hubLayer = null;
let miniCanvas = null;
let selectedId = null;
let redrawTimer = null;

/* Layer weights are deliberately uneven. "For sale", "leased" and "mine" are
   decisions you can act on, so they carry fill. "Held" and "never minted" are
   context — they get a hairline and almost no fill, or the basemap disappears
   under a checkerboard and the map stops being a map. */
const LAYERS = {
  mine:   { on: true, color: '#c5a46e', fill: 0.34, weight: 2.2, label: 'Mine' },
  listed: { on: true, color: '#6fbf8f', fill: 0.30, weight: 1.4, label: 'For sale' },
  leased: { on: true, color: '#9b8bd6', fill: 0.26, weight: 1.2, label: 'Leased' },
  held:   { on: true, color: '#6b7a8f', fill: 0.04, weight: 0.5, label: 'Held by agents' },
  virgin: { on: true, color: '#a9834b', fill: 0.00, weight: 0.5, label: 'Never minted' },
  // A display-only field, never a cell state — drives the demand glow + hub anchors.
  demand: { on: true, color: '#c5a46e', fill: 0.00, weight: 0, label: 'Demand field', field: true }
};

// The full display state of any cell — this is what the map colours by.
function cellDisplayState(id) {
  if (isOwned(id)) {
    const s = tileState(id);
    if (s === 'listed') return 'listed';
    if (s === 'leased' || s === 'rent-listed') return 'leased';
    return 'mine';
  }
  if (market.soldToAgents.indexOf(id) !== -1) return 'held';
  const s = baseCellState(id);
  // Only paint a cell "for sale" if it can genuinely be bought right now.
  if (s === 'listed') return isBuyable(id) ? 'listed' : 'held';
  return s;
}

function initMap() {
  // Canvas renderer: Leaflet draws every rectangle into one <canvas> instead of
  // one DOM/SVG node per cell. That is what keeps hundreds of cells smooth.
  map = L.map('map', {
    preferCanvas: true,
    renderer: L.canvas({ padding: 0.3 }),
    zoomControl: true,
    scrollWheelZoom: false,       // cooperative gestures: ctrl/cmd + wheel only
    worldCopyJump: true,
    keyboard: true,
    minZoom: 2,
    maxZoom: 12
  }).setView([25, 10], 3);

  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors &copy; CARTO &middot; virtual land only',
    subdomains: 'abcd',
    maxZoom: 19,
    // Keep previous-zoom tiles during a pan: smoother perceived motion at the
    // cost of a little extra work. The explicit tradeoff MapLibre documents.
    keepBuffer: 3,
    updateWhenZooming: false
  }).addTo(map);

  // Draw order matters: heat sits under the cell grid, hub anchors ride on top.
  heatLayer = L.layerGroup().addTo(map);
  cellLayer = L.layerGroup().addTo(map);
  ownedLayer = L.layerGroup().addTo(map);
  treasureLayer = L.layerGroup().addTo(map);
  hubLayer = L.layerGroup().addTo(map);

  // ---- cooperative gestures -------------------------------------------------
  // On touch, a one-finger drag must scroll the PAGE, not the map. Two fingers
  // move the map. On desktop, the wheel needs ctrl/cmd. Both show a hint.
  const hint = document.getElementById('map-hint');
  function flashHint(text) {
    if (!hint) return;
    hint.textContent = text;
    hint.classList.add('show');
    clearTimeout(hint._t);
    hint._t = setTimeout(function () { hint.classList.remove('show'); }, 1400);
  }
  const isTouch = window.matchMedia && window.matchMedia('(hover: none)').matches;
  if (isTouch) map.dragging.disable();
  const mapEl = document.getElementById('map');
  mapEl.addEventListener('touchstart', function (e) {
    if (e.touches.length >= 2) { map.dragging.enable(); }
    else { map.dragging.disable(); flashHint('Use two fingers to move the map'); }
  }, { passive: true });
  mapEl.addEventListener('touchend', function () {
    if (isTouch) map.dragging.disable();
  }, { passive: true });
  mapEl.addEventListener('wheel', function (e) {
    if (e.ctrlKey || e.metaKey) { map.scrollWheelZoom.enable(); }
    else { map.scrollWheelZoom.disable(); flashHint('Hold ⌘ / Ctrl to zoom the map'); }
  }, { passive: true });

  // ---- hover survey ---------------------------------------------------------
  const info = document.getElementById('map-readout');
  map.on('mousemove', function (e) {
    const cell = cellOf(e.latlng.lat, e.latlng.lng);
    const half = GRID / 2;
    const b = [[cell.lat - half, cell.lng - half], [cell.lat + half, cell.lng + half]];
    if (!ghost) {
      ghost = L.rectangle(b, { color: '#e8cf94', weight: 1, fill: false, dashArray: '3 4', interactive: false }).addTo(map);
    } else ghost.setBounds(b);
    if (info) info.innerHTML = readoutFor(cell.id);
  });
  map.on('mouseout', function () {
    if (ghost) { map.removeLayer(ghost); ghost = null; }
    if (info) info.innerHTML = '<span class="dim">Hover the map to survey a block · click to open it</span>';
  });

  map.on('click', function (e) { selectTile(cellOf(e.latlng.lat, e.latlng.lng).id); });
  map.on('moveend zoomend', scheduleRedraw);
  map.on('moveend', checkTreasureProximity);
  // The minimap's viewport box tracks the pan live; it is cheap enough for 'move'.
  map.on('move zoom', drawMinimap);

  buildMinimap();
  scheduleRedraw();
  checkTreasureProximity();
}

function readoutFor(id) {
  const m = cellMeta(id);
  if (!m) return '';
  const st = cellDisplayState(id);
  const v = Math.round(nlv(id));
  const label = {
    mine: 'yours', leased: 'leased', held: 'held by ' + agentFor(id),
    virgin: 'never minted — mint at ' + Math.round(v * 0.72) + ' Cr',
    listed: 'for sale at ' + askFor(id).ask + ' Cr'
  }[st];
  return '<b>' + esc(m.name) + '</b> · ' + m.tier + ' · ' + esc(label) +
    ' · <span class="mono">' + v + ' Cr</span> appraisal';
}

function scheduleRedraw() {
  clearTimeout(redrawTimer);
  redrawTimer = setTimeout(redrawMap, 90);
}

function redrawMap() {
  if (!map || !cellLayer) return;
  cellLayer.clearLayers();
  ownedLayer.clearLayers();
  const half = GRID / 2;
  const z = map.getZoom();
  const b = map.getBounds();

  // Owned blocks are always drawn, at any zoom — the map IS the portfolio.
  owned.forEach(function (id) {
    const m = cellMeta(id);
    if (!m) return;
    const st = cellDisplayState(id);
    const L2 = LAYERS[st];
    if (!L2 || !L2.on) return;
    L.rectangle([[m.lat - half, m.lng - half], [m.lat + half, m.lng + half]], {
      color: L2.color, weight: 2.2, fillColor: L2.color, fillOpacity: Math.max(0.28, L2.fill)
    }).addTo(ownedLayer);
  });

  // Ambient market cells only once the view is tight enough to mean something,
  // and hard-capped so a world-wide pan never allocates thousands of shapes.
  if (z >= 5) {
    const latStep = GRID, lngStep = GRID;
    const lat0 = Math.floor(b.getSouth() / latStep) * latStep;
    const lat1 = Math.ceil(b.getNorth() / latStep) * latStep;
    const lng0 = Math.floor(b.getWest() / lngStep) * lngStep;
    const lng1 = Math.ceil(b.getEast() / lngStep) * lngStep;
    let drawn = 0;
    const CAP = 900;
    for (let la = lat0; la <= lat1 && drawn < CAP; la += latStep) {
      for (let ln = lng0; ln <= lng1 && drawn < CAP; ln += lngStep) {
        const cell = cellOf(la, ln);
        if (isOwned(cell.id)) continue;
        const st = cellDisplayState(cell.id);
        const L2 = LAYERS[st];
        if (!L2 || !L2.on) continue;
        if (st === 'virgin' && z < 6) continue;   // frontier only at closer zoom
        L.rectangle([[cell.lat - half, cell.lng - half], [cell.lat + half, cell.lng + half]], {
          color: L2.color,
          weight: L2.weight,
          opacity: st === 'held' || st === 'virgin' ? 0.35 : 0.9,
          fill: L2.fill > 0,
          fillColor: L2.color,
          fillOpacity: L2.fill,
          dashArray: st === 'virgin' ? '2 4' : null,
          interactive: false
        }).addTo(cellLayer);
        drawn++;
      }
    }
    const cnt = document.getElementById('map-count');
    if (cnt) cnt.textContent = drawn + ' blocks in view' + (drawn >= CAP ? ' (capped — zoom in for the rest)' : '');
  } else {
    const cnt = document.getElementById('map-count');
    if (cnt) cnt.textContent = 'Zoom to 5+ to see the market layer';
  }

  drawHubsAndHeat();
  drawTreasures();
  drawMinimap();
  if (selectedId) highlightSelected();
}

/* Regional demand field + hub anchors. Rendered at EVERY zoom so the world is
   never a blank basemap: at world zoom you read where the market runs hot before
   you commit to a region; zoomed in, the glow is the ambient value gradient the
   valuation already prices. Ten hubs -> ~40 shapes, redrawn only on move/day. */
function drawHubsAndHeat() {
  if (!map || !heatLayer || !hubLayer) return;
  heatLayer.clearLayers();
  hubLayer.clearLayers();
  const d = simDay();
  const z = map.getZoom();
  const showHeat = LAYERS.demand.on;
  // Concentric soft rings tuned to the 320 km valuation decay scale.
  const RINGS = [{ km: 300, op: 0.22 }, { km: 560, op: 0.12 }, { km: 880, op: 0.055 }];
  HUBS.forEach(function (h) {
    const dm = hubDemand(h, d);
    if (showHeat) {
      RINGS.forEach(function (r) {
        L.circle([h.lat, h.lng], {
          radius: r.km * 1000,
          stroke: false,
          fillColor: dm.band.color,
          fillOpacity: r.op * (0.5 + dm.temp),   // a hotter hub glows denser
          interactive: false
        }).addTo(heatLayer);
      });
    }
    const mk = L.marker([h.lat, h.lng], {
      icon: L.divIcon({ className: 'hub-anchor', html: hubAnchorHtml(h, dm, z), iconSize: [0, 0], iconAnchor: [0, 0] }),
      keyboard: false, riseOnHover: true, zIndexOffset: 650
    });
    mk.bindTooltip(h.name + ' · demand ' + dm.band.label + ' · ×' + h.weight.toFixed(2) + ' gravity',
      { direction: 'top', offset: [0, -6] });
    mk.on('click', function () { jumpToHub(h.id); });
    mk.addTo(hubLayer);
  });
}

function hubAnchorHtml(h, dm, z) {
  const arrow = dm.delta > 0.02 ? '▲' : dm.delta < -0.02 ? '▼' : '·';
  const acls = dm.delta > 0.02 ? 'up' : dm.delta < -0.02 ? 'down' : 'flat';
  let lbl = '';
  if (z >= 4) {
    const band = z >= 5
      ? '<b style="color:' + dm.band.color + '">' + dm.band.label +
        ' <i class="' + acls + '">' + arrow + '</i></b>'
      : '';
    lbl = '<span class="hub-lbl">' + esc(h.name) + band + '</span>';
  }
  return '<span class="hub-dot" style="--hc:' + dm.band.color +
    '"><span class="hub-pulse" style="--hc:' + dm.band.color + '"></span></span>' + lbl;
}

/* Minimap locator — a lightweight equirectangular overview drawn on a canvas.
   Shows the ten hubs (coloured by demand), your holdings, and a live viewport
   box; click to recentre. Standard orientation tool the deep-zoom map lacked. */
function buildMinimap() {
  const shell = document.querySelector('.map-shell');
  if (!shell || miniCanvas) return;
  const wrap = document.createElement('div');
  wrap.className = 'minimap';
  wrap.title = 'World locator · click to jump';
  const cv = document.createElement('canvas');
  cv.width = 336; cv.height = 168;   // 2× backing store for crisp lines
  wrap.appendChild(cv);
  const cap = document.createElement('span');
  cap.className = 'minimap-cap';
  cap.textContent = 'World';
  wrap.appendChild(cap);
  shell.appendChild(wrap);
  miniCanvas = cv;
  wrap.addEventListener('click', function (e) {
    if (!map) return;
    const r = cv.getBoundingClientRect();
    const lng = clamp((e.clientX - r.left) / r.width * 360 - 180, -179, 179);
    const lat = clamp(90 - (e.clientY - r.top) / r.height * 180, -84, 84);
    map.setView([lat, lng], map.getZoom(), { animate: true });
  });
  drawMinimap();
}

function drawMinimap() {
  if (!miniCanvas || !map) return;
  const cv = miniCanvas, ctx = cv.getContext('2d');
  const W = cv.width, H = cv.height;
  const px = function (lng, lat) { return [(lng + 180) / 360 * W, (90 - lat) / 180 * H]; };
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = 'rgba(13,11,8,.86)'; ctx.fillRect(0, 0, W, H);
  // graticule
  ctx.strokeStyle = 'rgba(58,49,37,.55)'; ctx.lineWidth = 1;
  for (let lng = -120; lng <= 120; lng += 60) { const p = px(lng, 0); ctx.beginPath(); ctx.moveTo(p[0], 0); ctx.lineTo(p[0], H); ctx.stroke(); }
  for (let lat = -60; lat <= 60; lat += 30) { const p = px(0, lat); ctx.beginPath(); ctx.moveTo(0, p[1]); ctx.lineTo(W, p[1]); ctx.stroke(); }
  const d = simDay();
  // hubs, coloured by live demand
  HUBS.forEach(function (h) {
    const dm = hubDemand(h, d);
    const p = px(h.lng, h.lat);
    ctx.beginPath(); ctx.arc(p[0], p[1], 3.2, 0, 6.2832);
    ctx.fillStyle = dm.band.color; ctx.globalAlpha = 0.9; ctx.fill(); ctx.globalAlpha = 1;
  });
  // holdings
  ctx.fillStyle = '#e8cf94';
  owned.forEach(function (id) {
    const m = cellMeta(id); if (!m) return;
    const p = px(m.lng, m.lat);
    ctx.fillRect(p[0] - 1.6, p[1] - 1.6, 3.2, 3.2);
  });
  // viewport box
  const b = map.getBounds();
  const a = px(b.getWest(), b.getNorth()), c = px(b.getEast(), b.getSouth());
  let x0 = clamp(Math.min(a[0], c[0]), 0, W), x1 = clamp(Math.max(a[0], c[0]), 0, W);
  let y0 = clamp(Math.min(a[1], c[1]), 0, H), y1 = clamp(Math.max(a[1], c[1]), 0, H);
  const rw = Math.max(3, x1 - x0), rh = Math.max(3, y1 - y0);
  ctx.fillStyle = 'rgba(197,164,110,.12)'; ctx.fillRect(x0, y0, rw, rh);
  ctx.strokeStyle = '#e8cf94'; ctx.lineWidth = 2; ctx.strokeRect(x0, y0, rw, rh);
}

let selectRing = null;
function highlightSelected() {
  if (selectRing) { map.removeLayer(selectRing); selectRing = null; }
  const m = cellMeta(selectedId);
  if (!m || !map) return;
  const half = GRID / 2;
  selectRing = L.rectangle([[m.lat - half, m.lng - half], [m.lat + half, m.lng + half]], {
    color: '#f0dca8', weight: 2.4, fill: false, interactive: false
  }).addTo(map);
}

function drawTreasures() {
  if (!treasureLayer || !map) return;
  treasureLayer.clearLayers();
  if (map.getZoom() < 5) return;
  const d = simDay();
  const c = map.getCenter();
  const sec = sectorOf(c.lat, c.lng);
  const t = treasureIn(sec, d);
  if (!t || market.treasures[sec + '|' + d]) return;
  const km = haversineKm(c.lat, c.lng, t.lat, t.lng);
  if (km > 420) return;   // discovery range — you must pan near it
  const mk = L.circleMarker([t.lat, t.lng], {
    radius: 9, color: '#f0dca8', weight: 2, fillColor: '#c5a46e', fillOpacity: 0.55
  }).addTo(treasureLayer);
  mk.bindTooltip('Survey cache · +' + t.cr + ' Cr — click to recover', { direction: 'top' });
  mk.on('click', function (e) {
    if (e.originalEvent) L.DomEvent.stopPropagation(e);
    collectTreasure(sec);
  });
}
function checkTreasureProximity() {
  if (!map) return;
  const d = simDay();
  const c = map.getCenter();
  const sec = sectorOf(c.lat, c.lng);
  const t = treasureIn(sec, d);
  const el = document.getElementById('map-scan');
  if (!el) return;
  if (!t || market.treasures[sec + '|' + d]) { el.textContent = 'Sector ' + sec + ' · swept'; el.className = 'scan'; return; }
  const km = haversineKm(c.lat, c.lng, t.lat, t.lng);
  if (km < 420) { el.textContent = 'Cache in range — marked on the map'; el.className = 'scan hot'; }
  else if (km < 1400) { el.textContent = 'Survey signal in sector ' + sec + ' · close'; el.className = 'scan warm'; }
  else { el.textContent = 'Survey signal in sector ' + sec + ' · faint'; el.className = 'scan'; }
}

function flyToTile(id) {
  const m = cellMeta(id);
  if (!m || !map) return;
  map.setView([m.lat, m.lng], Math.max(map.getZoom(), 7), { animate: true });
}

/* ===========================================================================
   15. TILE PANEL — everything known about one block, in layers
   ========================================================================= */
function selectTile(id, opts) {
  selectedId = id;
  if (opts && opts.fly) flyToTile(id);
  setHash(id);
  renderTilePanel();
  highlightSelected();
  if (!opts || !opts.keepView) showView('map-view');
  // The panel lives below the map, so bring it into view rather than leaving
  // the user wondering whether the click did anything.
  if (opts && opts.fly) {
    const el = document.getElementById('tile-panel');
    if (el && el.scrollIntoView) setTimeout(function () { el.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }, 120);
  }
}

function renderTilePanel() {
  const el = document.getElementById('tile-panel');
  if (!el) return;
  if (!selectedId) { el.innerHTML = ''; el.classList.remove('open'); return; }
  const id = selectedId;
  const m = cellMeta(id);
  if (!m) { el.innerHTML = ''; return; }
  const val = valuate(id);
  const st = cellDisplayState(id);
  const mine = isOwned(id);
  const series = valueSeries(id, 30);
  const ch = change30d(id);
  const cmp = comparables(id);
  const t = tileData[id] || {};
  const listing = market.myListings[id];
  const agentBook = isBuyable(id) ? askFor(id) : null;

  const stLabel = { mine: 'Yours', listed: 'Listed for sale', leased: 'Leased', held: 'Held by ' + agentFor(id), virgin: 'Never minted' }[st];

  // --- actions, gated by the state machine ---
  const acts = [];
  if (!mine) {
    if (st === 'virgin') acts.push(btn('claim', id, 'Claim for ' + Math.round(val.nlv * 0.72) + ' Cr', 'primary'));
    if (agentBook) acts.push(btn('buy-agent', id, 'Buy at ask ' + agentBook.ask + ' Cr', 'primary'));
    if (st === 'held') acts.push(btn('bid', id, 'Place bid · escrow'));
    if (st === 'leased') acts.push('<span class="act-block">Out on lease — no purchase offers accepted</span>');
  } else {
    const state = tileState(id);
    if (state === 'developing') {
      const done = Date.now() >= t.build.endsAt;
      acts.push(done
        ? btn('collect-build', id, 'Collect build · ' + t.build.gems + ' Gems back', 'primary')
        : '<span class="act-block">Building — ' + relTime(t.build.endsAt - Date.now()) + ' left · ' + t.build.gems + ' Gems committed</span>');
    } else {
      Object.keys(BLUEPRINTS).forEach(function (k) {
        const bp = BLUEPRINTS[k];
        acts.push(btn('build:' + k, id, bp.icon + ' ' + bp.name + ' · ' + bp.gems + ' ◇'));
      });
    }
    if (state === 'listed') {
      acts.push(btn('delist', id, 'Withdraw listing at ' + listing.ask + ' Cr'));
    } else if (state === 'idle') {
      acts.push(btn('list', id, 'List for sale'));
      acts.push(btn('rent', id, 'Offer for lease'));
      acts.push(btn('settle', id, 'Instant settle'));
    }
    if (state === 'leased' || state === 'rent-listed') acts.push(btn('recall', id, 'Recall block'));
    acts.push(btn('live', id, '● Host live tour'));
  }
  acts.push(btn('share', id, 'Copy link'));

  const resHtml = ['N', 'E', 'S', 'W'].map(function (d) {
    const r = m.resources.filter(function (x) { return x.dir === d; })[0];
    const R = RESOURCES[r.key];
    return '<div class="res"><span class="res-dir">' + d + '</span>' +
      '<span class="res-sym" style="color:' + R.color + '">' + R.sym + '</span>' +
      '<span class="res-name">' + R.name + '</span>' + rarityDots(r.tier, 3) + '</div>';
  }).join('');

  const partsHtml = val.parts.map(function (p) {
    if (p.val !== undefined) return '<li><span>' + esc(p.label) + '</span><b class="mono">' + p.val.toFixed(0) + ' Cr</b></li>';
    const neutral = Math.abs(p.mult - 1) < 0.005;
    return '<li class="' + (neutral ? 'neutral' : (p.mult > 1 ? 'up' : 'down')) + '">' +
      '<span>' + esc(p.label) + '</span><b class="mono">×' + p.mult.toFixed(3) + '</b></li>';
  }).join('');

  el.classList.add('open');
  el.innerHTML =
    '<button class="panel-close" data-act="close-panel" aria-label="Close block details">×</button>' +
    '<div class="panel-head sed-' + m.sediment.id + '" style="--frame:' + m.sediment.frame + '">' +
      '<div class="panel-title">' +
        '<h3>' + esc(m.name) + '</h3>' +
        '<div class="chips">' +
          '<span class="chip tier">' + m.tier + ' ' + rarityDots(TIERS[m.tier].dots, 4) + '</span>' +
          '<span class="chip sed">' + esc(m.sediment.name) + '</span>' +
          (m.artifact ? '<span class="chip art">✦ ' + esc(m.artifact.name) + ' ' + rarityDots(m.artifact.tier, 3) + '</span>' : '') +
          '<span class="chip state s-' + st + '">' + esc(stLabel) + '</span>' +
        '</div>' +
      '</div>' +
      '<div class="panel-nlv">' +
        '<span class="nlv-label">NLV</span>' +
        '<span class="nlv-num mono">' + fmtCr(val.nlv) + '<em>Cr</em></span>' +
        '<span class="nlv-ch ' + (ch >= 0 ? 'up' : 'down') + '">' + pct(ch) + ' <em>30 sim-days</em></span>' +
      '</div>' +
    '</div>' +
    '<div class="panel-spark">' + sparkline(series, 560, 60, 'p' + id) +
      '<div class="spark-foot"><span>' + (series.filter(function (p) { return p.real; }).length) +
      ' recorded · rest indexed from today’s fundamentals</span>' +
      '<span class="mono">sim-day ' + simDay() + '</span></div></div>' +

    '<div class="panel-grid">' +
      '<div class="pcard"><h4>Land facts</h4><dl>' +
        '<div><dt>Coordinates</dt><dd class="mono">' + m.lat.toFixed(1) + ', ' + m.lng.toFixed(1) + '</dd></div>' +
        '<div><dt>Size</dt><dd>' + m.parcels + ' parcel' + (m.parcels > 1 ? 's' : '') + ' · ' + m.areaM2 + ' m²</dd></div>' +
        '<div><dt>Nearest hub</dt><dd>' + esc(m.hub.name) + ' · ' + Math.round(m.km) + ' km</dd></div>' +
        '<div><dt>Region</dt><dd>' + esc(m.region) + '</dd></div>' +
        '<div><dt>Rarity score</dt><dd class="mono">' + m.rarityScore + ' / 100</dd></div>' +
      '</dl></div>' +
      '<div class="pcard"><h4>Resource faces</h4><div class="res-grid">' + resHtml + '</div>' +
        '<p class="pnote">Yield ' + resourceRate(id).toFixed(2) + ' units per sim-hour' +
        (mine ? '' : ' once claimed') + ' · reservoir caps at ' + RES_CAP_HOURS + ' sim-h.</p></div>' +
    '</div>' +

    '<details class="fold"><summary>How this number is built</summary>' +
      '<ul class="parts">' + partsHtml + '</ul>' +
      '<p class="pnote">Appraisal only. What a block actually clears at is set by the exchange, not by this formula.</p>' +
    '</details>' +

    (cmp ? '<details class="fold"><summary>Comparables — ' + esc(cmp.region) + '</summary>' +
      '<div class="cmp-head"><span>Cr per parcel across ' + cmp.n + ' nearby blocks</span>' +
      '<b class="mono">' + (cmp.percentile) + 'th percentile</b></div>' +
      histogram(cmp.values, cmp.mine) +
      '<div class="cmp-stats">' +
        '<span>min <b class="mono">' + cmp.min.toFixed(0) + '</b></span>' +
        '<span>p25 <b class="mono">' + cmp.p25.toFixed(0) + '</b></span>' +
        '<span>median <b class="mono">' + cmp.median.toFixed(0) + '</b></span>' +
        '<span>p75 <b class="mono">' + cmp.p75.toFixed(0) + '</b></span>' +
        '<span class="me">this block <b class="mono">' + cmp.mine.toFixed(0) + '</b></span>' +
      '</div></details>' : '') +

    '<div class="panel-actions">' + acts.join('') + '</div>';
}

function btn(act, id, label, cls) {
  return '<button class="' + (cls || '') + '" data-act="' + act + '" data-id="' + esc(id) + '">' + label + '</button>';
}

/* ===========================================================================
   16. VIEWS
   ========================================================================= */
const VIEWS = ['map-view', 'portfolio-view', 'market-view', 'vault-view', 'voice-view', 'ledger-view'];
const NAV = {
  'map-view': 'Map', 'portfolio-view': 'Portfolio', 'market-view': 'Market',
  'vault-view': 'Vault', 'voice-view': 'Voice', 'ledger-view': 'Ledger'
};

function showView(id) {
  VIEWS.forEach(function (v) {
    const el = document.getElementById(v);
    if (el) el.style.display = (v === id) ? 'block' : 'none';
  });
  document.querySelectorAll('nav button[data-view]').forEach(function (b) {
    const on = b.getAttribute('data-view') === id;
    b.classList.toggle('active', on);
    b.setAttribute('aria-current', on ? 'page' : 'false');
  });
  if (id === 'map-view') setTimeout(function () { if (map) map.invalidateSize(); }, 40);
  if (id === 'portfolio-view') renderPortfolio();
  if (id === 'market-view') renderMarket();
  if (id === 'vault-view') renderVault();
  if (id === 'ledger-view') renderLedger();
  announce(NAV[id] + ' view');
}

// Legacy entry points kept so nothing that referenced them breaks.
function showMap() { showView('map-view'); }
function showEstate() { showView('portfolio-view'); }
function showPortfolio() { showView('portfolio-view'); }
function showMarket() { showView('market-view'); }
function showVault() { showView('vault-view'); }
function showVoice() { showView('voice-view'); }
function showLedger() { showView('ledger-view'); }
function showDevelop() { showView('vault-view'); }
function showLive() { showView('portfolio-view'); }
function demoDevelop() {
  if (!owned.length) { toast('Claim a block first.', 'warn'); return; }
  selectTile(owned[0], { fly: true });
}
function developTile(id) {
  if (!isOwned(String(id))) { toast('Claim this block first.', 'warn'); return; }
  startBuild(String(id), 'garden');
}
function connectWallet() {
  wallet.linked = true;
  const btnEl = document.querySelector('[data-act="connect"]');
  if (btnEl) { btnEl.textContent = 'Wallet linked'; btnEl.disabled = true; }
  addToLedger('Simulated wallet linked. No real account is involved.', 'note');
  saveAll(); updateUI();
  toast('Simulated wallet linked', 'good');
}

/* ---- header ---- */
function updateUI() {
  const set = function (id, html) { const e = document.getElementById(id); if (e) e.innerHTML = html; };
  set('w-credits', '<b class="mono">' + fmtCr(wallet.credits) + '</b> Cr');
  set('w-gems', '<b class="mono">' + fmtCr(availableGems()) + '</b> ◇' +
    (wallet.gemsLocked ? ' <em>' + fmtCr(wallet.gemsLocked) + ' committed</em>' : ''));
  set('w-escrow', wallet.escrow ? '<b class="mono">' + fmtCr(wallet.escrow) + '</b> Cr in escrow' : '');
  const esc2 = document.getElementById('w-escrow');
  if (esc2) esc2.style.display = wallet.escrow ? '' : 'none';

  const pv = portfolioValue();
  const ps = portfolioSeries(30);
  const chg = ps[0].v > 0 ? ((ps[ps.length - 1].v - ps[0].v) / ps[0].v) * 100 : 0;
  set('hdr-nlv', owned.length
    ? '<span class="hdr-nlv-num mono">' + fmtCr(pv) + '<em>Cr</em></span>' +
      '<span class="hdr-nlv-meta">' + owned.length + ' block' + (owned.length > 1 ? 's' : '') +
      ' · <span class="' + (chg >= 0 ? 'up' : 'down') + '">' + pct(chg) + ' / 30 sim-days</span></span>'
    : '<span class="hdr-nlv-num mono dim">—</span><span class="hdr-nlv-meta">No blocks yet — claim one on the map</span>');

  const bd = document.getElementById('badge-pending');
  if (bd) {
    const pend = Math.round(totalPendingResources() * RESOURCE_CR) +
      Math.round(owned.reduce(function (s, id) {
        const t = tileData[id]; return s + ((t && t.rental && t.rental.pending) || 0);
      }, 0));
    bd.textContent = pend > 0 ? String(pend) : '';
    bd.style.display = pend > 0 ? '' : 'none';
  }
}

/* ---- portfolio ---- */
function renderPortfolio() {
  const wrap = document.getElementById('portfolio-body');
  if (!wrap) return;
  if (!owned.length) {
    wrap.innerHTML = '<p class="empty">No blocks yet. Open the <b>Map</b>, hover to survey, and claim never-minted land — ' +
      'or buy from an agent on the <b>Market</b>.</p>';
    return;
  }
  const ps = portfolioSeries(30);
  const pv = ps[ps.length - 1].v;
  const chg = ps[0].v > 0 ? ((pv - ps[0].v) / ps[0].v) * 100 : 0;
  const basis = owned.reduce(function (s, id) { return s + ((tileData[id] && tileData[id].paid) || 0); }, 0);

  const es = estates().filter(function (g) { return g.length > 1; })
    .sort(function (a, b) { return b.length - a.length; });

  const cards = owned.slice().sort(function (a, b) { return nlv(b) - nlv(a); }).map(function (id) {
    const m = cellMeta(id);
    const t = tileData[id] || {};
    const v = nlv(id);
    const paid = t.paid || 0;
    const g = paid ? ((v - paid) / paid) * 100 : 0;
    const st = tileState(id);
    return '<article class="lcard sed-' + m.sediment.id + '" style="--frame:' + m.sediment.frame + '" ' +
      'data-act="open" data-id="' + esc(id) + '" tabindex="0" role="button" ' +
      'aria-label="' + esc(m.name) + ', ' + m.tier + ', ' + fmtCr(v) + ' credits">' +
      '<div class="lcard-top"><span class="lcard-tier">' + m.tier + rarityDots(TIERS[m.tier].dots, 4) + '</span>' +
      (m.artifact ? '<span class="lcard-art" title="' + esc(m.artifact.name) + '">✦</span>' : '') + '</div>' +
      '<h4>' + esc(m.name) + '</h4>' +
      '<div class="lcard-val mono">' + fmtCr(v) + ' Cr <em class="' + (g >= 0 ? 'up' : 'down') + '">' + pct(g) + '</em></div>' +
      '<div class="lcard-meta">' + m.parcels + 'p · ' + esc(m.sediment.name) + '</div>' +
      '<div class="lcard-state s-' + st + '">' + STATE_LABEL[st] + '</div>' +
      '<div class="lcard-spark">' + sparkline(valueSeries(id, 20), 200, 34, 'c' + id) + '</div>' +
      '</article>';
  }).join('');

  const collHtml = HUBS.map(function (h) {
    const st = collectionState(h.id);
    if (!st.count) return '';
    const target = st.next ? st.next.need : (st.active ? st.active.need : 3);
    const p = Math.min(100, (st.count / target) * 100);
    return '<div class="coll">' +
      '<div class="coll-top"><b>' + esc(h.region) + '</b>' +
      '<span class="mono">' + st.count + ' / ' + target + '</span></div>' +
      '<div class="bar"><i style="width:' + p + '%"></i></div>' +
      '<div class="coll-note">' + (st.active
        ? 'Active · yield ×' + st.active.yieldMult + (st.claimed ? ' · bonus paid' : ' · bonus pending hold')
        : (st.next ? '+' + (st.next.need - st.count) + ' more for ×' + st.next.yieldMult + ' and ' + st.next.bonusGems + ' ◇' : '')) +
      '</div></div>';
  }).join('');

  wrap.innerHTML =
    '<section class="hero-val">' +
      '<div class="hero-num"><span class="hero-label">Portfolio NLV</span>' +
      '<span class="hero-big mono">' + fmtCr(pv) + '<em>Cr</em></span>' +
      '<span class="hero-sub">market move <span class="' + (chg >= 0 ? 'up' : 'down') + '">' + pct(chg) +
      '</span> over 30 sim-days &nbsp;·&nbsp; vs cost basis ' + fmtCr(basis) + ' Cr: ' +
      '<span class="' + (pv - basis >= 0 ? 'up' : 'down') + '">' + (pv - basis >= 0 ? '+' : '') + fmtCr(pv - basis) +
      ' Cr (' + pct(basis ? ((pv - basis) / basis) * 100 : 0) + ')</span></span></div>' +
      '<div class="hero-chart">' + sparkline(ps, 620, 90, 'pf') + '</div>' +
    '</section>' +

    (es.length ? '<section class="sect"><h3>Estates <span class="hint">contiguous blocks earn an adjacency premium</span></h3>' +
      '<div class="estates">' + es.map(function (g) {
        const m = cellMeta(g[0]);
        return '<div class="estate-chip"><b>' + esc(m.region) + ' Estate</b>' +
          '<span>' + g.length + ' blocks · ×' + estateFactor(g[0]).toFixed(2) + '</span></div>';
      }).join('') + '</div></section>' : '') +

    (collHtml ? '<section class="sect"><h3>Collections <span class="hint">sets pay a one-off bonus and a standing yield multiplier</span></h3>' +
      '<div class="colls">' + collHtml + '</div></section>' : '') +

    '<section class="sect"><h3>Blocks <span class="hint">' + owned.length + ' held · tap a card to open it</span></h3>' +
    '<div class="lgrid">' + cards + '</div></section>';
}

/* ---- market ---- */
let marketTab = 'book';
function renderMarket() {
  const wrap = document.getElementById('market-body');
  if (!wrap) return;
  resolveBids();
  const tabs = [['book', 'Order book'], ['mine', 'My listings'], ['bids', 'My bids'], ['lease', 'Lease board'], ['bazaar', 'Bazaar'], ['stats', 'Analytics']];
  const tabHtml = '<div class="subtabs" role="tablist">' + tabs.map(function (t) {
    return '<button role="tab" aria-selected="' + (marketTab === t[0]) + '" class="' + (marketTab === t[0] ? 'on' : '') +
      '" data-act="mtab" data-id="' + t[0] + '">' + t[1] + '</button>';
  }).join('') + '</div>';
  wrap.innerHTML = tabHtml + '<div class="subbody">' + marketPane() + '</div>';
}

function marketPane() {
  const day = simDay();
  if (marketTab === 'book') {
    const book = agentListings(day);
    if (!book.length) return '<p class="empty">The book is empty this sim-day.</p>';
    return '<p class="pnote">Blocks other holders have put up for sale. Ask versus appraisal is shown so a bad price is visible before you pay it.</p>' +
      '<table class="tbl"><thead><tr><th>Block</th><th>Tier</th><th>Seller</th><th class="r">Appraisal</th><th class="r">Ask</th><th class="r">Spread</th><th></th></tr></thead><tbody>' +
      book.map(function (l) {
        const m = cellMeta(l.id);
        return '<tr><td><button class="linkish" data-act="open" data-id="' + esc(l.id) + '">' + esc(m.name) + '</button></td>' +
          '<td>' + m.tier + '</td><td class="dim">' + esc(l.seller) + '</td>' +
          '<td class="r mono">' + fmtCr(l.nlv) + '</td>' +
          '<td class="r mono">' + fmtCr(l.ask) + '</td>' +
          '<td class="r mono ' + (l.spread <= 0 ? 'up' : 'down') + '">' + pct(l.spread * 100) + '</td>' +
          '<td class="r"><button class="primary sm" data-act="buy-agent" data-id="' + esc(l.id) + '">Buy</button></td></tr>';
      }).join('') + '</tbody></table>';
  }

  if (marketTab === 'mine') {
    const ids = Object.keys(market.myListings);
    if (!ids.length) return '<p class="empty">Nothing listed. Open a block you hold and choose <b>List for sale</b>.</p>';
    return ids.map(function (id) {
      const L = market.myListings[id];
      const v = nlv(id);
      const offers = offersFor(id);
      const ratio = L.ask / (v || 1);
      return '<div class="listing">' +
        '<div class="listing-head"><button class="linkish" data-act="open" data-id="' + esc(id) + '"><b>' + esc(tName(id)) + '</b></button>' +
        '<span class="mono">ask ' + fmtCr(L.ask) + ' Cr</span></div>' +
        '<div class="listing-meta">appraisal ' + fmtCr(v) + ' Cr · ' +
        '<span class="' + (ratio <= 1 ? 'up' : 'down') + '">' + pct((ratio - 1) * 100) + ' vs appraisal</span> · ' +
        'expires sim-day ' + L.expiresDay + ' · ' +
        (L.acceptCredit ? 'credit offers on' : 'credit offers off') + ' · ' +
        (L.acceptSwap ? 'swaps on' : 'swaps off') + '</div>' +
        (offers.length
          ? '<div class="offers">' + offers.map(function (o) {
              return '<div class="offer"><span><b>' + esc(o.buyer) + '</b>' + (o.swap ? ' <em>swap + cash</em>' : '') + '</span>' +
                '<span class="mono">' + fmtCr(o.amount) + ' Cr</span>' +
                '<span class="offer-esc">held in escrow</span>' +
                '<span class="offer-act">' +
                '<button class="primary sm" data-act="accept-offer" data-id="' + esc(id) + '" data-key="' + esc(o.key) + '">Accept</button>' +
                '<button class="sm" data-act="reject-offer" data-id="' + esc(id) + '" data-key="' + esc(o.key) + '">Decline</button>' +
                '</span></div>';
            }).join('') + '</div>'
          : '<p class="pnote">No offers yet. Offers arrive faster the closer your ask sits to appraisal.</p>') +
        '<div class="listing-act"><button data-act="delist" data-id="' + esc(id) + '">Withdraw listing</button></div>' +
        '</div>';
    }).join('');
  }

  if (marketTab === 'bids') {
    if (!market.myBids.length) return '<p class="empty">No bids placed. You can bid on any agent-held block from its panel — your Credits sit in escrow until they answer.</p>';
    return '<table class="tbl"><thead><tr><th>Block</th><th class="r">Bid</th><th class="r">Appraisal then</th><th>Holder</th><th>Status</th><th></th></tr></thead><tbody>' +
      market.myBids.slice().reverse().map(function (b) {
        return '<tr><td><button class="linkish" data-act="open" data-id="' + esc(b.tileId) + '">' + esc(tName(b.tileId)) + '</button></td>' +
          '<td class="r mono">' + fmtCr(b.amount) + '</td><td class="r mono dim">' + fmtCr(b.nlvAt) + '</td>' +
          '<td class="dim">' + esc(b.holder) + '</td>' +
          '<td><span class="badge b-' + b.status + '">' + b.status + '</span></td>' +
          '<td class="r">' + (b.status === 'open' ? '<button class="sm" data-act="cancel-bid" data-id="' + esc(b.id) + '">Cancel</button>' : '') + '</td></tr>';
      }).join('') + '</tbody></table>';
  }

  if (marketTab === 'lease') {
    const leased = owned.filter(function (id) { return tileData[id] && tileData[id].rental; });
    const head = '<p class="pnote">A block out on lease cannot be sold and cannot receive purchase offers until you recall it. ' +
      'Rate sits against a band derived from appraisal — undercut the band to fill sooner.</p>';
    if (!leased.length) return head + '<p class="empty">Nothing on the lease board. Open an idle block and choose <b>Offer for lease</b>.</p>';
    return head + leased.map(function (id) {
      const r = tileData[id].rental;
      const band = rentBand(id);
      return '<div class="listing"><div class="listing-head">' +
        '<button class="linkish" data-act="open" data-id="' + esc(id) + '"><b>' + esc(tName(id)) + '</b></button>' +
        '<span class="mono">' + r.rate + ' Cr / sim-day</span></div>' +
        '<div class="listing-meta">band ' + band.lo + '–' + band.hi + ' · ' +
        (r.tenantName
          ? 'leased to <b>' + esc(r.tenantName) + '</b> · term ' + r.termDays + ' sim-days' +
            (r.expired ? ' · <span class="down">term ended</span>' : '') +
            ' · accrued <b class="mono">' + Math.round(r.pending || 0) + ' Cr</b>'
          : 'awaiting a tenant · expected in ~' + Math.round(tenantArrivalHours(id, r.rate)) + ' sim-h') +
        '</div><div class="listing-act">' +
        (r.pending ? '<button class="primary" data-act="collect-rent">Collect ' + Math.round(r.pending) + ' Cr</button>' : '') +
        '<button data-act="recall" data-id="' + esc(id) + '">Recall</button></div></div>';
    }).join('');
  }

  if (marketTab === 'bazaar') {
    const j = liveJewels();
    const idx = 0.85 + 0.3 * (0.5 + 0.5 * Math.sin(simDay() / 11.7));
    const head = '<p class="pnote">Items trade on their own book. Land prices and item prices are kept apart on purpose — ' +
      'jewel volume must not leak into the land signal. Item index today: <b class="mono">' + idx.toFixed(3) + '</b>.</p>';
    if (!j.length) return head + '<p class="empty">No jewels surfaced on your blocks right now. Higher-tier land surfaces them more often.</p>';
    return head + '<div class="jewels">' + j.map(function (x) {
      return '<div class="jewel' + (x.expiresIn <= 2 ? ' urgent' : '') + '">' +
        '<div class="jewel-top"><b>' + esc(x.kind) + '</b>' + rarityDots(x.grade, 3) + '</div>' +
        '<div class="jewel-meta">from ' + esc(tName(x.tileId)) + '</div>' +
        '<div class="jewel-life">decays in <b>' + x.expiresIn + '</b> sim-day' + (x.expiresIn > 1 ? 's' : '') + '</div>' +
        '<button class="primary sm" data-act="sell-jewel" data-id="' + esc(x.tileId) + '" data-key="' + x.day + '">Sell · ' +
        Math.round(x.value * idx) + ' Cr</button></div>';
    }).join('') + '</div>';
  }

  // stats
  const rows = HUBS.map(function (h) {
    const tape = regionTape(h.id, 5);
    const avg = tape.reduce(function (s, t) { return s + t.price; }, 0) / (tape.length || 1);
    const mine = regionHoldings(h.id).length;
    return { h: h, avg: avg, tape: tape, mine: mine };
  }).sort(function (a, b) { return b.avg - a.avg; });
  return '<p class="pnote">Cross-region comparables, generated by the same valuation engine that prices your blocks. ' +
    'Nothing here is fetched from outside the page.</p>' +
    '<table class="tbl"><thead><tr><th>Region</th><th class="r">Avg clear</th><th class="r">Blocks you hold</th><th>Latest clears (agents)</th></tr></thead><tbody>' +
    rows.map(function (r) {
      return '<tr><td><b>' + esc(r.h.region) + '</b><br><span class="dim">' + esc(r.h.name) + '</span></td>' +
        '<td class="r mono">' + fmtCr(r.avg) + ' Cr</td>' +
        '<td class="r mono' + (r.mine ? '' : ' dim') + '">' + r.mine + '</td>' +
        '<td class="tape">' + r.tape.slice(0, 3).map(function (t) {
          return '<span>' + t.tier + ' <b class="mono">' + fmtCr(t.price) + '</b> · ' + esc(t.buyer) + '</span>';
        }).join('') + '</td></tr>';
    }).join('') + '</tbody></table>' +
    '<p class="pnote">Simulated tape. Every counterparty above is generated by this page.</p>';
}

/* ---- vault ---- */
function renderVault() {
  const wrap = document.getElementById('vault-body');
  if (!wrap) return;
  refreshRentals();
  const pend = totalPendingResources();
  const pendCr = Math.round(pend * RESOURCE_CR);
  const rentPend = Math.round(owned.reduce(function (s, id) {
    const t = tileData[id]; return s + ((t && t.rental && t.rental.pending) || 0);
  }, 0));
  const builds = owned.filter(function (id) { return tileData[id] && tileData[id].build; });
  const jewels = liveJewels();

  const kinds = {};
  owned.forEach(function (id) {
    const p = pendingResources(id);
    Object.keys(p.byKind).forEach(function (k) { kinds[k] = (kinds[k] || 0) + p.byKind[k]; });
  });

  wrap.innerHTML =
    '<p class="clocknote">Simulated clock: <b>1 sim-day = 4 real minutes</b>. Yield, rent, builds and the market index all run on it.</p>' +

    '<section class="sect"><h3>Resource reservoir <span class="hint">' +
    (owned.length ? 'accruing on ' + owned.length + ' block' + (owned.length > 1 ? 's' : '') : 'claim a block to start') + '</span></h3>' +
    (owned.length
      ? '<div class="yield-row">' +
          RES_KEYS.map(function (k) {
            const R = RESOURCES[k];
            return '<div class="ycard"><span class="ysym" style="color:' + R.color + '">' + R.sym + '</span>' +
              '<b class="mono">' + (kinds[k] || 0).toFixed(1) + '</b><span class="dim">' + R.name + '</span></div>';
          }).join('') +
        '</div>' +
        '<div class="yield-bar"><div class="bar"><i style="width:' +
        Math.min(100, (pend / (owned.reduce(function (s, id) { return s + resourceRate(id) * RES_CAP_HOURS; }, 0) || 1)) * 100) +
        '%"></i></div><span class="dim">Reservoir stops filling at ' + RES_CAP_HOURS + ' sim-hours — come back before it caps.</span></div>' +
        '<button class="primary" data-act="harvest"' + (pendCr > 0 ? '' : ' disabled') + '>Harvest ' +
        pend.toFixed(1) + ' units → ' + pendCr + ' Cr</button>'
      : '<p class="empty">No blocks yet.</p>') +
    '</section>' +

    '<section class="sect"><h3>Lease income</h3>' +
    (rentPend > 0
      ? '<div class="bigline"><b class="mono">' + rentPend + ' Cr</b> accrued <button class="primary" data-act="collect-rent">Collect</button></div>'
      : '<p class="empty">No rent accrued. Offer an idle block for lease from its panel.</p>') +
    '</section>' +

    '<section class="sect"><h3>Construction <span class="hint">Gems are committed, then returned in full</span></h3>' +
    (builds.length
      ? builds.map(function (id) {
          const b = tileData[id].build;
          const bp = BLUEPRINTS[b.key];
          const done = Date.now() >= b.endsAt;
          const p = clamp((Date.now() - b.startedAt) / (b.endsAt - b.startedAt), 0, 1) * 100;
          return '<div class="build"><div class="build-top"><b>' + bp.icon + ' ' + bp.name + '</b>' +
            '<button class="linkish" data-act="open" data-id="' + esc(id) + '">' + esc(tName(id)) + '</button></div>' +
            '<div class="bar"><i style="width:' + p + '%"></i></div>' +
            '<div class="build-foot"><span>' + b.gems + ' ◇ committed · returned on completion</span>' +
            (done ? '<button class="primary sm" data-act="collect-build" data-id="' + esc(id) + '">Collect</button>'
                  : '<span class="mono">' + relTime(b.endsAt - Date.now()) + ' left</span>') +
            '</div></div>';
        }).join('')
      : '<p class="empty">Nothing under construction. Open a block and pick a blueprint.</p>') +
    '</section>' +

    '<section class="sect"><h3>Jewels <span class="hint">surface daily, decay after ' + JEWEL_LIFE_DAYS + ' sim-days</span></h3>' +
    (jewels.length
      ? '<div class="jewels">' + jewels.map(function (x) {
          return '<div class="jewel' + (x.expiresIn <= 2 ? ' urgent' : '') + '">' +
            '<div class="jewel-top"><b>' + esc(x.kind) + '</b>' + rarityDots(x.grade, 3) + '</div>' +
            '<div class="jewel-meta">from ' + esc(tName(x.tileId)) + '</div>' +
            '<div class="jewel-life">decays in <b>' + x.expiresIn + '</b> sim-day' + (x.expiresIn > 1 ? 's' : '') + '</div>' +
            '<button class="primary sm" data-act="sell-jewel" data-id="' + esc(x.tileId) + '" data-key="' + x.day + '">Sell on Bazaar</button></div>';
        }).join('') + '</div>'
      : '<p class="empty">Nothing surfaced right now.</p>') +
    '</section>';
}

/* ---- ledger ---- */
function addToLedger(text, kind) {
  ledger.unshift({ t: Date.now(), text: text, kind: kind || 'note' });
  if (ledger.length > 40) ledger.pop();
  save(LS.ledger, ledger);
  renderLedger();
}
function renderLedger() {
  const el = document.getElementById('ledger');
  if (!el) return;
  if (!ledger.length) { el.innerHTML = '<p class="empty">No activity yet.</p>'; return; }
  el.innerHTML = ledger.map(function (e) {
    const d = new Date(e.t);
    return '<div class="lg k-' + esc(e.kind) + '"><span class="lg-k">' + esc(e.kind) + '</span>' +
      '<span class="lg-t">' + esc(e.text) + '</span>' +
      '<time class="mono">' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') + '</time></div>';
  }).join('');
}

function renderAll() {
  try{renderLtLoop();}catch(e){}
  updateUI();
  renderTilePanel();
  const p = document.getElementById('portfolio-view');
  if (p && p.style.display !== 'none') renderPortfolio();
  const mk = document.getElementById('market-view');
  if (mk && mk.style.display !== 'none') renderMarket();
  const v = document.getElementById('vault-view');
  if (v && v.style.display !== 'none') renderVault();
}

/* ===========================================================================
   17. VOICE CLAIM — real microphone energy, with a full keyboard alternative
   Voice energy is measured (RMS from an AnalyserNode), not invented.
   ========================================================================= */
let voiceEnergy = 0;
window.getVoiceSurprise = function () { return voiceEnergy; };

function voiceTargetId() {
  if (selectedId && !isOwned(selectedId) && baseCellState(selectedId) === 'virgin') return selectedId;
  // Otherwise pick the nearest never-minted block to the current map centre.
  const c = map ? map.getCenter() : { lat: 37.5, lng: 127 };
  for (let ring = 0; ring < 12; ring++) {
    for (let dy = -ring; dy <= ring; dy++) {
      for (let dx = -ring; dx <= ring; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
        const cell = cellOf(c.lat + dy * GRID, c.lng + dx * GRID);
        if (!isOwned(cell.id) && baseCellState(cell.id) === 'virgin') return cell.id;
      }
    }
  }
  return cellOf(c.lat, c.lng).id;
}

async function claimWithVoice() {
  const status = document.getElementById('voice-status');
  const meter = document.getElementById('voice-meter');
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    status.innerHTML = 'No microphone available. Use <b>Claim without voice</b> below — it gives the baseline boost.';
    return;
  }
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (e) {
    status.innerHTML = 'Microphone blocked. Use <b>Claim without voice</b> below — nothing is gated behind the mic.';
    return;
  }
  const Ctx = window.AudioContext || window.webkitAudioContext;
  const ctx = new Ctx();
  const src = ctx.createMediaStreamSource(stream);
  const an = ctx.createAnalyser();
  an.fftSize = 1024;
  src.connect(an);
  const buf = new Uint8Array(an.fftSize);
  let peak = 0, sum = 0, n = 0;
  status.textContent = 'Listening — speak your claim.';
  const t0 = Date.now();
  const timer = setInterval(function () {
    an.getByteTimeDomainData(buf);
    let acc = 0;
    for (let i = 0; i < buf.length; i++) { const x = (buf[i] - 128) / 128; acc += x * x; }
    const rms = Math.sqrt(acc / buf.length);
    peak = Math.max(peak, rms); sum += rms; n++;
    if (meter) meter.style.setProperty('--lvl', Math.min(100, rms * 320) + '%');
    if (Date.now() - t0 > 3000) {
      clearInterval(timer);
      stream.getTracks().forEach(function (t) { t.stop(); });
      ctx.close();
      // Energy = blend of peak and sustained level, mapped to 0..1.
      voiceEnergy = clamp((peak * 0.6 + (sum / Math.max(1, n)) * 2.2) * 2.4, 0.05, 1);
      if (meter) meter.style.setProperty('--lvl', (voiceEnergy * 100) + '%');
      status.innerHTML = 'Measured voice energy <b class="mono">' + voiceEnergy.toFixed(2) + '</b> — ' +
        'starting vitality +' + (voiceEnergy * 0.5).toFixed(2) + ', aura +' + (voiceEnergy * 0.4).toFixed(2) +
        ', and every build on that block gains +' + Math.round(voiceEnergy * 60) + '%.';
      const id = voiceTargetId();
      claimVirgin(id, voiceEnergy);
    }
  }, 80);
}

function claimWithoutVoice() {
  voiceEnergy = 0.35;
  const status = document.getElementById('voice-status');
  if (status) status.innerHTML = 'Baseline energy <b class="mono">0.35</b> applied — no microphone needed.';
  claimVirgin(voiceTargetId(), voiceEnergy);
}

/* ===========================================================================
   18. DEEP LINKS — a block and a view are addressable
   ========================================================================= */
function setHash(id) {
  const h = '#block=' + id;
  if (location.hash !== h) history.replaceState(null, '', h);
}
function readHash() {
  const m = /block=([A-Za-z0-9_\-]+)/.exec(location.hash || '');
  if (m && cellLatLng(m[1])) return m[1];
  return null;
}
function shareTile(id) {
  const url = location.origin + location.pathname + '#block=' + id;
  const done = function () {
    toast('Link copied — opens straight on this block', 'good');
    if (window.legionTrack) window.legionTrack('share');
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(url).then(done, function () { fallbackCopy(url, done); });
  } else fallbackCopy(url, done);
}
function fallbackCopy(text, cb) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed'; ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); cb(); } catch (e) { toast('Copy failed — ' + text, 'warn'); }
  document.body.removeChild(ta);
}

/* Keyboard/no-map path: jump to a hub or type coordinates. */
function jumpToHub(hubId) {
  const h = HUBS.filter(function (x) { return x.id === hubId; })[0];
  if (!h) return;
  const cell = cellOf(h.lat, h.lng);
  selectTile(cell.id, { fly: true });
}
function jumpToCoords() {
  const la = parseFloat(document.getElementById('jump-lat').value);
  const ln = parseFloat(document.getElementById('jump-lng').value);
  if (isNaN(la) || isNaN(ln)) { toast('Enter a latitude and longitude.', 'warn'); return; }
  selectTile(cellOf(clamp(la, -84, 84), ln).id, { fly: true });
}

/* ===========================================================================
   19. WORLD TICK — one deterministic heartbeat
   ========================================================================= */
function worldTick() {
  const d = simDay();
  refreshRentals();
  const bidsChanged = resolveBids();
  owned.forEach(snapshotValue);
  checkCollections();
  // Expire stale listings.
  Object.keys(market.myListings).forEach(function (id) {
    if (market.myListings[id].expiresDay < d) {
      delete market.myListings[id];
      addToLedger('Listing on ' + tName(id) + ' expired unsold.', 'market');
    }
  });
  if (market.lastTick !== d) {
    market.lastTick = d;
    invalidateDerived();
    if (map) scheduleRedraw();   // demand field + hub anchors drift with the sim-day
    if (owned.length) announce('Sim-day ' + d + '. Market index ' + marketIndex(d).toFixed(3) + '.');
  }
  saveAll();
  updateUI();
  const v = document.getElementById('vault-view');
  if (v && v.style.display !== 'none') renderVault();
  const mk = document.getElementById('market-view');
  if (mk && mk.style.display !== 'none' && bidsChanged) renderMarket();
  const dEl = document.getElementById('sim-day');
  if (dEl) dEl.textContent = 'sim-day ' + d + ' · index ' + marketIndex(d).toFixed(3);
}

// Kept under its historical name; it is now a deterministic tick, not a dice roll.
function reobserveLand() { worldTick(); }

/* ===========================================================================
   20. EVENT WIRING — one delegated listener, no inline handlers with user data
   ========================================================================= */
document.addEventListener('click', function (e) {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const act = el.getAttribute('data-act');
  const id = el.getAttribute('data-id');
  const key = el.getAttribute('data-key');

  if (act === 'dlg-cancel') { closeDialog(null); return; }
  if (act === 'dlg-ok') { closeDialog(true); return; }
  if (act === 'dlg-submit') { const v = readDialogForm(); closeDialog(v); return; }

  switch (act) {
    case 'nav': showView(el.getAttribute('data-view')); break;
    case 'connect': connectWallet(); break;
    case 'open': selectTile(id, { fly: true }); break;
    case 'close-panel': selectedId = null; renderTilePanel(); if (selectRing && map) { map.removeLayer(selectRing); selectRing = null; } break;
    case 'claim': claimVirgin(id, voiceEnergy || 0); break;
    case 'buy-agent': buyFromAgent(id); break;
    case 'bid': placeBid(id); break;
    case 'cancel-bid': cancelBid(id); break;
    case 'list': listForSale(id); break;
    case 'delist': delistTile(id); break;
    case 'accept-offer': acceptOffer(id, key); break;
    case 'reject-offer': rejectOffer(id, key); break;
    case 'settle': sellTile(id); break;
    case 'rent': listForRent(id); break;
    case 'recall': recallLease(id); break;
    case 'collect-rent': collectRent(); break;
    case 'harvest': harvestAll(); break;
    case 'collect-build': collectBuild(id); break;
    case 'sell-jewel': {
      const j = jewelOn(id, +key);
      if (j) sellJewel(j);
      break;
    }
    case 'live': hostLiveTour(id); break;
    case 'share': shareTile(id); break;
    case 'mtab': marketTab = id; renderMarket(); break;
    case 'jump-hub': jumpToHub(document.getElementById('jump-hub').value); break;
    case 'jump-coords': jumpToCoords(); break;
    case 'voice': claimWithVoice(); break;
    case 'voice-skip': claimWithoutVoice(); break;
    case 'layer': {
      LAYERS[id].on = !LAYERS[id].on;
      el.classList.toggle('off', !LAYERS[id].on);
      el.setAttribute('aria-pressed', String(LAYERS[id].on));
      redrawMap();
      break;
    }
    default: break;
  }
  if (act.indexOf('build:') === 0) startBuild(id, act.split(':')[1]);
});

// Cards are keyboard-operable; Escape closes dialogs and the panel.
document.addEventListener('keydown', function (e) {
  if (e.key === 'Escape') {
    const root = document.getElementById('dialog-root');
    if (root && root.classList.contains('open')) { closeDialog(null); return; }
    if (selectedId) { selectedId = null; renderTilePanel(); if (selectRing && map) { map.removeLayer(selectRing); selectRing = null; } }
    return;
  }
  if ((e.key === 'Enter' || e.key === ' ') && document.activeElement) {
    const el = document.activeElement.closest && document.activeElement.closest('[data-act="open"]');
    if (el && el.tagName !== 'BUTTON') { e.preventDefault(); selectTile(el.getAttribute('data-id'), { fly: true }); }
  }
  if (e.key === 'Enter' && dlgResolve) {
    const root = document.getElementById('dialog-root');
    const sub = root && (root.querySelector('[data-act="dlg-submit"]') || root.querySelector('[data-act="dlg-ok"]'));
    if (sub) sub.click();
  }
});

window.addEventListener('hashchange', function () {
  const id = readHash();
  if (id && id !== selectedId) selectTile(id, { fly: true });
});

/* ===========================================================================
   21. BOOT
   ========================================================================= */
function buildLayerLegend() {
  const el = document.getElementById('map-legend');
  if (!el) return;
  el.innerHTML = Object.keys(LAYERS).map(function (k) {
    const L2 = LAYERS[k];
    return '<button class="lg-item" data-act="layer" data-id="' + k + '" aria-pressed="true" ' +
      'title="Toggle the ' + L2.label + ' layer">' +
      '<i style="background:' + L2.color + '"></i>' + L2.label + '</button>';
  }).join('');
}
function buildHubSelect() {
  const el = document.getElementById('jump-hub');
  if (!el) return;
  el.innerHTML = HUBS.map(function (h) {
    return '<option value="' + h.id + '">' + esc(h.name) + ' — ' + esc(h.region) + '</option>';
  }).join('');
}

function initApp() {
  // Legacy tiles from earlier builds may sit off-grid; snap them onto the grid.
  Object.keys(tileData).forEach(function (id) {
    if (!cellLatLng(id)) {
      const t = tileData[id];
      if (t && typeof t.lat === 'number') {
        const c = cellOf(t.lat, t.lng);
        if (!tileData[c.id]) tileData[c.id] = Object.assign({}, t);
        const i = owned.indexOf(id);
        if (i !== -1) owned[i] = c.id;
      } else {
        const i = owned.indexOf(id);
        if (i !== -1) owned.splice(i, 1);
      }
      delete tileData[id];
    }
  });
  owned = owned.filter(function (id, i, a) { return a.indexOf(id) === i && cellLatLng(id); });
  invalidateDerived();

  if (wallet.linked) {
    const b = document.querySelector('[data-act="connect"]');
    if (b) { b.textContent = 'Wallet linked'; b.disabled = true; }
  }

  buildLayerLegend();
  buildHubSelect();
  updateUI();
  renderLedger();
  showView('map-view');

  setTimeout(function () {
    initMap();
    const deep = readHash();
    if (deep) selectTile(deep, { fly: true });
    else if (owned.length) flyToTile(owned[0]);
    redrawMap();
  }, 60);

  worldTick();
  setInterval(worldTick, 5000);
  saveAll();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}

/* LEGION_WAVE_3_share_counter */
document.addEventListener('click',function(ev){try{var el=ev.target;if(!el)return;var tx=(el.textContent||'')+(el.id||'');if(/share|copy/i.test(tx)||/\uacf5\uc720|\ubcf5\uc0ac/.test(tx)){localStorage.setItem('lw_p11_earth2_m_share_counter',String((+(localStorage.getItem('lw_p11_earth2_m_share_counter')||0))+1));}}catch(e){}},true);

/* LEGION_WAVE_48_pipe_ensure */

(function(){try{
  if(document.getElementById('moneyPipe'))return;
  var d=document.createElement('div');
  d.innerHTML='<div id="moneyPipe" style="margin-top:12px;padding:10px;border:1px solid #c5a46e44;border-radius:12px;background:#16121c;text-align:center;font-size:12px"><div style="color:#e0b552;font-weight:700;margin-bottom:4px">pipe</div><a style="color:#ece8f1;margin:0 6px" href="mailto:hoyashi95@gmail.com?subject=%5BLegion%5D">mail</a><a style="color:#e0b552;margin:0 6px" href="https://hosuman08-netizen.github.io/legion-hub/">Hub</a></div>';
  var app=document.getElementById('app')||document.body;
  app.appendChild(d.firstElementChild||d);
}catch(e){}})();

