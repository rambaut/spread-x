/**
 * parsers.js — File-format detection and non-tree parsing for SPREAD-X.
 *
 * Tree parsing and annotation inference are delegated to pearcore tree-io.
 */

import {
  analyzeTreeAnnotations as pearAnalyzeTreeAnnotations,
  parseTreeData as pearParseTreeData,
} from '@artic-network/pearcore/tree-io.js';

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
  } catch {
    // not JSON
  }

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
 * Convert a TopoJSON or GeoJSON string/object into a GeoJSON FeatureCollection.
 */
export function parseGeoData(input, topojson) {
  const json = typeof input === 'string' ? JSON.parse(input) : input;

  if (json.type === 'Topology') {
    const key = Object.keys(json.objects)[0];
    return topojson.feature(json, json.objects[key]);
  }

  if (json.type === 'Feature') {
    return { type: 'FeatureCollection', features: [json] };
  }

  return json;
}

/**
 * Parse CSV / TSV text into an array of point objects.
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
 * Return field names from a point data array.
 */
export function pointFields(data) {
  if (!data?.length) return [];
  return Object.keys(data[0]);
}

/**
 * Delegated to pearcore tree-io.
 */
export function analyzeTreeAnnotations(text) {
  return pearAnalyzeTreeAnnotations(text);
}

/**
 * Delegated to pearcore tree-io.
 */
export function parseTreeData(text, mapping = {}) {
  return pearParseTreeData(text, mapping);
}

/** Simple CSV splitter respecting double-quoted fields. */
function _splitLine(line, sep) {
  const result = [];
  let cur = '';
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuote = !inQuote;
      continue;
    }
    if (ch === sep && !inQuote) {
      result.push(cur);
      cur = '';
      continue;
    }
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
