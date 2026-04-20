/**
 * layers.js — Layer model and management for SPREAD-X.
 *
 * Defines layer types, default styles, and CRUD helpers.
 * All data is plain objects — no classes.
 */

/* ── Layer types ─────────────────────────────────────────────────────── */

export const LAYER_TYPES = {
  BASEMAP: 'basemap',
  GEOJSON: 'geojson',
  POINTS:  'points',
  TREE:    'tree',
};

/* ── Built-in map outline sources (TopoJSON from world-atlas) ──────── */

export const MAP_OUTLINES = [
  { id: 'countries-110m', name: 'Countries (110m)',  url: 'https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json' },
  { id: 'countries-50m',  name: 'Countries (50m)',   url: 'https://cdn.jsdelivr.net/npm/world-atlas@2/countries-50m.json' },
  { id: 'land-110m',      name: 'Land only (110m)',  url: 'https://cdn.jsdelivr.net/npm/world-atlas@2/land-110m.json' },
  { id: 'land-50m',       name: 'Land only (50m)',   url: 'https://cdn.jsdelivr.net/npm/world-atlas@2/land-50m.json' },
  { id: 'none',           name: 'None',              url: null },
];

/* ── Bootstrap-icon class per layer type ───────────────────────────── */

export const LAYER_ICONS = {
  basemap: 'bi-globe-americas',
  geojson: 'bi-hexagon',
  points:  'bi-geo-alt',
  tree:    'bi-diagram-3',
};

/* ── Default styles per layer type ─────────────────────────────────── */

const DEFAULT_STYLES = {
  basemap: {
    projection:        'geoNaturalEarth1',
    center:            [0, 0],
    rotate:            [0, 0, 0],
    outline:           'countries-110m',
    showGraticule:     true,
    graticuleStep:     10,
    landFill:          '#1a3a2a',
    landStroke:        '#4a8a5a',
    landStrokeWidth:   0.5,
    oceanFill:         '#02292e',
    borderStroke:      '#3a6a4a',
    borderStrokeWidth: 0.3,
    outlineStroke:     '#4a8a5a',
    outlineStrokeWidth:1,
    graticuleStroke:   '#ffffff',
    graticuleOpacity:  0.1,
  },
  geojson: {
    fill:        '#2aa198',
    fillOpacity: 0.3,
    stroke:      '#2aa198',
    strokeWidth: 1,
  },
  points: {
    radius:      4,
    fill:        '#b58900',
    fillOpacity: 0.8,
    stroke:      '#ffffff',
    strokeWidth: 1,
    labelField:  '',
    labelSize:   10,
  },
  tree: {
    branchStyle:   'greatcircle',
    branchColor:   '#BF4B43',
    branchWidth:   1.5,
    branchOpacity: 0.8,
    nodeColor:     '#BF4B43',
    nodeRadius:    3,
    nodeOpacity:   0.8,
  },
};

/* ── Layer factory ─────────────────────────────────────────────────── */

let _nextId = 1;

/**
 * Create a new layer with default style for the given type.
 * @param {string} type  - one of LAYER_TYPES values
 * @param {string} [name]
 * @param {*}      [data] - parsed data (GeoJSON, point array, tree obj)
 */
export function createLayer(type, name, data = null) {
  return {
    id:      `layer-${_nextId++}`,
    name:    name || _defaultName(type),
    type,
    visible: true,
    opacity: 1,
    data,
    style:   { ...DEFAULT_STYLES[type] },
  };
}

/**
 * Deep-clone a layer with a fresh id.
 */
export function duplicateLayer(layer) {
  return {
    ...structuredClone(layer),
    id:   `layer-${_nextId++}`,
    name: layer.name + ' (copy)',
  };
}

function _defaultName(type) {
  const names = { basemap: 'Base Map', geojson: 'GeoJSON', points: 'Points', tree: 'Tree' };
  return names[type] || 'Layer';
}
