import { countryFeatureId } from '../core/renderer-basemap-utils.js';
import { analyzeTopojsonArcUsage, simplifyTopology } from '../core/topojson-utils.js';

const _featurePartBoundsCache = new WeakMap();
const _geometryComponentsCache = new WeakMap();
const _featureVertexCountCache = new WeakMap();
const _featurePathCache = new WeakMap();
const _geometryPathCache = new WeakMap();
const _boundaryMeshCache = new WeakMap();
const _geoVectorLandPathCache = new Map();
const _geoVectorCountryMeshPathCache = new Map();
const BOUNDARY_LAYER_NAMES = new Set(['countries', 'admin0', 'admin1', 'admin2']);
const OCEAN_LAYER_NAMES = new Set(['oceans', 'oceanmask']);
const PART_MIN_SCREEN_WIDTH_PX = 1.5;
const PART_MIN_SCREEN_HEIGHT_PX = 1.5;
const PART_MIN_SCREEN_AREA_PX2 = 4;

function _boundedCacheSet(map, key, value, maxEntries = 32) {
  map.set(key, value);
  if (map.size > maxEntries) {
    const firstKey = map.keys().next().value;
    if (firstKey !== undefined) map.delete(firstKey);
  }
}

function geojsonFeatureRuntimeId(feature, index = -1) {
  const p = feature?.properties || {};
  const raw = String(
    p.id ||
    p.ID ||
    p.fid ||
    p.FID ||
    p.iso_a3 ||
    p.ISO_A3 ||
    p.NAME_EN ||
    p.NAME ||
    p.name ||
    feature?.id ||
    ''
  ).trim();
  if (raw) return raw;
  return index >= 0 ? `feature-${index}` : '';
}

function _countGeometryVertices(geometry) {
  if (!geometry) return 0;
  const coords = geometry.coordinates;
  if (!coords) return 0;

  switch (geometry.type) {
    case 'Point':
      return 1;
    case 'MultiPoint':
    case 'LineString':
      return Array.isArray(coords) ? coords.length : 0;
    case 'MultiLineString':
    case 'Polygon':
      return Array.isArray(coords)
        ? coords.reduce((sum, line) => sum + (Array.isArray(line) ? line.length : 0), 0)
        : 0;
    case 'MultiPolygon':
      return Array.isArray(coords)
        ? coords.reduce(
          (sum, poly) => sum + (Array.isArray(poly)
            ? poly.reduce((ringSum, ring) => ringSum + (Array.isArray(ring) ? ring.length : 0), 0)
            : 0),
          0
        )
        : 0;
    case 'GeometryCollection':
      return Array.isArray(geometry.geometries)
        ? geometry.geometries.reduce((sum, g) => sum + _countGeometryVertices(g), 0)
        : 0;
    default:
      return 0;
  }
}

function _countFeatureVertices(feature) {
  return _countGeometryVertices(feature?.geometry);
}

function _countFeatureVerticesCached(feature) {
  if (!feature) return 0;
  const cached = _featureVertexCountCache.get(feature);
  if (Number.isFinite(cached)) return cached;
  const count = _countFeatureVertices(feature);
  _featureVertexCountCache.set(feature, count);
  return count;
}

function _featurePathCached(path, feature, projectionStamp) {
  if (!path || !feature) return null;
  const cached = _featurePathCache.get(feature);
  if (cached && cached.stamp === projectionStamp) return cached.d;
  const d = path(feature);
  _featurePathCache.set(feature, { stamp: projectionStamp, d });
  return d;
}

function _geometryPathCached(path, geometry, projectionStamp) {
  if (!path || !geometry) return null;
  const cached = _geometryPathCache.get(geometry);
  if (cached && cached.stamp === projectionStamp) return cached.d;
  const d = path(geometry);
  _geometryPathCache.set(geometry, { stamp: projectionStamp, d });
  return d;
}

function _countSvgSubpaths(pathD) {
  if (typeof pathD !== 'string' || !pathD) return 0;
  const matches = pathD.match(/M/g);
  return matches ? matches.length : 0;
}

function _countBoundaryLineParts(geometry) {
  if (!geometry) return 0;
  if (geometry.type === 'LineString') return 1;
  if (geometry.type === 'MultiLineString') return Array.isArray(geometry.coordinates) ? geometry.coordinates.length : 0;
  return 0;
}

function _decimateLineCoords(coords, stride) {
  if (!Array.isArray(coords) || coords.length <= 2 || stride <= 1) return coords;
  const out = [];
  for (let i = 0; i < coords.length; i += 1) {
    if (i === 0 || i === coords.length - 1 || (i % stride) === 0) out.push(coords[i]);
  }
  return out.length >= 2 ? out : [coords[0], coords[coords.length - 1]];
}

function _simplifyBoundaryMeshGeometry(meshGeometry, simplifyLevel) {
  const level = Math.max(0, Math.round(Number(simplifyLevel) || 0));
  if (!meshGeometry || level <= 0) return meshGeometry;
  const stride = Math.max(2, level + 1);

  if (meshGeometry.type === 'LineString') {
    return {
      ...meshGeometry,
      coordinates: _decimateLineCoords(meshGeometry.coordinates, stride),
    };
  }

  if (meshGeometry.type === 'MultiLineString') {
    return {
      ...meshGeometry,
      coordinates: (meshGeometry.coordinates || []).map(line => _decimateLineCoords(line, stride)),
    };
  }

  return meshGeometry;
}

function _getBoundaryMeshGeometry(layer, topojson, prepareForSeamClipping, projectionStamp, simplifyLevel = 0) {
  if (!layer?.data || layer.data._sxFormat !== 'topojson-object') return null;
  const topology = layer.data.topology;
  if (!topology || topology.type !== 'Topology') return null;
  if (!topojson?.mesh) return null;

  let byTopology = _boundaryMeshCache.get(topology);
  if (!byTopology) {
    byTopology = new Map();
    _boundaryMeshCache.set(topology, byTopology);
  }

  const objectName = String(layer.data.objectName || '__first');
  const cacheKey = `${objectName}:${projectionStamp}:${Math.max(0, Math.round(Number(simplifyLevel) || 0))}`;
  if (byTopology.has(cacheKey)) return byTopology.get(cacheKey);

  const level = Math.max(0, Math.round(Number(simplifyLevel) || 0));
  const topologyForMesh = level > 0 ? simplifyTopology(topology, level) : topology;
  const objects = topologyForMesh.objects || {};
  const object = objects[layer.data.objectName] || objects[Object.keys(objects)[0]];
  if (!object) return null;

  const mesh = topojson.mesh(topologyForMesh, object, (a, b) => a !== b);
  const prepared = prepareForSeamClipping ? prepareForSeamClipping(mesh) : mesh;
  byTopology.set(cacheKey, prepared);
  return prepared;
}

function _shouldApplyPartCull(feature, rawVertexCount, viewportAreaRatio = 0) {
  const type = feature?.geometry?.type;
  if (type !== 'MultiPolygon' && type !== 'GeometryCollection') return false;
  if (rawVertexCount >= 80000) return true;
  if (rawVertexCount >= 50000 && viewportAreaRatio >= 8.0) return true;
  return false;
}

function _geometryComponents(geometry) {
  if (!geometry) return [];
  const cached = _geometryComponentsCache.get(geometry);
  if (cached) return cached;

  let components;

  switch (geometry.type) {
    case 'Polygon':
      components = [{ type: 'Polygon', coordinates: geometry.coordinates, cacheKey: geometry.coordinates }];
      break;
    case 'MultiPolygon':
      components = Array.isArray(geometry.coordinates)
        ? geometry.coordinates.map(poly => ({ type: 'Polygon', coordinates: poly, cacheKey: poly }))
        : [];
      break;
    case 'GeometryCollection':
      components = Array.isArray(geometry.geometries)
        ? geometry.geometries.flatMap(g => _geometryComponents(g))
        : [];
      break;
    default:
      components = [{ ...geometry, cacheKey: geometry }];
      break;
  }

  _geometryComponentsCache.set(geometry, components);
  return components;
}

function _boundsForFeaturePart(path, feature, cacheKey, projectionStamp) {
  if (!path || !feature) return null;
  if (cacheKey && projectionStamp != null) {
    const cached = _featurePartBoundsCache.get(cacheKey);
    if (cached?.stamp === projectionStamp) return cached.bounds;
  }
  try {
    const b = path.bounds(feature);
    if (!b || !Number.isFinite(b[0]?.[0]) || !Number.isFinite(b[0]?.[1]) ||
        !Number.isFinite(b[1]?.[0]) || !Number.isFinite(b[1]?.[1])) {
      return null;
    }
    if (cacheKey && projectionStamp != null) {
      _featurePartBoundsCache.set(cacheKey, { stamp: projectionStamp, bounds: b });
    }
    return b;
  } catch {
    return null;
  }
}

function _viewBoundsFromTransform(transform, frameRect) {
  if (!transform || !frameRect) return null;
  const k = Number(transform.k);
  if (!Number.isFinite(k) || k === 0) return null;
  const invK = 1 / k;
  const minX = (frameRect.x - transform.x) * invK;
  const maxX = ((frameRect.x + frameRect.width) - transform.x) * invK;
  const minY = (frameRect.y - transform.y) * invK;
  const maxY = ((frameRect.y + frameRect.height) - transform.y) * invK;
  return {
    minX: Math.min(minX, maxX),
    maxX: Math.max(minX, maxX),
    minY: Math.min(minY, maxY),
    maxY: Math.max(minY, maxY),
  };
}

function _boundsIntersectView(bounds, viewBounds) {
  if (!bounds || !viewBounds) return false;
  const minX = bounds[0]?.[0];
  const minY = bounds[0]?.[1];
  const maxX = bounds[1]?.[0];
  const maxY = bounds[1]?.[1];
  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
    return false;
  }
  return maxX >= viewBounds.minX && minX <= viewBounds.maxX && maxY >= viewBounds.minY && minY <= viewBounds.maxY;
}

function _filterFeatureToVisibleGeometry(feature, {
  path,
  transform,
  frameRect,
  viewBounds,
  intersectsViewportAfterTransform,
  projectionStamp,
} = {}) {
  if (!feature?.geometry) return null;

  const components = _geometryComponents(feature.geometry);
  if (!components.length) return feature;
  if (components.length === 1 && feature.geometry.type !== 'MultiPolygon' && feature.geometry.type !== 'GeometryCollection') {
    return feature;
  }

  const visibleComponents = [];
  const k = Math.abs(Number(transform?.k) || 1);
  for (const geometry of components) {
    const candidateGeometry = {
      type: geometry.type,
      coordinates: geometry.coordinates,
    };
    const candidate = { ...feature, geometry: candidateGeometry };
    const bounds = _boundsForFeaturePart(path, candidate, geometry.cacheKey, projectionStamp);
    if (!bounds) continue;
    const isVisible = viewBounds
      ? _boundsIntersectView(bounds, viewBounds)
      : intersectsViewportAfterTransform(bounds, transform, frameRect);
    if (!isVisible) continue;

    // Skip tiny projected fragments to avoid rendering micro-artifacts.
    const projectedW = Math.abs((bounds[1][0] - bounds[0][0]) * k);
    const projectedH = Math.abs((bounds[1][1] - bounds[0][1]) * k);
    const projectedArea = projectedW * projectedH;
    if (projectedW < PART_MIN_SCREEN_WIDTH_PX && projectedH < PART_MIN_SCREEN_HEIGHT_PX) continue;
    if (projectedArea < PART_MIN_SCREEN_AREA_PX2) continue;

    visibleComponents.push(candidateGeometry);
  }

  if (!visibleComponents.length) return null;
  if (visibleComponents.length === components.length) return feature;
  if (visibleComponents.length === 1) {
    return {
      ...feature,
      geometry: visibleComponents[0],
    };
  }

  return {
    ...feature,
    geometry: {
      type: 'MultiPolygon',
      coordinates: visibleComponents
        .filter(geometry => geometry?.type === 'Polygon')
        .map(geometry => geometry.coordinates),
    },
  };
}

export async function renderSvgBasemapLayer({
  g,
  layer,
  d3,
  topojson,
  path,
  currentTransform,
  projectionStamp,
  projId,
  basemapCache,
  setBasemapCache,
  fetchOutline,
  prepareForSeamClipping,
  basemapOutlineIds,
  chooseGeographicRasterPath,
  computeGeographicImageRect,
  normalizeScale,
  pickTopoObjectKey,
} = {}) {
  if (!g || !layer || !path) return;

  const s = layer.style || {};
  if ((s.baseMode || 'globe') === 'geographic') {
    await renderSvgGeographicBasemapLayer({
      g,
      layer,
      topojson,
      path,
      projectionStamp,
      currentTransform,
      fetchOutline,
      prepareForSeamClipping,
      chooseGeographicRasterPath,
      computeGeographicImageRect,
      normalizeScale,
      pickTopoObjectKey,
    });
    return;
  }

  const showBasemapFeatures = layer?.runtime?.showBasemapFeatures !== false;
  const showGlobe = showBasemapFeatures && s.showGlobe !== false;
  const oceanFill = s.oceanFill;
  const landFill = s.landFill;
  const showLandBoundaries = showGlobe && s.showLandBoundaries !== false;
  const showCountryBoundaries = showGlobe && s.showCountryBoundaries !== false;
  const landBoundaryStroke = s.landBoundaryStroke || s.landStroke || '#4a8a5a';
  const landBoundaryWidth = s.landBoundaryWidth ?? s.landStrokeWidth ?? 0.5;
  const showProjectionBoundary = s.showGraticule !== false;

  g.append('path')
    .attr('class', 'basemap-sphere')
    .datum({ type: 'Sphere' })
    .attr('d', path)
    .attr('fill', oceanFill)
    .attr('stroke', showProjectionBoundary ? (s.projectionBoundaryStroke || s.outlineStroke || '#4a8a5a') : 'none')
    .attr('stroke-width', showProjectionBoundary ? (s.projectionBoundaryWidth ?? s.outlineStrokeWidth ?? 1) : 0)
    .attr('vector-effect', 'non-scaling-stroke')
    .attr('stroke-linejoin', 'round')
    .attr('stroke-linecap', 'round');

  if (s.showGraticule) {
    const step = s.graticuleStep || 10;
    const projection = typeof path.projection === 'function' ? path.projection() : null;
    const canTunePrecision = !!projection && typeof projection.precision === 'function';
    const graticulePrecision = Math.max(0.05, Math.min(2, Number(s.graticuleCurvePrecision ?? 0.2)));
    const previousPrecision = canTunePrecision ? projection.precision() : null;
    if (canTunePrecision) projection.precision(graticulePrecision);
    g.append('path')
      .datum(d3.geoGraticule().step([step, step])())
      .attr('d', path)
      .attr('fill', 'none')
      .attr('stroke', s.graticuleStroke || '#ffffff')
      .attr('stroke-width', s.graticuleWidth ?? 0.5)
      .attr('vector-effect', 'non-scaling-stroke')
      .attr('stroke-linejoin', 'round')
      .attr('stroke-linecap', 'round')
      .attr('opacity', s.graticuleOpacity ?? 0.1);
    if (canTunePrecision && Number.isFinite(previousPrecision)) projection.precision(previousPrecision);
  }

  const bsrc = s.basemapSource || 'd3';
  const [landId, countriesId] = basemapOutlineIds(bsrc);

  try {
    const [landTopo, countriesTopo] = await Promise.all([
      fetchOutline(landId),
      fetchOutline(countriesId),
    ]);

    let cache = basemapCache;
    if (cache?.stamp !== projectionStamp || cache?.projId !== projId || cache?.src !== bsrc) {
      let land = null;
      let countryMesh = null;
      if (landTopo) {
        const landKey = pickTopoObjectKey(landTopo, ['land']);
        if (landKey) {
          land = prepareForSeamClipping(topojson.feature(landTopo, landTopo.objects[landKey]));
        }
      }
      if (countriesTopo) {
        const countriesKey = pickTopoObjectKey(countriesTopo, ['countries', 'country', 'admin0', 'ne_admin_0_countries']);
        if (countriesKey) {
          countryMesh = prepareForSeamClipping(
            topojson.mesh(countriesTopo, countriesTopo.objects[countriesKey], (a, b) => a !== b)
          );
        }
      }
      cache = {
        stamp: projectionStamp,
        projId,
        src: bsrc,
        land,
        countryMesh,
        pathStamp: null,
        spherePathD: null,
        landPathD: null,
        countryMeshPathD: null,
      };
      setBasemapCache(cache);
    }

    if (cache.pathStamp !== projectionStamp) {
      cache.pathStamp = projectionStamp;
      cache.spherePathD = path({ type: 'Sphere' }) || null;
      cache.landPathD = cache.land ? (path(cache.land) || null) : null;
      cache.countryMeshPathD = cache.countryMesh ? (path(cache.countryMesh) || null) : null;
      setBasemapCache(cache);
    }

    const { land, countryMesh } = cache || {};
    const spherePathD = cache?.spherePathD || null;
    const landPathD = cache?.landPathD || null;
    const countryMeshPathD = cache?.countryMeshPathD || null;

    if (spherePathD) {
      const spherePathEl = g.select('path.basemap-sphere');
      if (!spherePathEl.empty()) spherePathEl.attr('d', spherePathD);
    }

    if (land) {
      if (showGlobe) {
        g.append('path')
          .attr('class', 'land')
          .attr('d', landPathD || path(land))
          .attr('fill-rule', 'evenodd')
          .attr('fill', landFill)
          .attr('stroke', 'none');
      }

      if (showLandBoundaries) {
        g.append('path')
          .attr('class', 'land-boundaries')
          .attr('d', landPathD || path(land))
          .attr('fill', 'none')
          .attr('stroke', landBoundaryStroke)
          .attr('stroke-width', landBoundaryWidth)
          .attr('vector-effect', 'non-scaling-stroke')
          .attr('stroke-linejoin', 'round')
          .attr('stroke-linecap', 'round');
      }
    }

    if (showCountryBoundaries && countryMesh) {
      g.append('path').attr('class', 'borders')
        .attr('d', countryMeshPathD || path(countryMesh))
        .attr('fill', 'none')
        .attr('stroke', landBoundaryStroke)
        .attr('stroke-width', landBoundaryWidth)
        .attr('vector-effect', 'non-scaling-stroke')
        .attr('stroke-linejoin', 'round')
        .attr('stroke-linecap', 'round');
    }
  } catch (err) {
    console.warn('Failed to load map outline:', err);
  }
}

export async function renderSvgGeographicBasemapLayer({
  g,
  layer,
  topojson,
  path,
  projectionStamp,
  currentTransform,
  fetchOutline,
  prepareForSeamClipping,
  chooseGeographicRasterPath,
  computeGeographicImageRect,
  normalizeScale,
  pickTopoObjectKey,
} = {}) {
  if (!g || !path) return;

  const s = layer?.style || {};
  const normalizedLayerName = String(layer?.name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const isBoundaryLayer = normalizedLayerName === 'countries' || normalizedLayerName === 'admin0' || normalizedLayerName === 'admin1' || normalizedLayerName === 'admin2';
  const zoomK = currentTransform?.k || 1;
  const sourceType = s.geographicSourceType || 'raster';
  const oceanFill = s.geographicOceanFill || s.oceanFill || '#0d2f40';
  const showProjectionBoundary = s.showGraticule !== false;

  g.append('path')
    .datum({ type: 'Sphere' })
    .attr('d', path)
    .attr('fill', oceanFill)
    .attr('stroke', showProjectionBoundary ? (s.projectionBoundaryStroke || s.outlineStroke || '#4a8a5a') : 'none')
    .attr('stroke-width', showProjectionBoundary ? (s.projectionBoundaryWidth ?? s.outlineStrokeWidth ?? 1) : 0)
    .attr('vector-effect', 'non-scaling-stroke')
    .attr('stroke-linejoin', 'round')
    .attr('stroke-linecap', 'round');

  if (sourceType === 'raster') {
    const rasterUrl = chooseGeographicRasterPath(s, zoomK);
    const rect = computeGeographicImageRect();
    if (rasterUrl && rect) {
      g.append('image')
        .attr('class', 'ne-raster')
        .attr('href', rasterUrl)
        .attr('x', rect.x)
        .attr('y', rect.y)
        .attr('width', rect.width)
        .attr('height', rect.height)
        .attr('preserveAspectRatio', 'none')
        .attr('crossorigin', 'anonymous');
    }
  } else {
    const vectorScale = normalizeScale(s.geographicVectorScale, '50m');
    const landPathKey = `${vectorScale}|${projectionStamp}`;
    let landPathD = _geoVectorLandPathCache.get(landPathKey) || null;
    if (!landPathD) {
      const landTopo = await fetchOutline(`ne-land-${vectorScale}`);
      if (landTopo) {
        const key = pickTopoObjectKey(landTopo, ['land']);
        if (key) {
          const land = prepareForSeamClipping(topojson.feature(landTopo, landTopo.objects[key]));
          landPathD = path(land) || null;
          if (landPathD) _boundedCacheSet(_geoVectorLandPathCache, landPathKey, landPathD);
        }
      }
    }

    if (landPathD) {
      g.append('path')
        .attr('class', 'ne-land')
        .attr('d', landPathD)
        .attr('fill-rule', 'evenodd')
        .attr('fill', s.geographicLandFill || '#9aa876')
        .attr('stroke', 'none');
    }
  }

  if (s.geographicShowCountries !== false && layer?.runtime?.showBasemapCountryPolygons === true) {
    await drawSvgGeographicCountries({
      g,
      style: s,
      runtime: layer?.runtime,
      topojson,
      path,
      projectionStamp,
      fetchOutline,
      prepareForSeamClipping,
      normalizeScale,
      pickTopoObjectKey,
    });
  }
}

export async function drawSvgGeographicCountries({
  g,
  style,
  runtime,
  topojson,
  path,
  projectionStamp,
  fetchOutline,
  prepareForSeamClipping,
  normalizeScale,
  pickTopoObjectKey,
} = {}) {
  if (!g || !style || !path) return;

  const scale = normalizeScale(style.geographicCountryScale || style.geographicVectorScale, '50m');
  const countryTopo = await fetchOutline(`ne-countries-${scale}`);
  if (!countryTopo) return;
  const key = pickTopoObjectKey(countryTopo, ['countries', 'country', 'admin0', 'ne_admin_0_countries']);
  if (!key) return;

  const hoveredId = String(runtime?.hoveredFeatureId || runtime?.hoveredCountryId || '').trim();
  const selectedIds = new Set((runtime?.selectedFeatureIds || runtime?.selectedCountryIds || []).map(id => String(id)));

  if (hoveredId || selectedIds.size) {
    const fc = topojson.feature(countryTopo, countryTopo.objects[key]);
    const features = fc?.type === 'FeatureCollection' ? (fc.features || []) : [fc].filter(Boolean);

    const selectedFeatures = features
      .filter(feature => selectedIds.has(countryFeatureId(feature)))
      .map(prepareForSeamClipping);

    const hoveredFeature = features.find(feature => countryFeatureId(feature) === hoveredId);

    if (selectedFeatures.length) {
      g.selectAll('path.ne-country-selected')
        .data(selectedFeatures)
        .join('path')
        .attr('class', 'ne-country-selected')
        .attr('d', path)
        .attr('fill', style.geographicCountrySelectFill || 'rgba(255, 196, 77, 0.34)')
        .attr('stroke', 'none');
    }

    if (hoveredFeature) {
      g.append('path')
        .attr('class', 'ne-country-hover')
        .datum(prepareForSeamClipping(hoveredFeature))
        .attr('d', path)
        .attr('fill', style.geographicCountryHoverFill || 'rgba(120, 205, 255, 0.32)')
        .attr('stroke', 'none');
    }
  }

  const meshPathKey = `${scale}|${projectionStamp}`;
  let meshPathD = _geoVectorCountryMeshPathCache.get(meshPathKey) || null;
  if (!meshPathD) {
    const mesh = prepareForSeamClipping(
      topojson.mesh(countryTopo, countryTopo.objects[key], (a, b) => a !== b)
    );
    meshPathD = path(mesh) || null;
    if (meshPathD) _boundedCacheSet(_geoVectorCountryMeshPathCache, meshPathKey, meshPathD);
  }

  if (!meshPathD) return;

  g.append('path')
    .attr('class', 'ne-countries')
    .attr('d', meshPathD)
    .attr('fill', 'none')
    .attr('stroke', style.geographicCountryStroke || '#3e3e3e')
    .attr('stroke-width', style.geographicCountryStrokeWidth ?? 0.45)
    .attr('stroke-opacity', style.geographicCountryOpacity ?? 0.65)
    .attr('vector-effect', 'non-scaling-stroke')
    .attr('stroke-linejoin', 'round')
    .attr('stroke-linecap', 'round');
}

export function renderSvgGeoJsonLayer({
  g,
  layer,
  d3,
  topojson,
  path,
  projectionStamp,
  currentTransform,
  currentFrameRect,
  width,
  height,
  featureBounds,
  intersectsViewportAfterTransform,
  geojsonRenderPolicy,
  getSimplifiedLayerData,
  getPreparedLayerData,
  resolveGeojsonSimplifyLevel,
  prepareForSeamClipping,
  geojsonRenderStats,
} = {}) {
  if (!g || !layer?.data || !path) return;

  const perfNow = () => ((typeof performance !== 'undefined' && typeof performance.now === 'function')
    ? performance.now()
    : Date.now());
  const perfStart = perfNow();

  const s = layer.style || {};
  const normalizedLayerName = String(layer?.name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const isBoundaryLayer = BOUNDARY_LAYER_NAMES.has(normalizedLayerName);
  const isOceansLayer = OCEAN_LAYER_NAMES.has(normalizedLayerName);
  const boundarySeamOverdrawPx = Number.isFinite(+s.boundarySeamOverdrawPx)
    ? Math.max(0, +s.boundarySeamOverdrawPx)
    : 0.35;
  const layerFill = isBoundaryLayer ? 'none' : s.fill;
  const layerFillOpacity = isBoundaryLayer ? 0 : s.fillOpacity;
  // Boundary meshes are often emitted as many disjoint subpaths; round caps/joins
  // mask tiny rasterization gaps at subpath seams.
  const layerStrokeLinecap = 'round';
  const layerStrokeLinejoin = 'round';
  const resolved = getSimplifiedLayerData(layer, 0);
  if (!resolved) return;

  const rawFeatures = resolved.type === 'FeatureCollection' ? resolved.features : [resolved];
  const zoomT = currentTransform || d3.zoomIdentity;
  const simplifyLevel = resolveGeojsonSimplifyLevel?.({
    zoomScale: zoomT.k,
    featureCount: rawFeatures.length,
    style: s,
  }) ?? Math.max(0, Math.min(12, Math.round(Number(s.simplify ?? 0))));
  let effectiveSimplifyLevel = simplifyLevel;

  const prepared = getPreparedLayerData
    ? getPreparedLayerData(layer, effectiveSimplifyLevel)
    : prepareForSeamClipping(effectiveSimplifyLevel > 0 ? getSimplifiedLayerData(layer, effectiveSimplifyLevel) : resolved);
  if (!prepared) return;
  const allFeatures = prepared.type === 'FeatureCollection' ? prepared.features : [prepared];
  const perfAfterPrep = perfNow();
  const policy = geojsonRenderPolicy(allFeatures.length, s);

  if (zoomT.k < policy.minZoom) {
    const perfEnd = perfNow();
    geojsonRenderStats.set(layer.id, {
      totalFeatures: allFeatures.length,
      inViewFeatures: 0,
      renderedFeatures: 0,
      zoomScale: zoomT.k,
      simplifyLevel,
      minZoom: policy.minZoom,
      hiddenByZoom: true,
      renderedVertexCount: 0,
      timingsMs: {
        prep: Math.max(0, perfAfterPrep - perfStart),
        cull: 0,
        draw: 0,
        total: Math.max(0, perfEnd - perfStart),
      },
    });
    return;
  }

  // Oceans is typically a single, very large multipart polygon. Running
  // per-part cull/decomposition on that geometry dominates frame time.
  // Draw directly with cached path after simplification.
  if (isOceansLayer && allFeatures.length === 1) {
    const oceanFeature = allFeatures[0];
    const perfAfterCull = perfNow();
    const perfDrawStart = perfNow();

    g.append('path')
      .datum(oceanFeature)
      .attr('d', feature => _featurePathCached(path, feature, projectionStamp))
      .attr('fill', layerFill)
      .attr('fill-opacity', layerFillOpacity)
      .attr('stroke', s.stroke)
      .attr('stroke-width', s.strokeWidth)
      .attr('vector-effect', 'non-scaling-stroke')
      .attr('stroke-linejoin', layerStrokeLinejoin)
      .attr('stroke-linecap', layerStrokeLinecap);

    const perfAfterDraw = perfNow();
    geojsonRenderStats.set(layer.id, {
      totalFeatures: allFeatures.length,
      inViewFeatures: 1,
      renderedFeatures: 1,
      zoomScale: zoomT.k,
      simplifyLevel: effectiveSimplifyLevel,
      minZoom: policy.minZoom,
      hiddenByZoom: false,
      partCullChecked: 0,
      partCullApplied: 0,
      renderedVertexCount: _countFeatureVerticesCached(oceanFeature),
      timingsMs: {
        prep: Math.max(0, perfAfterPrep - perfStart),
        cull: Math.max(0, perfAfterCull - perfAfterPrep),
        draw: Math.max(0, perfAfterDraw - perfDrawStart),
        total: Math.max(0, perfAfterDraw - perfStart),
      },
    });
    return;
  }

  if (isBoundaryLayer && layerFill === 'none') {
    const boundaryMesh = _getBoundaryMeshGeometry(layer, topojson, prepareForSeamClipping, projectionStamp, effectiveSimplifyLevel);
    if (boundaryMesh) {
      const perfAfterCull = perfNow();
      const perfDrawStart = perfNow();
      const boundaryPathD = _geometryPathCached(path, boundaryMesh, projectionStamp);
      const topologyDebug = analyzeTopojsonArcUsage(layer);
      const boundaryDebug = {
        renderer: 'svg',
        sourceFormat: layer?.data?._sxFormat || layer?.data?.type || null,
        geometryType: boundaryMesh.type || null,
        lineParts: _countBoundaryLineParts(boundaryMesh),
        projectedSubpaths: _countSvgSubpaths(boundaryPathD),
        stitchApplied: false,
        renderStrategy: 'mesh',
        topology: topologyDebug,
      };

      if (s.stroke && s.stroke !== 'none' && s.strokeWidth > 0 && boundarySeamOverdrawPx > 0) {
        g.append('path')
          .datum(boundaryMesh)
          .attr('class', 'borders-seam-fix')
          .attr('d', boundaryPathD)
          .attr('fill', 'none')
          .attr('stroke', s.stroke)
          .attr('stroke-width', (Number(s.strokeWidth) || 0) + boundarySeamOverdrawPx)
          .attr('vector-effect', 'non-scaling-stroke')
          .attr('stroke-linejoin', layerStrokeLinejoin)
          .attr('stroke-linecap', layerStrokeLinecap);
      }

      g.append('path')
        .datum(boundaryMesh)
        .attr('d', boundaryPathD)
        .attr('fill', 'none')
        .attr('stroke', s.stroke)
        .attr('stroke-width', s.strokeWidth)
        .attr('vector-effect', 'non-scaling-stroke')
        .attr('stroke-linejoin', layerStrokeLinejoin)
        .attr('stroke-linecap', layerStrokeLinecap);

      const hoveredId = String(layer?.runtime?.hoveredFeatureId || '').trim();
      const selectedIds = new Set((layer?.runtime?.selectedFeatureIds || []).map(id => String(id)));
      if (hoveredId || selectedIds.size) {
        const selectedFeatures = allFeatures.filter((feature, idx) => selectedIds.has(geojsonFeatureRuntimeId(feature, idx)));
        const hoveredFeature = allFeatures.find((feature, idx) => geojsonFeatureRuntimeId(feature, idx) === hoveredId);

        if (selectedFeatures.length) {
          g.append('path')
            .datum({ type: 'FeatureCollection', features: selectedFeatures })
            .attr('class', 'sx-geojson-selected')
            .attr('d', path)
            .attr('fill', s.featureSelectFill || 'rgba(255, 196, 77, 0.34)')
            .attr('stroke', s.featureSelectStroke || 'none')
            .attr('stroke-width', s.featureSelectStrokeWidth ?? s.strokeWidth ?? 1)
            .attr('vector-effect', 'non-scaling-stroke')
            .attr('stroke-linejoin', 'round')
            .attr('stroke-linecap', 'round');
        }

        if (hoveredFeature) {
          g.append('path')
            .datum(hoveredFeature)
            .attr('class', 'sx-geojson-hover')
            .attr('d', path)
            .attr('fill', s.featureHoverFill || 'rgba(120, 205, 255, 0.32)')
            .attr('stroke', s.featureHoverStroke || 'none')
            .attr('stroke-width', s.featureHoverStrokeWidth ?? s.strokeWidth ?? 1)
            .attr('vector-effect', 'non-scaling-stroke')
            .attr('stroke-linejoin', 'round')
            .attr('stroke-linecap', 'round');
        }
      }

      const perfAfterDraw = perfNow();
      geojsonRenderStats.set(layer.id, {
        totalFeatures: allFeatures.length,
        inViewFeatures: allFeatures.length,
        renderedFeatures: 1,
        zoomScale: zoomT.k,
        simplifyLevel: effectiveSimplifyLevel,
        minZoom: policy.minZoom,
        hiddenByZoom: false,
        partCullChecked: 0,
        partCullApplied: 0,
        renderedVertexCount: _countGeometryVertices(boundaryMesh),
        boundaryDebug,
        timingsMs: {
          prep: Math.max(0, perfAfterPrep - perfStart),
          cull: Math.max(0, perfAfterCull - perfAfterPrep),
          draw: Math.max(0, perfAfterDraw - perfDrawStart),
          total: Math.max(0, perfAfterDraw - perfStart),
        },
      });
      return;
    }
  }

  const frameRect = currentFrameRect || { x: 0, y: 0, width, height };
  const viewBounds = _viewBoundsFromTransform(zoomT, frameRect);
  const features = [];
  let renderedVertexCount = 0;
  let inViewFeatures = 0;
  let partCullChecked = 0;
  let partCullApplied = 0;
  const perfCullStart = perfNow();

  for (const feature of allFeatures) {
    const b = featureBounds(feature);
    if (!b) continue;
    const featureVisible = viewBounds
      ? _boundsIntersectView(b, viewBounds)
      : intersectsViewportAfterTransform(b, zoomT, frameRect);
    if (!featureVisible) continue;
    const tMinX = zoomT.applyX(b[0][0]);
    const tMaxX = zoomT.applyX(b[1][0]);
    const tMinY = zoomT.applyY(b[0][1]);
    const tMaxY = zoomT.applyY(b[1][1]);
    const featureScreenW = Math.max(0, Math.abs(tMaxX - tMinX));
    const featureScreenH = Math.max(0, Math.abs(tMaxY - tMinY));
    const frameArea = Math.max(1, (frameRect?.width || 1) * (frameRect?.height || 1));
    const viewportAreaRatio = (featureScreenW * featureScreenH) / frameArea;
    const rawVertexCount = _countFeatureVerticesCached(feature);
    const allowPartCull = !(isBoundaryLayer && effectiveSimplifyLevel >= 4) && !isOceansLayer;
    const usePartCull = allowPartCull && _shouldApplyPartCull(feature, rawVertexCount, viewportAreaRatio);
    if (usePartCull) partCullChecked += 1;
    const filteredFeature = usePartCull
      ? _filterFeatureToVisibleGeometry(feature, {
          path,
          transform: zoomT,
          frameRect,
          viewBounds,
          intersectsViewportAfterTransform,
          projectionStamp,
        })
      : feature;
    if (!filteredFeature) continue;
    if (usePartCull && filteredFeature !== feature) partCullApplied += 1;
    inViewFeatures += 1;
    features.push(filteredFeature);
    renderedVertexCount += (filteredFeature === feature)
      ? rawVertexCount
      : _countFeatureVertices(filteredFeature);
  }
  const perfAfterCull = perfNow();

  let perfAfterDraw = perfAfterCull;
  if (features.length) {
    const perfDrawStart = perfNow();
    // Fill adjacent polygons as one compound path to avoid anti-alias seams.
    const hasFill = !!(layerFill && layerFill !== 'none' && (layerFillOpacity ?? 1) > 0);
    const useBatchedPath = !isBoundaryLayer && (hasFill || features.length > 250 || renderedVertexCount > 250000);

    if (useBatchedPath) {
      g.append('path')
        .datum({ type: 'FeatureCollection', features })
        .attr('d', path)
        .attr('fill', layerFill)
        .attr('fill-opacity', layerFillOpacity)
        .attr('stroke', s.stroke)
        .attr('stroke-width', s.strokeWidth)
        .attr('vector-effect', 'non-scaling-stroke')
        .attr('stroke-linejoin', layerStrokeLinejoin)
        .attr('stroke-linecap', layerStrokeLinecap);
    } else {
      g.selectAll('path').data(features).join('path')
        .attr('d', feature => _featurePathCached(path, feature, projectionStamp))
        .attr('fill', layerFill)
        .attr('fill-opacity', layerFillOpacity)
        .attr('stroke', s.stroke)
        .attr('stroke-width', s.strokeWidth)
        .attr('vector-effect', 'non-scaling-stroke')
        .attr('stroke-linejoin', layerStrokeLinejoin)
        .attr('stroke-linecap', layerStrokeLinecap);
    }

    const hoveredId = String(layer?.runtime?.hoveredFeatureId || '').trim();
    const selectedIds = new Set((layer?.runtime?.selectedFeatureIds || []).map(id => String(id)));
    if (hoveredId || selectedIds.size) {
      const selectedFeatures = features.filter((feature, idx) => selectedIds.has(geojsonFeatureRuntimeId(feature, idx)));
      const hoveredFeature = features.find((feature, idx) => geojsonFeatureRuntimeId(feature, idx) === hoveredId);

      if (selectedFeatures.length) {
        g.append('path')
          .datum({ type: 'FeatureCollection', features: selectedFeatures })
          .attr('class', 'sx-geojson-selected')
          .attr('d', path)
          .attr('fill', s.featureSelectFill || 'rgba(255, 196, 77, 0.34)')
          .attr('stroke', s.featureSelectStroke || 'none')
          .attr('stroke-width', s.featureSelectStrokeWidth ?? s.strokeWidth ?? 1)
          .attr('vector-effect', 'non-scaling-stroke')
          .attr('stroke-linejoin', 'round')
          .attr('stroke-linecap', 'round');
      }

      if (hoveredFeature) {
        g.append('path')
          .datum(hoveredFeature)
          .attr('class', 'sx-geojson-hover')
          .attr('d', path)
          .attr('fill', s.featureHoverFill || 'rgba(120, 205, 255, 0.32)')
          .attr('stroke', s.featureHoverStroke || 'none')
          .attr('stroke-width', s.featureHoverStrokeWidth ?? s.strokeWidth ?? 1)
          .attr('vector-effect', 'non-scaling-stroke')
          .attr('stroke-linejoin', 'round')
          .attr('stroke-linecap', 'round');
      }
    }

    perfAfterDraw = perfNow();
  }

  geojsonRenderStats.set(layer.id, {
    totalFeatures: allFeatures.length,
    inViewFeatures,
    renderedFeatures: features.length,
    zoomScale: zoomT.k,
    simplifyLevel: effectiveSimplifyLevel,
    minZoom: policy.minZoom,
    hiddenByZoom: false,
    partCullChecked,
    partCullApplied,
    renderedVertexCount,
    timingsMs: {
      prep: Math.max(0, perfAfterPrep - perfStart),
      cull: Math.max(0, perfAfterCull - perfCullStart),
      draw: Math.max(0, perfAfterDraw - perfAfterCull),
      total: Math.max(0, perfAfterDraw - perfStart),
    },
  });
}
