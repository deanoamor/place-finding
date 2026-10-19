const { CATEGORIES, polygonAreaKm2, circleAreaKm2, buildQuery, elementToPlace, toCsv, toGeoJson, groupTags, safeHref, primaryType } = PlaceLib;

const OVERPASS_URLS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];
const MAX_AREA_KM2 = 500; // batasi supaya tidak membebani server publik Overpass

const $ = (id) => document.getElementById(id);
const els = {
  category: $('category'), customTag: $('custom-tag'), customKey: $('custom-key'), customValue: $('custom-value'),
  search: $('search'), clear: $('clear'), status: $('status'),
  resultsHead: $('results-head'), count: $('count'), results: $('results'),
  geocode: $('geocode'), geocodeQ: $('geocode-q'),
};

// ---- peta ----
const map = L.map('map').setView([-6.9175, 107.6191], 12); // Bandung
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
}).addTo(map);

const drawn = new L.FeatureGroup().addTo(map);
const markers = L.layerGroup().addTo(map);

// Toolbar bawaan hanya dipakai untuk edit; menggambar lewat tombol di panel.
map.addControl(new L.Control.Draw({
  position: 'topleft',
  edit: { featureGroup: drawn, remove: false },
  draw: false,
}));

const SHAPE = { color: '#2563eb', weight: 3 };
const TOOLS = {
  polygon: { hint: 'Klik peta untuk menaruh titik sudut. Klik titik pertama untuk menutup area.', make: () => new L.Draw.Polygon(map, { allowIntersection: false, showArea: false, shapeOptions: SHAPE }) },
  rectangle: { hint: 'Tekan dan tarik di peta untuk membuat kotak.', make: () => new L.Draw.Rectangle(map, { shapeOptions: SHAPE }) },
  circle: { hint: 'Tekan di pusat lalu tarik untuk menentukan radius.', make: () => new L.Draw.Circle(map, { shapeOptions: SHAPE }) },
  freehand: { hint: 'Tekan dan geser di peta untuk mencoret batas area. Lepas untuk menutupnya.' },
};
const DEFAULT_HINT = 'Pilih salah satu bentuk, lalu gambar langsung di peta.';

let activeTool = null;
let activeHandler = null;
const fh = { drawing: false, pts: [], line: null };
const mapEl = map.getContainer();

function setTool(name) {
  activeTool = name;
  for (const b of document.querySelectorAll('#tools button')) b.setAttribute('aria-pressed', String(b.dataset.tool === name));
  $('tool-hint').textContent = name ? TOOLS[name].hint : DEFAULT_HINT;
  mapEl.classList.toggle('freehand', name === 'freehand');
}

function stopTool() {
  if (activeHandler) { activeHandler.disable(); activeHandler = null; }
  if (fh.line) { map.removeLayer(fh.line); fh.line = null; }
  fh.drawing = false;
  map.dragging.enable();
  setTool(null);
}

function startTool(name) {
  stopTool();
  setTool(name);
  if (name === 'freehand') { map.dragging.disable(); return; }
  activeHandler = TOOLS[name].make();
  activeHandler.enable();
}

for (const b of document.querySelectorAll('#tools button')) {
  b.addEventListener('click', () => (activeTool === b.dataset.tool ? stopTool() : startTool(b.dataset.tool)));
}
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') stopTool(); });

function setArea(layer) {
  drawn.clearLayers(); // satu area aktif
  drawn.addLayer(layer);
  syncButtons();
}

map.on(L.Draw.Event.CREATED, (e) => { setArea(e.layer); stopTool(); });
map.on(L.Draw.Event.DRAWSTOP, () => { if (activeTool !== 'freehand') { activeHandler = null; setTool(null); } });
map.on(L.Draw.Event.EDITED, syncButtons);

// ---- coret bebas ----
const FH_MIN_PX = 6;   // jarak minimum antar titik
const FH_MAX_PTS = 250; // batasi titik supaya query Overpass tetap ringan

function thin(latlngs) {
  const out = [];
  let last = null;
  for (const ll of latlngs) {
    const p = map.latLngToContainerPoint(ll);
    if (!last || last.distanceTo(p) >= FH_MIN_PX) { out.push(ll); last = p; }
  }
  if (out.length > FH_MAX_PTS) {
    const step = Math.ceil(out.length / FH_MAX_PTS);
    return out.filter((_, i) => i % step === 0);
  }
  return out;
}

mapEl.addEventListener('pointerdown', (e) => {
  if (activeTool !== 'freehand' || e.button > 0 || e.target.closest('.leaflet-control')) return;
  fh.drawing = true;
  fh.pts = [map.mouseEventToLatLng(e)];
  fh.line = L.polyline(fh.pts, SHAPE).addTo(map);
  mapEl.setPointerCapture(e.pointerId);
  e.preventDefault();
});
mapEl.addEventListener('pointermove', (e) => {
  if (!fh.drawing) return;
  fh.pts.push(map.mouseEventToLatLng(e));
  fh.line.setLatLngs(fh.pts);
});
function finishFreehand() {
  if (!fh.drawing) return;
  const pts = thin(fh.pts);
  stopTool();
  if (pts.length < 3) { setStatus('Coretan terlalu pendek. Coba gambar area yang lebih besar.', true); return; }
  setStatus('');
  setArea(L.polygon(pts, SHAPE));
}
mapEl.addEventListener('pointerup', finishFreehand);
mapEl.addEventListener('pointercancel', finishFreehand);

// ---- UI ----
for (const c of CATEGORIES) els.category.add(new Option(c.label, `${c.key}=${c.value}`));
els.category.add(new Option('Kustom (key=value OSM)…', 'custom'));
els.category.addEventListener('change', () => { els.customTag.hidden = els.category.value !== 'custom'; });

function syncButtons() {
  const has = drawn.getLayers().length > 0;
  els.search.disabled = !has;
  els.clear.disabled = !has;
}

function setStatus(msg, isError) {
  els.status.textContent = msg;
  els.status.className = isError ? 'error' : '';
}

els.clear.addEventListener('click', () => {
  stopTool();
  drawn.clearLayers();
  markers.clearLayers();
  els.results.replaceChildren();
  places = [];
  closeDetail();
  els.resultsHead.hidden = true;
  setStatus('');
  syncButtons();
});

// ---- ambil area dari layer gambar ----
function currentArea() {
  const layer = drawn.getLayers()[0];
  if (!layer) return null;
  if (layer instanceof L.Circle) {
    const c = layer.getLatLng();
    return { type: 'circle', center: [c.lat, c.lng], radius: layer.getRadius() };
  }
  const latlngs = layer.getLatLngs();
  const ring = (Array.isArray(latlngs[0]) ? latlngs[0] : latlngs).map((p) => [p.lat, p.lng]);
  return { type: 'polygon', ring };
}

function areaKm2(area) {
  return area.type === 'circle' ? circleAreaKm2(area.radius) : polygonAreaKm2(area.ring);
}

function currentTag() {
  if (els.category.value === 'custom') return [els.customKey.value.trim(), els.customValue.value.trim()];
  return els.category.value.split('=');
}

// ---- Overpass ----
async function runOverpass(query) {
  let lastErr;
  for (const url of OVERPASS_URLS) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'data=' + encodeURIComponent(query),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

let places = [];

els.search.addEventListener('click', async () => {
  const area = currentArea();
  if (!area) return;

  const km2 = areaKm2(area);
  if (km2 > MAX_AREA_KM2) {
    setStatus(`Area terlalu luas (${km2.toFixed(0)} km², maks ${MAX_AREA_KM2} km²). Perkecil area.`, true);
    return;
  }

  const [key, value] = currentTag();
  let query;
  try {
    query = buildQuery(area, key, value);
  } catch (err) {
    setStatus(err.message, true);
    return;
  }

  els.search.disabled = true;
  setStatus('Mencari…');
  try {
    const data = await runOverpass(query);
    places = data.elements.map(elementToPlace).filter(Boolean);
    render(places);
    setStatus(places.length ? '' : 'Tidak ada tempat ditemukan di area ini.');
  } catch (err) {
    setStatus(`Gagal mengambil data (${err.message}). Coba lagi sebentar.`, true);
  } finally {
    syncButtons();
  }
});

// ---- render hasil (textContent saja: data OSM tidak dipercaya) ----
const detailEl = $('detail');
let openPlaceId = null;

function render(list) {
  closeDetail();
  markers.clearLayers();
  els.results.replaceChildren();
  els.resultsHead.hidden = list.length === 0;
  els.count.textContent = `${list.length} tempat`;

  for (const p of list) {
    const marker = L.marker([p.lat, p.lon], { title: p.name }).addTo(markers);
    marker.on('click', () => showDetail(p));

    const li = document.createElement('li');
    const name = document.createElement('div');
    name.className = 'name';
    name.textContent = p.name;
    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.textContent = [primaryType(p.tags), p.address].filter(Boolean).join(' · ') || 'Alamat tidak tersedia';
    li.append(name, meta);
    li.addEventListener('click', () => showDetail(p));
    els.results.appendChild(li);
  }
}

function el(tag, props, ...kids) {
  const n = document.createElement(tag);
  if (props) Object.assign(n, props);
  n.append(...kids.filter((k) => k != null));
  return n;
}

function link(href, text) {
  return el('a', { href, textContent: text, target: '_blank', rel: 'noopener noreferrer' });
}

// Satu nilai tag -> node; tautan hanya bila lolos validasi safeHref.
function valueNode(row, v) {
  const href = row.kind === 'text' ? null : safeHref(row.kind, row.key, v);
  return href ? link(href, v) : document.createTextNode(v);
}

function fmtDate(ts) {
  const d = new Date(ts);
  return isNaN(d) ? ts : d.toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' });
}

function showDetail(p) {
  openPlaceId = p.id;
  map.setView([p.lat, p.lon], Math.max(map.getZoom(), 17));

  $('d-name').textContent = p.name;
  const sub = $('d-sub'); sub.replaceChildren();
  const type = primaryType(p.tags);
  if (type) sub.append(el('span', { className: 'chip', textContent: type }));
  sub.append(`${p.lat.toFixed(6)}, ${p.lon.toFixed(6)}`);

  const actions = $('d-actions'); actions.replaceChildren(
    link(`https://www.openstreetmap.org/directions?to=${p.lat}%2C${p.lon}`, 'Rute (OSM)'),
    link(`https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lon}`, 'Buka di Google Maps'),
    link(p.osmUrl, 'Lihat di OSM'),
  );
  const copy = el('a', { href: '#', textContent: 'Salin koordinat' });
  copy.addEventListener('click', async (e) => {
    e.preventDefault();
    try { await navigator.clipboard.writeText(`${p.lat}, ${p.lon}`); copy.textContent = 'Tersalin'; } catch { copy.textContent = `${p.lat}, ${p.lon}`; }
  });
  actions.append(copy);

  const body = $('d-body'); body.replaceChildren();
  const groups = groupTags(p.tags);
  if (!groups.length) body.append(el('p', { className: 'hint', textContent: 'Tempat ini belum punya data tambahan di OSM.' }));
  for (const g of groups) {
    const dl = el('dl');
    for (const row of g.rows) {
      const dd = el('dd');
      const vals = row.values || [row.value];
      for (const v of vals) dd.append(el('div', null, valueNode(row, v)));
      const dt = el('dt', { textContent: row.label || row.key });
      if (row.label && row.label !== row.key) dt.append(el('span', { className: 'raw', textContent: row.key }));
      dl.append(el('div', { className: 'd-row' }, dt, dd));
    }
    body.append(el('section', { className: 'd-group' }, el('h3', { textContent: g.title }), dl));
  }

  // info objek OSM
  const m = p.meta || {};
  const info = [['Objek', `${p.osmType} ${p.osmId}`], ['Versi', m.version], ['Terakhir diubah', m.timestamp && fmtDate(m.timestamp)],
    ['Pengubah', m.user], ['Changeset', m.changeset]].filter(([, v]) => v != null && v !== '');
  const idl = el('dl');
  for (const [k, v] of info) idl.append(el('div', { className: 'd-row' }, el('dt', { textContent: k }), el('dd', { textContent: String(v) })));
  body.append(el('section', { className: 'd-group' }, el('h3', { textContent: 'Info OSM' }), idl));

  // semua tag mentah
  const keys = Object.keys(p.tags || {}).sort();
  $('d-count').textContent = keys.length;
  const table = $('d-table'); table.replaceChildren();
  for (const k of keys) table.append(el('tr', null, el('td', { textContent: k }), el('td', { textContent: p.tags[k] })));

  els.resultsHead.hidden = true;
  els.results.hidden = true;
  detailEl.hidden = false;
  detailEl.scrollIntoView({ block: 'nearest' });
}

function closeDetail() {
  openPlaceId = null;
  detailEl.hidden = true;
  els.results.hidden = false;
  els.resultsHead.hidden = places.length === 0;
}
$('back').addEventListener('click', closeDetail);

// ---- ekspor ----
function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
}
$('dl-csv').addEventListener('click', () => download('places.csv', toCsv(places), 'text/csv;charset=utf-8'));
$('dl-json').addEventListener('click', () => download('places.geojson', JSON.stringify(toGeoJson(places), null, 2), 'application/geo+json'));

// ---- pindah lokasi (Nominatim) ----
els.geocode.addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = els.geocodeQ.value.trim();
  if (!text) return;
  setStatus('Mencari lokasi…');
  try {
    const res = await fetch('https://nominatim.openstreetmap.org/search?format=json&limit=1&q=' + encodeURIComponent(text));
    const [hit] = await res.json();
    if (!hit) { setStatus('Lokasi tidak ditemukan.', true); return; }
    const [s, n, w, ea] = hit.boundingbox.map(Number);
    map.fitBounds([[s, w], [n, ea]]);
    setStatus('');
  } catch {
    setStatus('Gagal mencari lokasi.', true);
  }
});
