import { GEOJSON_LIMITS } from '../config.js';

const _topologyArcUsageCache = new WeakMap();

export function resolveGeojsonAdaptiveDetailPercent({ zoomScale = 1, targetZoom = GEOJSON_LIMITS.targetZoom.defaultValue } = {}) {
  const z = Math.max(1, Number(zoomScale) || 1);
  const target = Math.max(GEOJSON_LIMITS.targetZoom.min, Number(targetZoom) || GEOJSON_LIMITS.targetZoom.defaultValue);
  if (z <= 1) return 0;
  if (z >= target) return 100;
  const t = Math.max(0, Math.min(1, Math.log2(z) / Math.log2(Math.max(1.000001, target))));
  return Math.round(t * 100);
}

export function countGeoJSONFeatures(data) {
  if (!data) return 0;
  if (data.type === 'FeatureCollection') return data.features?.length || 0;
  if (data.type === 'Feature') return 1;
  return 1;
}

export function resolveLayerGeoJSON(layer, { topojson, resolvedCache } = {}) {
  const data = layer?.data;
  if (!data) return null;

  if (data._sxFormat === 'topojson-object-pyramid') {
    const cached = resolvedCache?.get(layer);
    if (cached && cached.sourceRef === data) return cached.resolved;

    const topology = _resolvePyramidTopologyForLevel(data, 0);
    if (!topology || topology.type !== 'Topology') return null;
    const key = _resolveTopoObjectKey(topology, data.objectName);
    if (!key) return null;

    const resolved = topojson.feature(topology, topology.objects[key]);
    resolvedCache?.set(layer, { sourceRef: data, resolved });
    return resolved;
  }

  if (data._sxFormat !== 'topojson-object') {
    return data;
  }

  const cached = resolvedCache?.get(layer);
  if (cached && cached.sourceRef === data) return cached.resolved;

  const topology = data.topology;
  if (!topology || topology.type !== 'Topology') return null;
  const keys = Object.keys(topology.objects || {});
  const key = data.objectName && topology.objects?.[data.objectName]
    ? data.objectName
    : keys[0];
  if (!key) return null;

  const resolved = topojson.feature(topology, topology.objects[key]);
  resolvedCache?.set(layer, { sourceRef: data, resolved });
  return resolved;
}

export function getSimplifiedLayerData(layer, simplifyLevel, {
  topojson,
  resolvedCache,
  layerCache,
} = {}) {
  const topoSource = layer?.data;
  const isPyramidSource = topoSource?._sxFormat === 'topojson-object-pyramid'
    && topojson?.feature;
  const isTopoSource = topoSource?._sxFormat === 'topojson-object'
    && topoSource?.topology?.type === 'Topology'
    && topojson?.feature;

  if (isPyramidSource) {
    const level = _clampSimplifyLevel(simplifyLevel);
    let cache = layerCache?.get(layer);
    if (!cache || cache.sourceRef !== topoSource) {
      cache = {
        sourceRef: topoSource,
        byLevel: new Map(),
      };
      layerCache?.set(layer, cache);
    }

    if (!cache.byLevel.has(level)) {
      const topology = _resolvePyramidTopologyForLevel(topoSource, level);
      if (!topology || topology.type !== 'Topology') return null;
      const key = _resolveTopoObjectKey(topology, topoSource.objectName);
      if (!key) return null;

      const feature = topojson.feature(topology, topology.objects[key]);
      cache.byLevel.set(level, feature);
      if (level === 0) {
        resolvedCache?.set(layer, { sourceRef: topoSource, resolved: feature });
      }
    }

    return cache.byLevel.get(level) || null;
  }

  if (isTopoSource) {
    const level = _clampSimplifyLevel(simplifyLevel);
    let cache = layerCache?.get(layer);
    if (!cache || cache.sourceRef !== topoSource) {
      cache = {
        sourceRef: topoSource,
        byLevel: new Map(),
      };
      layerCache?.set(layer, cache);
    }

    if (!cache.byLevel.has(level)) {
      const topology = topoSource.topology;
      const keys = Object.keys(topology.objects || {});
      const key = topoSource.objectName && topology.objects?.[topoSource.objectName]
        ? topoSource.objectName
        : keys[0];
      if (!key) return null;

      const topologyForLevel = level > 0
        ? simplifyTopology(topology, level)
        : topology;

      const feature = topojson.feature(topologyForLevel, topologyForLevel.objects[key]);
      cache.byLevel.set(level, feature);
      if (level === 0) {
        resolvedCache?.set(layer, { sourceRef: topoSource, resolved: feature });
      }
    }

    return cache.byLevel.get(level) || null;
  }

  const resolved = resolveLayerGeoJSON(layer, { topojson, resolvedCache });
  if (!resolved || simplifyLevel <= 0) return resolved;

  let cache = layerCache?.get(layer);
  if (!cache || cache.sourceRef !== resolved) {
    cache = {
      sourceRef: resolved,
      byLevel: new Map([[0, resolved]]),
    };
    layerCache?.set(layer, cache);
  }

  const level = Math.max(
    GEOJSON_LIMITS.simplifyLevel.min,
    Math.min(GEOJSON_LIMITS.simplifyLevel.max, Math.round(Number(simplifyLevel) || 0))
  );
  if (!cache.byLevel.has(level)) {
    cache.byLevel.set(level, simplifyGeoJSON(resolved, level));
  }

  return cache.byLevel.get(level) || resolved;
}

export function simplifyTopology(topology, simplifyLevel) {
  if (!topology || topology.type !== 'Topology' || simplifyLevel <= 0) return topology;
  const stride = Math.max(2, Math.round(Number(simplifyLevel) || 0) + 1);
  const hasTransform = !!topology.transform;
  const arcs = Array.isArray(topology.arcs)
    ? topology.arcs.map(arc => _simplifyTopologyArc(arc, stride, hasTransform))
    : topology.arcs;
  return {
    ...topology,
    arcs,
  };
}

export function analyzeTopojsonArcUsage(layer) {
  const topoSource = layer?.data;
  if (topoSource?._sxFormat !== 'topojson-object') return null;

  const topology = topoSource.topology;
  if (!topology || topology.type !== 'Topology') return null;

  let byObjectName = _topologyArcUsageCache.get(topology);
  if (!byObjectName) {
    byObjectName = new Map();
    _topologyArcUsageCache.set(topology, byObjectName);
  }

  const objectName = topoSource.objectName || Object.keys(topology.objects || {})[0] || '__first';
  if (byObjectName.has(objectName)) return byObjectName.get(objectName);

  const object = topology.objects?.[objectName] || topology.objects?.[Object.keys(topology.objects || {})[0]];
  if (!object) return null;

  const counts = new Map();
  const state = { totalArcRefs: 0, geometryCount: 0 };
  _collectTopoObjectArcRefs(object, counts, state);

  let sharedArcRefs = 0;
  let sharedArcUseCount = 0;
  for (const count of counts.values()) {
    if (count > 1) {
      sharedArcRefs += 1;
      sharedArcUseCount += count;
    }
  }

  const result = {
    objectName,
    geometryCount: state.geometryCount,
    totalArcRefs: state.totalArcRefs,
    uniqueArcRefs: counts.size,
    sharedArcRefs,
    sharedArcUseCount,
    sharedArcPct: counts.size > 0 ? Math.round((sharedArcRefs / counts.size) * 1000) / 10 : 0,
  };
  byObjectName.set(objectName, result);
  return result;
}

function _simplifyTopologyArc(arc, stride, isDeltaEncoded) {
  if (!Array.isArray(arc) || arc.length <= 2 || stride <= 1) return arc;

  const absolute = isDeltaEncoded ? _decodeDeltaArc(arc) : arc;
  const simplifiedAbsolute = decimateLine(absolute, stride, false);

  return isDeltaEncoded
    ? _encodeDeltaArc(simplifiedAbsolute)
    : simplifiedAbsolute;
}

function _decodeDeltaArc(arc) {
  let x = 0;
  let y = 0;
  const out = [];
  for (const point of arc) {
    if (!Array.isArray(point) || point.length < 2) continue;
    x += Number(point[0]) || 0;
    y += Number(point[1]) || 0;
    out.push([x, y]);
  }
  return out;
}

function _encodeDeltaArc(points) {
  const out = [];
  let prevX = 0;
  let prevY = 0;
  for (const point of points || []) {
    if (!Array.isArray(point) || point.length < 2) continue;
    const x = Number(point[0]) || 0;
    const y = Number(point[1]) || 0;
    out.push([x - prevX, y - prevY]);
    prevX = x;
    prevY = y;
  }
  return out;
}

function _collectTopoObjectArcRefs(object, counts, state) {
  if (!object) return;
  const type = object.type;
  if (type === 'GeometryCollection') {
    for (const geometry of object.geometries || []) {
      _collectTopoObjectArcRefs(geometry, counts, state);
    }
    return;
  }

  state.geometryCount += 1;
  _collectArcIndexes(object.arcs, counts, state);
}

function _collectArcIndexes(arcs, counts, state) {
  if (typeof arcs === 'number' && Number.isInteger(arcs)) {
    const arcIndex = arcs >= 0 ? arcs : ~arcs;
    counts.set(arcIndex, (counts.get(arcIndex) || 0) + 1);
    state.totalArcRefs += 1;
    return;
  }

  if (!Array.isArray(arcs)) return;
  for (const value of arcs) {
    _collectArcIndexes(value, counts, state);
  }
}

export function resolveGeojsonSimplifyLevel({ zoomScale = 1, featureCount = 0, style = {} } = {}) {
  const scheduledDetailLevels = Array.isArray(style.detailLevels)
    ? style.detailLevels
        .map(level => ({
          level: _clampSimplifyLevel(level?.level),
          switchZoom: Math.max(1, Number(level?.switchZoom) || 1),
        }))
        .filter(level => Number.isFinite(level.level))
        .sort((a, b) => a.switchZoom - b.switchZoom || a.level - b.level)
    : [];

  if (scheduledDetailLevels.length) {
    const zoom = Math.max(1, Number(zoomScale) || 1);
    let selectedLevel = scheduledDetailLevels[0].level;
    for (const level of scheduledDetailLevels) {
      if (zoom >= level.switchZoom) selectedLevel = level.level;
      else break;
    }
    return _clampSimplifyLevel(selectedLevel);
  }

  const manualLevel = _clampSimplifyLevel(style.simplify ?? 0);
  if (style.adaptiveSimplify === false) return manualLevel;

  const minSimplify = _clampSimplifyLevel(style.minSimplify ?? manualLevel);
  const autoMax = featureCount > 5000
    ? 5
    : featureCount > 1500
      ? 4
      : featureCount > 400
        ? 3
        : 2;
  // In adaptive mode, always allow the full configured simplify span so
  // rendered detail follows zoom even for layers persisted with older,
  // lower maxSimplify values.
  const adaptiveMax = GEOJSON_LIMITS.simplifyLevel.max;
  const maxSimplify = Math.max(minSimplify, _clampSimplifyLevel(adaptiveMax ?? style.maxSimplify ?? autoMax));
  const detailZoom = Math.max(
    GEOJSON_LIMITS.targetZoom.min,
    Number(style.detailZoom) || GEOJSON_LIMITS.targetZoom.defaultValue
  );

  const detailPercent = resolveGeojsonAdaptiveDetailPercent({
    zoomScale,
    targetZoom: detailZoom,
  });

  const simplifySpan = maxSimplify - minSimplify;
  if (simplifySpan <= 0) return minSimplify;
  const simplifyLevel = Math.round(maxSimplify - ((detailPercent / 100) * simplifySpan));
  return _clampSimplifyLevel(simplifyLevel);
}

export function geojsonRenderPolicy(featureCount, style = {}) {
  const minZoom = Math.max(
    GEOJSON_LIMITS.renderPolicy.minZoomMin,
    Math.min(
      GEOJSON_LIMITS.renderPolicy.minZoomMax,
      Number(style.minZoom) || GEOJSON_LIMITS.renderPolicy.minZoomMin
    )
  );
  const maxVisibleFeatures = Math.max(
    GEOJSON_LIMITS.renderPolicy.maxVisibleMin,
    Math.min(
      GEOJSON_LIMITS.renderPolicy.maxVisibleMax,
      Math.round(Number(style.maxVisible) || GEOJSON_LIMITS.renderPolicy.maxVisibleDefault)
    )
  );
  return { minZoom, maxVisibleFeatures };
}

export function autoGeojsonRenderPolicy(featureCount) {
  if (featureCount > 8000) return { minZoom: 5, maxVisibleFeatures: 900 };
  if (featureCount > 4000) return { minZoom: 4, maxVisibleFeatures: 1200 };
  if (featureCount > 2000) return { minZoom: 3, maxVisibleFeatures: 1600 };
  if (featureCount > 800) return { minZoom: 2, maxVisibleFeatures: 2000 };
  if (featureCount > 300) return { minZoom: 1.5, maxVisibleFeatures: 2600 };
  return { minZoom: 1, maxVisibleFeatures: 4000 };
}

export function simplifyGeoJSON(data, simplifyLevel) {
  if (!data || simplifyLevel <= 0) return data;
  if (data.type === 'FeatureCollection') {
    return {
      ...data,
      features: (data.features || []).map(f => simplifyFeature(f, simplifyLevel)),
    };
  }
  if (data.type === 'Feature') return simplifyFeature(data, simplifyLevel);
  return {
    type: data.type,
    coordinates: simplifyGeometryCoordinates(data.type, data.coordinates, simplifyLevel),
  };
}

export function simplifyFeature(feature, simplifyLevel) {
  if (!feature?.geometry) return feature;
  return {
    ...feature,
    geometry: {
      ...feature.geometry,
      coordinates: simplifyGeometryCoordinates(feature.geometry.type, feature.geometry.coordinates, simplifyLevel),
    },
  };
}

export function simplifyGeometryCoordinates(type, coordinates, simplifyLevel) {
  if (!coordinates) return coordinates;
  const stride = simplifyLevel + 1;

  switch (type) {
    case 'LineString':
      return decimateLine(coordinates, stride, false);
    case 'MultiLineString':
      return coordinates.map(line => decimateLine(line, stride, false));
    case 'Polygon':
      return coordinates.map(ring => decimateLine(ring, stride, true));
    case 'MultiPolygon':
      return coordinates.map(poly => poly.map(ring => decimateLine(ring, stride, true)));
    default:
      return coordinates;
  }
}

export function decimateLine(coords, stride, closed) {
  if (!Array.isArray(coords)) return coords;
  const minPoints = closed ? 4 : 2;
  if (coords.length <= minPoints || stride <= 1) return coords;

  const out = [];
  for (let i = 0; i < coords.length; i += 1) {
    if (i === 0 || i === coords.length - 1 || (i % stride) === 0) out.push(coords[i]);
  }

  if (closed) {
    const first = out[0];
    const last = out[out.length - 1];
    if (!first || !last || first[0] !== last[0] || first[1] !== last[1]) out.push(first);
    while (out.length < 4) out.splice(out.length - 1, 0, out[0]);
  } else {
    while (out.length < 2 && coords.length > out.length) out.push(coords[out.length]);
  }

  return out;
}

function _clampSimplifyLevel(value) {
  return Math.max(
    GEOJSON_LIMITS.simplifyLevel.min,
    Math.min(GEOJSON_LIMITS.simplifyLevel.max, Math.round(Number(value) || 0))
  );
}

function _resolveTopoObjectKey(topology, preferredName) {
  const keys = Object.keys(topology?.objects || {});
  if (!keys.length) return null;
  if (preferredName && topology.objects?.[preferredName]) return preferredName;
  const normalizedPreferred = String(preferredName || '').toLowerCase();
  if (normalizedPreferred) {
    const candidate = keys.find(key => String(key).toLowerCase() === normalizedPreferred);
    if (candidate) return candidate;
  }
  return keys[0];
}

function _resolvePyramidTopologyForLevel(pyramidSource, simplifyLevel) {
  const byLevel = pyramidSource?.topologiesByLevel;
  if (!byLevel) return null;

  const level = _clampSimplifyLevel(simplifyLevel);
  if (byLevel instanceof Map) {
    if (byLevel.has(level)) return byLevel.get(level);
    for (let probe = level - 1; probe >= GEOJSON_LIMITS.simplifyLevel.min; probe -= 1) {
      if (byLevel.has(probe)) return byLevel.get(probe);
    }
    for (let probe = level + 1; probe <= GEOJSON_LIMITS.simplifyLevel.max; probe += 1) {
      if (byLevel.has(probe)) return byLevel.get(probe);
    }
    return null;
  }

  if (typeof byLevel === 'object') {
    const exact = byLevel[level];
    if (exact) return exact;
    for (let probe = level - 1; probe >= GEOJSON_LIMITS.simplifyLevel.min; probe -= 1) {
      if (byLevel[probe]) return byLevel[probe];
    }
    for (let probe = level + 1; probe <= GEOJSON_LIMITS.simplifyLevel.max; probe += 1) {
      if (byLevel[probe]) return byLevel[probe];
    }
  }

  return null;
}
