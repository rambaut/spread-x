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
  FRAME:   'frame',
};

export const FRAME_ASPECTS = {
  square:        { label: '1:1 (Square)', ratio: 1 },
  a4Portrait:    { label: 'A4 Portrait (210:297)', ratio: 210 / 297 },
  a4Landscape:   { label: 'A4 Landscape (297:210)', ratio: 297 / 210 },
  slideStandard: { label: 'Slide Standard (4:3)', ratio: 4 / 3 },
  slideWide:     { label: 'Slide Wide (16:9)', ratio: 16 / 9 },
};

/* ── Built-in map outline sources (TopoJSON from world-atlas) ──────── */

export const MAP_OUTLINES = [
  // CDN world-atlas (D3 basemap source)
  { id: 'countries-110m', name: 'Countries (110m)',  url: 'https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json' },
  { id: 'countries-50m',  name: 'Countries (50m)',   url: 'https://cdn.jsdelivr.net/npm/world-atlas@2/countries-50m.json' },
  { id: 'land-110m',      name: 'Land only (110m)',  url: 'https://cdn.jsdelivr.net/npm/world-atlas@2/land-110m.json' },
  { id: 'land-50m',       name: 'Land only (50m)',   url: 'https://cdn.jsdelivr.net/npm/world-atlas@2/land-50m.json' },
  { id: 'none',           name: 'None',              url: null },
  // Local Natural Earth TopoJSON files
  { id: 'ne-land-110m',      name: 'NE Land (110m)',      url: 'data/maps/NaturalEarth/land-110m.json' },
  { id: 'ne-land-50m',       name: 'NE Land (50m)',       url: 'data/maps/NaturalEarth/land-50m.json' },
  { id: 'ne-land-10m',       name: 'NE Land (10m)',       url: 'data/maps/NaturalEarth/land-10m.json' },
  { id: 'ne-countries-110m', name: 'NE Countries (110m)', url: 'data/maps/NaturalEarth/countries-110m.json' },
  { id: 'ne-countries-50m',  name: 'NE Countries (50m)',  url: 'data/maps/NaturalEarth/countries-50m.json' },
  { id: 'ne-countries-10m',  name: 'NE Countries (10m)',  url: 'data/maps/NaturalEarth/countries-10m.json' },
];

/* ── Basemap source options ─────────────────────────────────────────── */

export const BASEMAP_SOURCES = [
  { id: 'd3',   label: 'D3 World Atlas',      description: 'Flexible D3 geo projections · fetched from CDN',      icon: 'bi-globe' },
  { id: 'ne110', label: 'Natural Earth 110m', description: 'Overview · ideal for world-scale maps · built-in',    icon: 'bi-map' },
  { id: 'ne50',  label: 'Natural Earth 50m',  description: 'Regional / continental detail · built-in',            icon: 'bi-map' },
  { id: 'ne10',  label: 'Natural Earth 10m',  description: 'High detail · country / local maps · large file',     icon: 'bi-map' },
];

/* ── Standard NE vector layers available in Layout mode ─────────────── */

export const NE_STANDARD_LAYERS = [
  { id: 'ne-land-110m',      name: 'Land (110m)',      scale: '110m', landId: 'ne-land-110m',      countriesId: null },
  { id: 'ne-countries-110m', name: 'Countries (110m)', scale: '110m', landId: null,                countriesId: 'ne-countries-110m' },
  { id: 'ne-land-50m',       name: 'Land (50m)',       scale: '50m',  landId: 'ne-land-50m',       countriesId: null },
  { id: 'ne-countries-50m',  name: 'Countries (50m)',  scale: '50m',  landId: null,                countriesId: 'ne-countries-50m' },
  { id: 'ne-land-10m',       name: 'Land (10m)',       scale: '10m',  landId: 'ne-land-10m',       countriesId: null },
  { id: 'ne-countries-10m',  name: 'Countries (10m)',  scale: '10m',  landId: null,                countriesId: 'ne-countries-10m' },
];

/* ── Bootstrap-icon class per layer type ───────────────────────────── */

export const LAYER_ICONS = {
  basemap: 'bi-globe-americas',
  geojson: 'bi-hexagon',
  points:  'bi-geo-alt',
  tree:    'bi-diagram-3',
  frame:   'bi-bounding-box-circles',
};

/* ── Default styles per layer type ─────────────────────────────────── */

const DEFAULT_STYLES = {
  basemap: {
    baseMode:          'globe',
    basemapSource:     'd3',
    projection:        'geoNaturalEarth1',
    datum:             'WGS84',
    center:            [0, 0],
    rotate:            [0, 0, 0],
    backgroundFill:    '#ffffff',
    backgroundOpacity: 1,
    showGraticule:     true,
    graticuleStep:     10,
    graticuleStroke:   '#ffffff',
    graticuleOpacity:  0.1,
    showGlobe:         true,
    oceanFill:         '#02292e',
    landFill:          '#1a3a2a',
    showLandBoundaries:true,
    showCountryBoundaries:true,
    landBoundaryStroke:'#4a8a5a',
    landBoundaryWidth: 0.5,
    projectionBoundaryStroke: '#4a8a5a',
    projectionBoundaryWidth: 1,
    geographicSourceType: 'raster',
    geographicRasterSet: 'NE1',
    geographicRasterSwitchZoom: 2.5,
    geographicRasterForceTier: 'auto',
    geographicVectorScale: '50m',
    geographicOceanFill: '#0d2f40',
    geographicLandFill: '#9aa876',
    geographicShowCountries: true,
    geographicCountryScale: '50m',
    geographicCountryStroke: '#3e3e3e',
    geographicCountryStrokeWidth: 0.45,
    geographicCountryOpacity: 0.65,
  },
  geojson: {
    fill:        '#2aa198',
    fillOpacity: 0.3,
    stroke:      '#2aa198',
    strokeWidth: 1,
    autoPerf:    true,
    minZoom:     2,
    maxVisible:  2000,
    simplify:    0,
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
  frame: {
    aspectPreset:  'slideWide',
    margin:        24,
    showFill:      true,
    fill:          '#ffffff',
    fillOpacity:   1,
    stroke:        '#d8d8d8',
    strokeWidth:   1.5,
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
  const names = { basemap: 'Base Map', geojson: 'GeoJSON', points: 'Points', tree: 'Tree', frame: 'Map Frame' };
  return names[type] || 'Layer';
}
