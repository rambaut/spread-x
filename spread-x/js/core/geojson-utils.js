import { GEOJSON_LIMITS } from '../config.js';

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

export function resolveGeojsonSimplifyLevel({ zoomScale = 1, featureCount = 0, style = {} } = {}) {
  const scheduledDetailLevels = Array.isArray(style.detailLevels)
    ? style.detailLevels
        .map(level => ({
          level: clampSimplifyLevel(level?.level),
          switchZoom: Math.max(1, Number(level?.switchZoom) || 1),
        }))
        .filter(level => Number.isFinite(level.level))
        .sort((a, b) => a.switchZoom - b.switchZoom || a.level - b.level)
    : [];

  if (scheduledDetailLevels.length) {
    if (style.adaptiveSimplify === false) {
      const requested = clampSimplifyLevel(style.simplify ?? scheduledDetailLevels[0].level);
      const nearest = scheduledDetailLevels.reduce((best, level) => (
        Math.abs(level.level - requested) < Math.abs(best.level - requested) ? level : best
      ), scheduledDetailLevels[0]);
      return clampSimplifyLevel(nearest.level);
    }
    const zoom = Math.max(1, Number(zoomScale) || 1);
    let selectedLevel = scheduledDetailLevels[0].level;
    for (const level of scheduledDetailLevels) {
      if (zoom >= level.switchZoom) selectedLevel = level.level;
      else break;
    }
    return clampSimplifyLevel(selectedLevel);
  }

  const manualLevel = clampSimplifyLevel(style.simplify ?? 0);
  if (style.adaptiveSimplify === false) return manualLevel;

  const minSimplify = clampSimplifyLevel(style.minSimplify ?? manualLevel);
  const autoMax = featureCount > 5000
    ? 5
    : featureCount > 1500
      ? 4
      : featureCount > 400
        ? 3
        : 2;
  const adaptiveMax = GEOJSON_LIMITS.simplifyLevel.max;
  const maxSimplify = Math.max(minSimplify, clampSimplifyLevel(adaptiveMax ?? style.maxSimplify ?? autoMax));
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
  return clampSimplifyLevel(simplifyLevel);
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
    const features = (data.features || [])
      .map(f => simplifyFeature(f, simplifyLevel))
      .filter(Boolean);
    return {
      ...data,
      features,
    };
  }
  if (data.type === 'Feature') return simplifyFeature(data, simplifyLevel);
  const coordinates = simplifyGeometryCoordinates(data.type, data.coordinates, simplifyLevel);
  if (coordinates == null) return null;
  return {
    type: data.type,
    coordinates,
  };
}

export function simplifyFeature(feature, simplifyLevel) {
  if (!feature?.geometry) return feature;
  const coordinates = simplifyGeometryCoordinates(feature.geometry.type, feature.geometry.coordinates, simplifyLevel);
  if (coordinates == null) return null;
  return {
    ...feature,
    geometry: {
      ...feature.geometry,
      coordinates,
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
      return coordinates
        .map(line => decimateLine(line, stride, false))
        .filter(line => Array.isArray(line) && line.length >= 2);
    case 'Polygon': {
      const polygon = simplifyPolygonCoordinates(coordinates, stride);
      return polygon?.length ? polygon : null;
    }
    case 'MultiPolygon': {
      const polygons = coordinates
        .map(poly => simplifyPolygonCoordinates(poly, stride))
        .filter(poly => Array.isArray(poly) && poly.length);
      return polygons.length ? polygons : null;
    }
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
    if (!first || !last) return null;
    if (first[0] !== last[0] || first[1] !== last[1]) out.push(first);
    if (out.length < 4) return null;
  } else {
    while (out.length < 2 && coords.length > out.length) out.push(coords[out.length]);
  }

  return out;
}

function simplifyPolygonCoordinates(polygonCoords, stride) {
  if (!Array.isArray(polygonCoords) || !polygonCoords.length) return null;
  const rings = polygonCoords
    .map(ring => decimateLine(ring, stride, true))
    .filter(ring => isRenderableRing(ring));
  if (!rings.length) return null;

  const outer = rings[0];
  const holes = rings.slice(1);
  return [outer, ...holes];
}

function isRenderableRing(ring) {
  if (!Array.isArray(ring) || ring.length < 4) return false;
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (!first || !last || first[0] !== last[0] || first[1] !== last[1]) return false;

  let area2 = 0;
  for (let i = 0; i < ring.length - 1; i += 1) {
    const a = ring[i];
    const b = ring[i + 1];
    area2 += (a[0] * b[1]) - (b[0] * a[1]);
  }
  return Math.abs(area2) > 1e-12;
}

function clampSimplifyLevel(value) {
  return Math.max(
    GEOJSON_LIMITS.simplifyLevel.min,
    Math.min(GEOJSON_LIMITS.simplifyLevel.max, Math.round(Number(value) || 0))
  );
}
