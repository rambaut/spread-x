import { GEOJSON_LIMITS } from '../config.js';
import {
  autoGeojsonRenderPolicy,
  countGeoJSONFeatures,
  decimateLine,
  geojsonRenderPolicy,
  resolveGeojsonAdaptiveDetailPercent,
  resolveGeojsonSimplifyLevel,
  simplifyFeature,
  simplifyGeoJSON,
  simplifyGeometryCoordinates,
} from './geojson-utils.js';
import {
  analyzeTopojsonArcUsage,
  resolvePyramidTopologyForLevel,
  resolveTopoObjectKey,
  simplifyTopology,
} from './topojson-utils.js';

export {
  analyzeTopojsonArcUsage,
  autoGeojsonRenderPolicy,
  countGeoJSONFeatures,
  decimateLine,
  geojsonRenderPolicy,
  resolveGeojsonAdaptiveDetailPercent,
  resolveGeojsonSimplifyLevel,
  simplifyFeature,
  simplifyGeoJSON,
  simplifyGeometryCoordinates,
  simplifyTopology,
};

export function resolveLayerGeoJSON(layer, { topojson, resolvedCache } = {}) {
  const data = layer?.data;
  if (!data) return null;

  if (data._sxFormat === 'topojson-object-pyramid') {
    const cached = resolvedCache?.get(layer);
    if (cached && cached.sourceRef === data) return cached.resolved;

    const topology = resolvePyramidTopologyForLevel(data, 0);
    if (!topology || topology.type !== 'Topology') return null;
    const key = resolveTopoObjectKey(topology, data.objectName);
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
    const level = clampSimplifyLevel(simplifyLevel);
    let cache = layerCache?.get(layer);
    if (!cache || cache.sourceRef !== topoSource) {
      cache = {
        sourceRef: topoSource,
        byLevel: new Map(),
      };
      layerCache?.set(layer, cache);
    }

    if (!cache.byLevel.has(level)) {
      const topology = resolvePyramidTopologyForLevel(topoSource, level);
      if (!topology || topology.type !== 'Topology') return null;
      const key = resolveTopoObjectKey(topology, topoSource.objectName);
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
    const level = clampSimplifyLevel(simplifyLevel);
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

  const level = clampSimplifyLevel(simplifyLevel);
  if (!cache.byLevel.has(level)) {
    cache.byLevel.set(level, simplifyGeoJSON(resolved, level));
  }

  return cache.byLevel.get(level) || resolved;
}

function clampSimplifyLevel(value) {
  return Math.max(
    GEOJSON_LIMITS.simplifyLevel.min,
    Math.min(GEOJSON_LIMITS.simplifyLevel.max, Math.round(Number(value) || 0))
  );
}
