import { GEOJSON_LIMITS } from '../config.js';

function _normalizeKey(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function _toNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

export async function loadPresetCatalog({ fetchImpl, catalogUrl = 'data/maps/preset-data.json' } = {}) {
  const fetchFn = fetchImpl || fetch;
  try {
    const response = await fetchFn(catalogUrl);
    if (!response.ok) return { version: 1, presets: [] };
    const catalog = await response.json();
    return catalog && typeof catalog === 'object'
      ? catalog
      : { version: 1, presets: [] };
  } catch {
    return { version: 1, presets: [] };
  }
}

export async function loadPresetManifest({ fetchImpl, folder, basePath = 'data/maps' } = {}) {
  const fetchFn = fetchImpl || fetch;
  const safeFolder = String(folder || '').trim();
  if (!safeFolder) return null;

  try {
    const response = await fetchFn(`${basePath}/${safeFolder}/manifest.json`);
    if (!response.ok) return null;
    const manifest = await response.json();
    if (!manifest || typeof manifest !== 'object') return null;
    return manifest;
  } catch {
    return null;
  }
}

export async function loadPresetTopologySource({ fetchImpl, manifest, basePath = 'data/maps', levels = [], existingSource = null } = {}) {
  const fetchFn = fetchImpl || fetch;
  const folder = String(manifest?.catalogFolder || manifest?.folder || '').trim();
  const entries = Array.isArray(manifest?.levels) ? manifest.levels : [];
  if (!entries.length || !folder) return null;

  const requestedLevels = new Set(Array.isArray(levels) ? levels
    .map(level => _toNumber(level, NaN))
    .filter(level => Number.isFinite(level))
    : []);

  const topologiesByLevel = new Map(existingSource?.topologiesByLevel instanceof Map
    ? existingSource.topologiesByLevel
    : Array.isArray(existingSource?.topologiesByLevel)
      ? existingSource.topologiesByLevel
      : undefined);

  const entriesToLoad = requestedLevels.size
    ? entries.filter(entry => requestedLevels.has(_toNumber(entry?.level, NaN)))
    : [];

  for (const entry of entriesToLoad) {
    const level = _toNumber(entry?.level, NaN);
    const file = String(entry?.file || '').trim();
    if (!Number.isFinite(level) || !file) continue;
    if (topologiesByLevel.has(level)) continue;

    try {
      const response = await fetchFn(`${basePath}/${folder}/${file}`);
      if (!response.ok) continue;
      const topology = await response.json();
      if (topology?.type === 'Topology') {
        topologiesByLevel.set(level, topology);
      }
    } catch {
      // Continue loading other levels if one file is unavailable.
    }
  }

  if (!topologiesByLevel.size) return null;

  return {
    _sxFormat: 'topojson-object-pyramid',
    topologiesByLevel,
    objectName: null,
    objectNames: manifest?.objects || {},
  };
}

export function resolvePresetFeatureSelection(manifest, selection = {}) {
  const features = Array.isArray(manifest?.features) ? manifest.features : [];
  const selected = new Set(Array.isArray(selection.features) && selection.features.length
    ? selection.features.map(_normalizeKey)
    : features.map(feature => _normalizeKey(feature.key)));

  return features.filter(feature => selected.has(_normalizeKey(feature.key)));
}

export function resolvePresetDetailSelection(manifest, selection = {}) {
  const levels = Array.isArray(manifest?.detailLevels) ? manifest.detailLevels : [];
  const selectedEntries = Array.isArray(selection.detailLevels) && selection.detailLevels.length
    ? selection.detailLevels.map(item => ({
        level: _toNumber(item.level, item.level),
        switchZoom: _toNumber(item.switchZoom, NaN),
        label: String(item.label || `Level ${item.level}`),
      }))
    : levels.map(level => ({
        level: _toNumber(level.level, level.level),
        switchZoom: _toNumber(level.switchZoom, 1),
        label: String(level.label || `Level ${level.level}`),
      }));
  const selectedLevels = new Set(selectedEntries.map(item => item.level));

  return levels
    .map(level => ({
      level: _toNumber(level.level, 0),
      label: String(level.label || `Level ${level.level}`),
      switchZoom: (() => {
        const match = selectedEntries.find(item => item.level === _toNumber(level.level, 0));
        return Number.isFinite(match?.switchZoom) ? match.switchZoom : _toNumber(level.switchZoom, 1);
      })(),
    }))
    .filter(level => selectedLevels.has(level.level))
    .sort((a, b) => a.switchZoom - b.switchZoom || a.level - b.level);
}

export function buildPresetFeatureLayers({
  createLayer,
  layerTypes,
  manifest,
  topologySource,
  presetInstanceId,
  presetInstanceName,
  presetColor = '#2aa198',
  features = [],
  detailLevels = [],
} = {}) {
  if (!createLayer || !layerTypes || !manifest || !topologySource) return [];

  const objectNames = manifest.objects || {};
  const normalizedLevels = detailLevels
    .map(level => ({
      level: _toNumber(level.level, 0),
      label: String(level.label || `Level ${level.level}`),
      switchZoom: Math.max(1, _toNumber(level.switchZoom, 1)),
    }))
    .sort((a, b) => a.switchZoom - b.switchZoom || a.level - b.level);

  const layers = [];
  for (const feature of features) {
    const featureKey = _normalizeKey(feature.key);
    const layerName = feature.label || feature.name || feature.key;
    const objectName = feature.objectName || objectNames[feature.key] || objectNames[layerName] || feature.key;
    const data = {
      ...topologySource,
      objectName,
    };
    const layer = createLayer(layerTypes.GEOJSON, layerName, data);
    layer.visible = true;
    layer.style.fill = feature.fill || 'rgba(42, 161, 152, 0.18)';
    layer.style.fillOpacity = feature.fillOpacity ?? 0;
    layer.style.stroke = feature.stroke || presetColor;
    layer.style.strokeWidth = feature.strokeWidth ?? 0.7;
    layer.style.adaptiveSimplify = true;
    layer.style.simplify = 0;
    layer.style.minSimplify = 0;
    layer.style.maxSimplify = GEOJSON_LIMITS.simplifyLevel.max;
    layer.style.detailZoom = normalizedLevels[0]?.switchZoom || GEOJSON_LIMITS.targetZoom.defaultValue;
    layer.style.detailLevels = normalizedLevels;
    layer.style.presetKey = manifest.folder || manifest.name || 'preset';
    layer.style.presetName = manifest.name || manifest.title || manifest.folder || 'Preset';
    layer.style.presetInstanceId = presetInstanceId;
    layer.style.presetInstanceName = presetInstanceName || manifest.name || manifest.title || manifest.folder || 'Preset';
    layer.style.presetFeatureKey = featureKey;
    layer.style.presetFeatureLabel = layerName;
    layer.style.presetColor = presetColor;
    layer.style.presetLicense = manifest.license?.name || manifest.license || '';
    layer.style.presetFolder = manifest.catalogFolder || manifest.folder || '';
    layer.style.presetDescription = manifest.description || '';
    layer.style.presetLogo = manifest.logo || '';
    layers.push(layer);
  }

  return layers;
}

export function groupPresetLayers(layers = []) {
  const groups = new Map();
  for (const layer of layers) {
    const presetInstanceId = layer?.style?.presetInstanceId;
    if (!presetInstanceId) continue;
    if (!groups.has(presetInstanceId)) {
      groups.set(presetInstanceId, {
        id: presetInstanceId,
        name: layer.style.presetInstanceName || layer.style.presetName || layer.name,
        folder: layer.style.presetFolder || '',
        color: layer.style.presetColor || '#2aa198',
        description: layer.style.presetDescription || '',
        license: layer.style.presetLicense || '',
        logo: layer.style.presetLogo || '',
        featureLayers: [],
      });
    }
    groups.get(presetInstanceId).featureLayers.push(layer);
  }

  return [...groups.values()];
}
