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
    return `[out:json][timeout:${timeout || 60}];nwr${tag}${filter};out center tags meta;`;
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
      osmType: el.type,
      osmId: el.id,
      osmUrl: `https://www.openstreetmap.org/${el.type}/${el.id}`,
      name: t.name || '(tanpa nama)',
      lat, lon,
      address: addr,
      phone: t.phone || t['contact:phone'] || '',
      website: t.website || t['contact:website'] || '',
      opening_hours: t.opening_hours || '',
      tags: t,
      meta: {
        version: el.version, timestamp: el.timestamp, changeset: el.changeset,
        user: el.user, uid: el.uid,
      },
    };
  }

  // ---- detail tempat: kelompokkan semua tag OSM ----
  const TYPE_KEYS = ['amenity', 'shop', 'tourism', 'leisure', 'office', 'craft', 'healthcare', 'building',
    'historic', 'man_made', 'sport', 'public_transport', 'highway', 'railway', 'natural', 'landuse', 'place'];

  const LABELS = {
    name: 'Nama', alt_name: 'Nama lain', old_name: 'Nama lama', official_name: 'Nama resmi', short_name: 'Nama singkat',
    loc_name: 'Nama lokal', brand: 'Merek', operator: 'Pengelola', network: 'Jaringan', description: 'Deskripsi', note: 'Catatan',
    wikipedia: 'Wikipedia', wikidata: 'Wikidata', image: 'Gambar', wikimedia_commons: 'Wikimedia Commons',
    amenity: 'Amenity', shop: 'Toko', tourism: 'Wisata', leisure: 'Rekreasi', office: 'Kantor', building: 'Bangunan',
    healthcare: 'Layanan kesehatan', historic: 'Bersejarah', sport: 'Olahraga',
    'addr:full': 'Alamat lengkap', 'addr:housenumber': 'Nomor', 'addr:housename': 'Nama gedung', 'addr:street': 'Jalan',
    'addr:suburb': 'Kelurahan/desa', 'addr:subdistrict': 'Kecamatan', 'addr:district': 'Kabupaten/distrik', 'addr:village': 'Desa',
    'addr:city': 'Kota', 'addr:town': 'Kota kecil', 'addr:state': 'Provinsi', 'addr:province': 'Provinsi',
    'addr:postcode': 'Kode pos', 'addr:country': 'Negara', 'addr:floor': 'Lantai', 'addr:unit': 'Unit',
    phone: 'Telepon', 'contact:phone': 'Telepon', mobile: 'HP', 'contact:mobile': 'HP', fax: 'Fax', 'contact:fax': 'Fax',
    email: 'Email', 'contact:email': 'Email', website: 'Website', 'contact:website': 'Website', url: 'URL',
    facebook: 'Facebook', 'contact:facebook': 'Facebook', instagram: 'Instagram', 'contact:instagram': 'Instagram',
    twitter: 'Twitter/X', 'contact:twitter': 'Twitter/X', whatsapp: 'WhatsApp', 'contact:whatsapp': 'WhatsApp',
    telegram: 'Telegram', 'contact:telegram': 'Telegram', youtube: 'YouTube', 'contact:youtube': 'YouTube',
    opening_hours: 'Jam buka', service_times: 'Jam layanan', collection_times: 'Jam pengambilan',
    cuisine: 'Masakan', wheelchair: 'Akses kursi roda', internet_access: 'Internet', 'internet_access:fee': 'Internet berbayar',
    outdoor_seating: 'Tempat duduk luar', indoor_seating: 'Tempat duduk dalam', air_conditioning: 'AC', smoking: 'Merokok',
    takeaway: 'Bawa pulang', delivery: 'Antar', drive_through: 'Drive-through', reservation: 'Reservasi',
    capacity: 'Kapasitas', parking: 'Parkir', toilets: 'Toilet', stars: 'Bintang', rooms: 'Jumlah kamar', beds: 'Jumlah tempat tidur',
    religion: 'Agama', denomination: 'Aliran', emergency: 'Gawat darurat', level: 'Lantai', fee: 'Biaya', charge: 'Tarif',
    source: 'Sumber', check_date: 'Terakhir dicek',
  };

  const FACILITY_PREFIXES = ['wheelchair', 'internet_access', 'outdoor_seating', 'indoor_seating', 'air_conditioning', 'smoking',
    'takeaway', 'delivery', 'drive_through', 'reservation', 'cuisine', 'diet:', 'payment:', 'capacity', 'parking', 'toilets',
    'fuel:', 'stars', 'rooms', 'beds', 'religion', 'denomination', 'emergency', 'changing_table', 'fee', 'charge', 'level',
    'bar', 'self_service', 'organic', 'lit', 'covered', 'seats'];

  const CONTACT_KEYS = ['phone', 'mobile', 'fax', 'email', 'website', 'url', 'facebook', 'instagram', 'twitter', 'whatsapp', 'telegram', 'youtube'];

  const VALUE_WORDS = { yes: 'Ya', no: 'Tidak', limited: 'Terbatas', only: 'Hanya', designated: 'Khusus', unknown: 'Tidak diketahui' };

  function humanize(value) {
    return String(value).split(';').map((v) => {
      const s = v.trim();
      return VALUE_WORDS[s] || s.replace(/_/g, ' ');
    }).join(', ');
  }

  function titleCase(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

  function keyLabel(k) {
    if (LABELS[k]) return LABELS[k];
    if (k.startsWith('name:')) return 'Nama (' + k.slice(5) + ')';
    if (k.startsWith('addr:')) return titleCase(k.slice(5).replace(/_/g, ' '));
    if (k.startsWith('contact:')) return titleCase(k.slice(8).replace(/_/g, ' '));
    if (k.startsWith('payment:')) return 'Bayar: ' + k.slice(8).replace(/_/g, ' ');
    if (k.startsWith('diet:')) return 'Diet: ' + k.slice(5).replace(/_/g, ' ');
    if (k.startsWith('opening_hours:')) return 'Jam buka (' + k.slice(14).replace(/_/g, ' ') + ')';
    return null; // tak dikenal: tampilkan key mentah
  }

  function groupOf(k) {
    if (k === 'name' || k.startsWith('name:') || /^(alt_|old_|official_|short_|loc_)name/.test(k) || /^(brand|operator|network)(:|$)/.test(k) ||
        k === 'description' || k.startsWith('description:') || k === 'note' || k === 'wikipedia' || k.startsWith('wikipedia:') ||
        k === 'wikidata' || k.endsWith(':wikidata') || k === 'image' || k === 'wikimedia_commons') return 'identity';
    if (TYPE_KEYS.includes(k) || TYPE_KEYS.some((t) => k.startsWith(t + ':'))) return 'type';
    if (k.startsWith('addr:')) return 'address';
    if (k.startsWith('contact:') || CONTACT_KEYS.includes(k)) return 'contact';
    if (k.startsWith('opening_hours') || k === 'service_times' || k === 'collection_times') return 'hours';
    if (FACILITY_PREFIXES.some((p) => (p.endsWith(':') ? k.startsWith(p) : k === p || k.startsWith(p + ':')))) return 'facilities';
    return 'other';
  }

  // Tipe nilai menentukan cara penampil membuat tautan.
  function kindOf(k, v) {
    if (/(^|:)(website|url|image|wikimedia_commons)$/.test(k) || /^https?:\/\//i.test(v)) return 'url';
    if (/(^|:)(phone|mobile|fax|whatsapp)$/.test(k)) return 'tel';
    if (/(^|:)email$/.test(k)) return 'email';
    if (k === 'wikipedia' || k.startsWith('wikipedia:')) return 'wikipedia';
    if (k === 'wikidata' || k.endsWith(':wikidata')) return 'wikidata';
    return 'text';
  }

  // urutan tampil: nama dulu, alamat dari jalan ke negara, sisanya alfabet
  const KEY_ORDER = ['name', 'alt_name', 'official_name', 'brand', 'operator', 'description', 'addr:full', 'addr:street', 'addr:housenumber',
    'addr:housename', 'addr:floor', 'addr:unit', 'addr:suburb', 'addr:subdistrict', 'addr:district', 'addr:village', 'addr:city',
    'addr:town', 'addr:state', 'addr:province', 'addr:postcode', 'addr:country'];
  const rank = (k) => { const i = KEY_ORDER.indexOf(k); return i < 0 ? 999 : i; };

  const GROUPS = [
    ['identity', 'Identitas'], ['type', 'Jenis tempat'], ['address', 'Alamat'], ['contact', 'Kontak'],
    ['hours', 'Jam buka'], ['facilities', 'Fasilitas & atribut'], ['other', 'Tag lainnya'],
  ];

  // Setiap tag masuk tepat satu kelompok, jadi tidak ada data yang hilang.
  function groupTags(tags) {
    const buckets = {};
    for (const k of Object.keys(tags || {}).sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))) {
      const v = String(tags[k]);
      const g = groupOf(k);
      const kind = kindOf(k, v);
      const raw = g === 'hours' || g === 'other' || kind !== 'text'; // tampilkan apa adanya
      (buckets[g] = buckets[g] || []).push({
        key: k,
        label: keyLabel(k),
        value: raw ? v : humanize(v),
        // nilai dengan ';' dipecah per baris untuk tautan dan jam buka
        values: kind !== 'text' || g === 'hours' ? v.split(';').map((s) => s.trim()).filter(Boolean) : null,
        kind,
      });
    }
    return GROUPS.filter(([id]) => buckets[id]).map(([id, title]) => ({ id, title, rows: buckets[id] }));
  }

  // Ubah nilai tag + jenis menjadi URL aman, atau null kalau tidak valid.
  function safeHref(kind, key, value) {
    const v = String(value).trim();
    switch (kind) {
      case 'url': return /^https?:\/\/[^\s]+$/i.test(v) ? v : (/^[\w.-]+\.[a-z]{2,}(\/\S*)?$/i.test(v) && !/@/.test(v) ? 'https://' + v : null);
      case 'tel': { const d = v.replace(/[^\d+]/g, ''); return d.length >= 5 ? 'tel:' + d : null; }
      case 'email': return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? 'mailto:' + v : null;
      case 'wikipedia': {
        const m = v.match(/^([a-z-]{2,12}):(.+)$/i);
        return m ? `https://${m[1].toLowerCase()}.wikipedia.org/wiki/${encodeURIComponent(m[2].replace(/ /g, '_'))}` : null;
      }
      case 'wikidata': return /^Q\d+$/.test(v) ? 'https://www.wikidata.org/wiki/' + v : null;
      default: return null;
    }
  }

  function primaryType(tags) {
    for (const k of TYPE_KEYS) if (tags && tags[k] && tags[k] !== 'yes') return humanize(tags[k]);
    return '';
  }

  function csvCell(v) {
    let s = String(v == null ? '' : v);
    // cegah formula injection saat CSV dibuka di spreadsheet
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  const CSV_COLS = ['id', 'name', 'lat', 'lon', 'address', 'phone', 'website', 'opening_hours', 'osm_url', 'tags'];

  function toCsv(places) {
    const rows = [CSV_COLS.join(',')];
    for (const p of places) {
      const row = { ...p, tags: JSON.stringify(p.tags || {}), osm_url: p.osmUrl };
      rows.push(CSV_COLS.map((c) => csvCell(row[c])).join(','));
    }
    return rows.join('\n');
  }

  function toGeoJson(places) {
    return {
      type: 'FeatureCollection',
      features: places.map((p) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
        properties: {
          id: p.id, name: p.name, address: p.address, phone: p.phone, website: p.website, opening_hours: p.opening_hours,
          osm_url: p.osmUrl, meta: p.meta, tags: p.tags,
        },
      })),
    };
  }

  const api = {
    CATEGORIES, polygonAreaKm2, circleAreaKm2, buildQuery, elementToPlace, toCsv, toGeoJson,
    groupTags, safeHref, primaryType, humanize, keyLabel,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PlaceLib = api;
})(typeof self !== 'undefined' ? self : this);
