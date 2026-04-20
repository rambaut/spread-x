/**
 * parsers.js — File-format detection and parsing for SPREAD-X.
 *
 * Supports: GeoJSON, TopoJSON, CSV/TSV (points), JSON point arrays.
 * Tree (Newick/Nexus) is detected but not fully parsed here.
 */

/**
 * Auto-detect file type from content and optional filename.
 * Returns { type, data } where type is one of:
 *   'topojson' | 'geojson' | 'points-json' | 'csv' | 'newick' | 'unknown'
 * and data is the raw parsed content (JSON object or text).
 */
export function detectFileType(text, filename) {
  const ext = filename?.split('.').pop()?.toLowerCase() || '';

  // Try JSON first
  try {
    const json = JSON.parse(text);
    if (json.type === 'Topology')
      return { type: 'topojson', data: json };
    if (json.type === 'FeatureCollection' || json.type === 'Feature' || json.type === 'GeometryCollection')
      return { type: 'geojson', data: json };
    if (Array.isArray(json) && json.length && _hasLatLon(json[0]))
      return { type: 'points-json', data: json };
    return { type: 'json', data: json };
  } catch { /* not JSON */ }

  // Newick / Nexus
  if (['nwk', 'newick', 'tre', 'tree', 'nex', 'nexus'].includes(ext) ||
      (text.trim().endsWith(';') && /[(),:]/.test(text))) {
    return { type: 'newick', data: text.trim() };
  }

  // CSV / TSV
  if (['csv', 'tsv', 'txt'].includes(ext) || /[\t,]/.test(text.split(/\r?\n/)[0])) {
    return { type: 'csv', data: text };
  }

  return { type: 'unknown', data: text };
}

/**
 * Convert a TopoJSON or GeoJSON string/object into a GeoJSON
 * FeatureCollection suitable for a GeoJSON layer.
 *
 * @param {string|object} input - raw text or parsed JSON
 * @param {object} topojson - the topojson-client module
 */
export function parseGeoData(input, topojson) {
  const json = typeof input === 'string' ? JSON.parse(input) : input;

  if (json.type === 'Topology') {
    const key = Object.keys(json.objects)[0];
    return topojson.feature(json, json.objects[key]);
  }

  // Wrap bare Feature in FeatureCollection
  if (json.type === 'Feature') {
    return { type: 'FeatureCollection', features: [json] };
  }

  return json; // already FeatureCollection or GeometryCollection
}

/**
 * Parse CSV / TSV text into an array of point objects.
 * Expects a header row with latitude/longitude columns.
 * Numeric values are coerced to numbers automatically.
 */
export function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];

  const sep = lines[0].includes('\t') ? '\t' : ',';
  const headers = _splitLine(lines[0], sep).map(h => h.trim().replace(/^["']|["']$/g, ''));
  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    const vals = _splitLine(lines[i], sep);
    if (vals.length !== headers.length) continue;
    const row = {};
    for (let j = 0; j < headers.length; j++) {
      const v = vals[j].trim().replace(/^["']|["']$/g, '');
      row[headers[j]] = v === '' ? '' : isNaN(v) ? v : Number(v);
    }
    rows.push(row);
  }

  return rows;
}

/**
 * Return the field names from a point data array (for label picker).
 */
export function pointFields(data) {
  if (!data?.length) return [];
  return Object.keys(data[0]);
}

/* ── internal helpers ──────────────────────────────────────────────── */

/** Simple CSV line splitter respecting double-quoted fields. */
function _splitLine(line, sep) {
  const result = [];
  let cur = '';
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { inQuote = !inQuote; continue; }
    if (ch === sep && !inQuote) { result.push(cur); cur = ''; continue; }
    cur += ch;
  }
  result.push(cur);
  return result;
}

function _hasLatLon(obj) {
  return obj &&
    ('latitude' in obj || 'lat' in obj) &&
    ('longitude' in obj || 'lon' in obj || 'lng' in obj);
}
