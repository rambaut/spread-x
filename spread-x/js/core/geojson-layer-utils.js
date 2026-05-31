export function countGeoJSONFeatures(data) {
  if (!data) return 0;
  if (data.type === 'FeatureCollection') return data.features?.length || 0;
  if (data.type === 'Feature') return 1;
  return 1;
}

export function resolveLayerGeoJSON(layer, { topojson, resolvedCache } = {}) {
  const data = layer?.data;
  if (!data) return null;

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

  const level = Math.max(0, Math.min(12, Math.round(Number(simplifyLevel) || 0)));
  if (!cache.byLevel.has(level)) {
    cache.byLevel.set(level, simplifyGeoJSON(resolved, level));
  }

  return cache.byLevel.get(level) || resolved;
}

export function resolveGeojsonSimplifyLevel({ zoomScale = 1, featureCount = 0, style = {} } = {}) {
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
  const maxSimplify = Math.max(minSimplify, _clampSimplifyLevel(style.maxSimplify ?? autoMax));
  const detailZoom = Math.max(1.5, Number(style.detailZoom) || 8);

  const z = Math.max(1, Number(zoomScale) || 1);
  // Dense datasets can remain prohibitively expensive at high zoom even when
  // only a subset is visible. Apply a gentle floor to preserve interactivity.
  let highZoomFloor = minSimplify;
  if (featureCount >= 200 && z >= 20) highZoomFloor = Math.max(highZoomFloor, 2);
  if (featureCount >= 200 && z >= 30) highZoomFloor = Math.max(highZoomFloor, 3);

  if (z >= detailZoom) return highZoomFloor;

  const t = Math.max(0, Math.min(1, (z - 1) / (detailZoom - 1)));
  // Reverse smoothstep: high simplification when zoomed out, easing into detail.
  const eased = 1 - (t * t * (3 - (2 * t)));
  const adaptive = _clampSimplifyLevel(Math.round(minSimplify + ((maxSimplify - minSimplify) * eased)));
  return Math.max(highZoomFloor, adaptive);
}

export function geojsonRenderPolicy(featureCount, style = {}) {
  const minZoom = Math.max(1, Math.min(12, Number(style.minZoom) || 1));
  const maxVisibleFeatures = Math.max(100, Math.min(20000, Math.round(Number(style.maxVisible) || 2000)));
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
  return Math.max(0, Math.min(12, Math.round(Number(value) || 0)));
}
