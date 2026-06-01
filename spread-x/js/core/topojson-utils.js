import { GEOJSON_LIMITS } from '../config.js';

const topologyArcUsageCache = new WeakMap();

export function simplifyTopology(topology, simplifyLevel) {
  if (!topology || topology.type !== 'Topology' || simplifyLevel <= 0) return topology;
  const stride = Math.max(2, Math.round(Number(simplifyLevel) || 0) + 1);
  const hasTransform = !!topology.transform;
  const arcs = Array.isArray(topology.arcs)
    ? topology.arcs.map(arc => simplifyTopologyArc(arc, stride, hasTransform))
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

  let byObjectName = topologyArcUsageCache.get(topology);
  if (!byObjectName) {
    byObjectName = new Map();
    topologyArcUsageCache.set(topology, byObjectName);
  }

  const objectName = topoSource.objectName || Object.keys(topology.objects || {})[0] || '__first';
  if (byObjectName.has(objectName)) return byObjectName.get(objectName);

  const object = topology.objects?.[objectName] || topology.objects?.[Object.keys(topology.objects || {})[0]];
  if (!object) return null;

  const counts = new Map();
  const state = { totalArcRefs: 0, geometryCount: 0 };
  collectTopoObjectArcRefs(object, counts, state);

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

export function resolveTopoObjectKey(topology, preferredName) {
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

export function resolvePyramidTopologyForLevel(pyramidSource, simplifyLevel) {
  const byLevel = pyramidSource?.topologiesByLevel;
  if (!byLevel) return null;

  const level = clampSimplifyLevel(simplifyLevel);
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

function simplifyTopologyArc(arc, stride, isDeltaEncoded) {
  if (!Array.isArray(arc) || arc.length <= 2 || stride <= 1) return arc;

  const absolute = isDeltaEncoded ? decodeDeltaArc(arc) : arc;
  const simplifiedAbsolute = decimateArcLine(absolute, stride);

  return isDeltaEncoded
    ? encodeDeltaArc(simplifiedAbsolute)
    : simplifiedAbsolute;
}

function decimateArcLine(coords, stride) {
  if (!Array.isArray(coords) || coords.length <= 2 || stride <= 1) return coords;

  const out = [];
  for (let i = 0; i < coords.length; i += 1) {
    if (i === 0 || i === coords.length - 1 || (i % stride) === 0) out.push(coords[i]);
  }

  while (out.length < 2 && coords.length > out.length) out.push(coords[out.length]);
  return out;
}

function decodeDeltaArc(arc) {
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

function encodeDeltaArc(points) {
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

function collectTopoObjectArcRefs(object, counts, state) {
  if (!object) return;
  const type = object.type;
  if (type === 'GeometryCollection') {
    for (const geometry of object.geometries || []) {
      collectTopoObjectArcRefs(geometry, counts, state);
    }
    return;
  }

  state.geometryCount += 1;
  collectArcIndexes(object.arcs, counts, state);
}

function collectArcIndexes(arcs, counts, state) {
  if (typeof arcs === 'number' && Number.isInteger(arcs)) {
    const arcIndex = arcs >= 0 ? arcs : ~arcs;
    counts.set(arcIndex, (counts.get(arcIndex) || 0) + 1);
    state.totalArcRefs += 1;
    return;
  }

  if (!Array.isArray(arcs)) return;
  for (const value of arcs) {
    collectArcIndexes(value, counts, state);
  }
}

function clampSimplifyLevel(value) {
  return Math.max(
    GEOJSON_LIMITS.simplifyLevel.min,
    Math.min(GEOJSON_LIMITS.simplifyLevel.max, Math.round(Number(value) || 0))
  );
}
