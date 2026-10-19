// Logika murni (tanpa DOM) supaya mudah dites di Node.
(function (root) {
  const CATEGORIES = [
    { label: 'Kafe', key: 'amenity', value: 'cafe' },
    { label: 'Restoran', key: 'amenity', value: 'restaurant' },
    { label: 'Rumah sakit', key: 'amenity', value: 'hospital' },
    { label: 'Klinik', key: 'amenity', value: 'clinic' },
    { label: 'Apotek', key: 'amenity', value: 'pharmacy' },
    { label: 'Bank', key: 'amenity', value: 'bank' },
    { label: 'ATM', key: 'amenity', value: 'atm' },
    { label: 'SPBU', key: 'amenity', value: 'fuel' },
    { label: 'Sekolah', key: 'amenity', value: 'school' },
    { label: 'Masjid', key: 'building', value: 'mosque' },
    { label: 'Hotel', key: 'tourism', value: 'hotel' },
    { label: 'Objek wisata', key: 'tourism', value: 'attraction' },
    { label: 'Supermarket', key: 'shop', value: 'supermarket' },
    { label: 'Minimarket', key: 'shop', value: 'convenience' },
  ];

  const R = 6371008.8; // jari-jari bumi (m)

  // Area poligon (km²) memakai rumus spherical excess; ring = [[lat, lng], ...]
  function polygonAreaKm2(ring) {
    if (ring.length < 3) return 0;
    let sum = 0;
    for (let i = 0; i < ring.length; i++) {
      const [lat1, lng1] = ring[i];
      const [lat2, lng2] = ring[(i + 1) % ring.length];
      sum += rad(lng2 - lng1) * (2 + Math.sin(rad(lat1)) + Math.sin(rad(lat2)));
    }
    return Math.abs((sum * R * R) / 2) / 1e6;
  }

  function circleAreaKm2(radiusM) {
    return (Math.PI * radiusM * radiusM) / 1e6;
  }

  function rad(d) { return (d * Math.PI) / 180; }

  // Escape nilai untuk string literal Overpass QL.
  function q(s) {
    return '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
  }

  // area: {type:'polygon', ring:[[lat,lng]...]} | {type:'circle', center:[lat,lng], radius}
  function buildQuery(area, key, value, timeout) {
    if (!/^[A-Za-z0-9_:.-]+$/.test(key)) throw new Error('Key tag tidak valid');
    if (!/^[A-Za-z0-9_:.;-]+$/.test(value)) throw new Error('Value tag tidak valid');

    let filter;
    if (area.type === 'circle') {
      const [lat, lng] = area.center;
      filter = `(around:${Math.round(area.radius)},${lat.toFixed(6)},${lng.toFixed(6)})`;
    } else {
      const pts = area.ring.map(([lat, lng]) => `${lat.toFixed(6)} ${lng.toFixed(6)}`).join(' ');
      filter = `(poly:"${pts}")`;
    }
    const tag = `[${q(key)}=${q(value)}]`;
    return `[out:json][timeout:${timeout || 60}];nwr${tag}${filter};out center tags;`;
  }

  // Elemen Overpass -> objek tempat sederhana (null kalau tak ada koordinat).
  function elementToPlace(el) {
    const lat = el.lat != null ? el.lat : el.center && el.center.lat;
    const lon = el.lon != null ? el.lon : el.center && el.center.lon;
    if (lat == null || lon == null) return null;
    const t = el.tags || {};
    const addr = [
      [t['addr:street'], t['addr:housenumber']].filter(Boolean).join(' '),
      t['addr:suburb'] || t['addr:village'],
      t['addr:city'] || t['addr:town'],
      t['addr:postcode'],
    ].filter(Boolean).join(', ');
    return {
      id: `${el.type}/${el.id}`,
      name: t.name || '(tanpa nama)',
      lat, lon,
      address: addr,
      phone: t.phone || t['contact:phone'] || '',
      website: t.website || t['contact:website'] || '',
      opening_hours: t.opening_hours || '',
    };
  }

  function csvCell(v) {
    let s = String(v == null ? '' : v);
    // cegah formula injection saat CSV dibuka di spreadsheet
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  const CSV_COLS = ['id', 'name', 'lat', 'lon', 'address', 'phone', 'website', 'opening_hours'];

  function toCsv(places) {
    const rows = [CSV_COLS.join(',')];
    for (const p of places) rows.push(CSV_COLS.map((c) => csvCell(p[c])).join(','));
    return rows.join('\n');
  }

  function toGeoJson(places) {
    return {
      type: 'FeatureCollection',
      features: places.map((p) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
        properties: { id: p.id, name: p.name, address: p.address, phone: p.phone, website: p.website, opening_hours: p.opening_hours },
      })),
    };
  }

  const api = { CATEGORIES, polygonAreaKm2, circleAreaKm2, buildQuery, elementToPlace, toCsv, toGeoJson };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PlaceLib = api;
})(typeof self !== 'undefined' ? self : this);
