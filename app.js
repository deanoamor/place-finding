const { CATEGORIES, polygonAreaKm2, circleAreaKm2, buildQuery, elementToPlace, toCsv, toGeoJson } = PlaceLib;

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

map.addControl(new L.Control.Draw({
  position: 'topleft',
  edit: { featureGroup: drawn, remove: false },
  draw: { polygon: { allowIntersection: false, showArea: false }, rectangle: true, circle: true, polyline: false, marker: false, circlemarker: false },
}));

map.on(L.Draw.Event.CREATED, (e) => {
  drawn.clearLayers(); // satu area aktif
  drawn.addLayer(e.layer);
  syncButtons();
});
map.on(L.Draw.Event.EDITED, syncButtons);

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
  drawn.clearLayers();
  markers.clearLayers();
  els.results.replaceChildren();
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
function render(list) {
  markers.clearLayers();
  els.results.replaceChildren();
  els.resultsHead.hidden = list.length === 0;
  els.count.textContent = `${list.length} tempat`;

  for (const p of list) {
    const marker = L.marker([p.lat, p.lon]).addTo(markers);
    marker.bindPopup(() => popupNode(p));

    const li = document.createElement('li');
    const name = document.createElement('div');
    name.className = 'name';
    name.textContent = p.name;
    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.textContent = p.address || 'Alamat tidak tersedia';
    li.append(name, meta);
    li.addEventListener('click', () => {
      map.setView([p.lat, p.lon], Math.max(map.getZoom(), 17));
      marker.openPopup();
    });
    els.results.appendChild(li);
  }
}

function popupNode(p) {
  const box = document.createElement('div');
  const title = document.createElement('strong');
  title.textContent = p.name;
  box.appendChild(title);
  for (const [label, val] of [['Alamat', p.address], ['Telepon', p.phone], ['Jam buka', p.opening_hours]]) {
    if (!val) continue;
    box.appendChild(document.createElement('br'));
    box.appendChild(document.createTextNode(`${label}: ${val}`));
  }
  if (/^https?:\/\//i.test(p.website)) {
    box.appendChild(document.createElement('br'));
    const a = document.createElement('a');
    a.href = p.website; a.textContent = 'Website'; a.target = '_blank'; a.rel = 'noopener';
    box.appendChild(a);
  }
  return box;
}

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
