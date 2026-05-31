import { countryFeatureId } from '../core/renderer-basemap-utils.js';

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

export async function drawCanvasBasemapLayer({
  ctx,
  layer,
  zoomK,
  d3,
  topojson,
  projection,
  currentTransform,
  projectionStamp,
  projId,
  basemapCache,
  setBasemapCache,
  graticuleCache,
  setGraticuleCache,
  fetchOutline,
  prepareForSeamClipping,
  basemapOutlineIds,
  chooseGeographicRasterPath,
  computeGeographicImageRect,
  normalizeScale,
  pickTopoObjectKey,
  loadRasterImage,
  fillPathEvenOdd,
} = {}) {
  if (!ctx || !layer || !projection) return;

  const s = layer.style || {};
  const k = zoomK || 1;
  if ((s.baseMode || 'globe') === 'geographic') {
    await drawCanvasGeographicBasemapLayer({
      ctx,
      style: s,
      layer,
      k,
      topojson,
      projection,
      currentTransform,
      fetchOutline,
      prepareForSeamClipping,
      chooseGeographicRasterPath,
      computeGeographicImageRect,
      normalizeScale,
      pickTopoObjectKey,
      loadRasterImage,
      fillPathEvenOdd,
      d3,
    });
    return;
  }

  const showGlobe = s.showGlobe !== false;
  const showLandBoundaries = showGlobe && s.showLandBoundaries !== false;
  const showCountryBoundaries = showGlobe && s.showCountryBoundaries !== false;
  const oceanFill = s.oceanFill;
  const landFill = s.landFill;
  const landStroke = s.landBoundaryStroke || s.landStroke || '#4a8a5a';
  const landWidth = (s.landBoundaryWidth ?? s.landStrokeWidth ?? 0.5) / k;
  const outlineStroke = s.projectionBoundaryStroke || s.outlineStroke || '#4a8a5a';
  const outlineWidth = (s.projectionBoundaryWidth ?? s.outlineStrokeWidth ?? 1) / k;
  const ctxPath = d3.geoPath(projection, ctx);

  if (s.showGraticule) {
    const step = s.graticuleStep || 10;
    let gCache = graticuleCache;
    if (!gCache || gCache.step !== step) {
      gCache = { step, graticule: d3.geoGraticule().step([step, step])() };
      setGraticuleCache(gCache);
    }
    ctx.save();
    ctx.beginPath();
    ctxPath(gCache.graticule);
    ctx.strokeStyle = s.graticuleStroke || '#ffffff';
    ctx.lineWidth = 0.5 / k;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.globalAlpha *= (s.graticuleOpacity ?? 0.1);
    ctx.stroke();
    ctx.restore();
  }

  ctx.save();
  ctx.beginPath();
  ctxPath({ type: 'Sphere' });
  if (oceanFill) {
    ctx.fillStyle = oceanFill;
    ctx.fill();
  }
  ctx.strokeStyle = outlineStroke;
  ctx.lineWidth = outlineWidth;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.stroke();
  ctx.restore();

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
      cache = { stamp: projectionStamp, projId, src: bsrc, land, countryMesh };
      setBasemapCache(cache);
    }

    const { land, countryMesh } = cache || {};

    if (land && showGlobe) {
      ctx.save();
      ctx.beginPath();
      ctxPath(land);
      ctx.fillStyle = landFill;
      fillPathEvenOdd(ctx);
      ctx.restore();
    }

    if (land && showLandBoundaries) {
      ctx.save();
      ctx.beginPath();
      ctxPath(land);
      ctx.strokeStyle = landStroke;
      ctx.lineWidth = landWidth;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.stroke();
      ctx.restore();
    }

    if (showCountryBoundaries && countryMesh) {
      ctx.save();
      ctx.beginPath();
      ctxPath(countryMesh);
      ctx.strokeStyle = landStroke;
      ctx.lineWidth = landWidth;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.stroke();
      ctx.restore();
    }
  } catch (err) {
    console.warn('Failed to load basemap topology:', err);
  }
}

export async function drawCanvasGeographicBasemapLayer({
  ctx,
  style,
  layer,
  k,
  d3,
  topojson,
  projection,
  currentTransform,
  fetchOutline,
  prepareForSeamClipping,
  chooseGeographicRasterPath,
  computeGeographicImageRect,
  normalizeScale,
  pickTopoObjectKey,
  loadRasterImage,
  fillPathEvenOdd,
} = {}) {
  if (!ctx || !style || !projection) return;

  const sourceType = style.geographicSourceType || 'raster';
  const oceanFill = style.geographicOceanFill || style.oceanFill || '#0d2f40';
  const ctxPath = d3.geoPath(projection, ctx);

  ctx.save();
  ctx.beginPath();
  ctxPath({ type: 'Sphere' });
  ctx.fillStyle = oceanFill;
  ctx.fill();
  ctx.strokeStyle = style.projectionBoundaryStroke || style.outlineStroke || '#4a8a5a';
  ctx.lineWidth = (style.projectionBoundaryWidth ?? style.outlineStrokeWidth ?? 1) / k;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.stroke();
  ctx.restore();

  if (sourceType === 'raster') {
    const rasterUrl = chooseGeographicRasterPath(style, currentTransform?.k || 1);
    const rect = computeGeographicImageRect();
    if (rasterUrl && rect) {
      const img = await loadRasterImage(rasterUrl);
      if (img) {
        ctx.save();
        ctx.globalAlpha *= 1;
        ctx.drawImage(img, rect.x, rect.y, rect.width, rect.height);
        ctx.restore();
      }
    }
  } else {
    const scale = normalizeScale(style.geographicVectorScale, '50m');
    const landTopo = await fetchOutline(`ne-land-${scale}`);
    if (landTopo) {
      const key = pickTopoObjectKey(landTopo, ['land']);
      if (key) {
        const land = prepareForSeamClipping(topojson.feature(landTopo, landTopo.objects[key]));
        ctx.save();
        ctx.beginPath();
        ctxPath(land);
        ctx.fillStyle = style.geographicLandFill || '#9aa876';
        fillPathEvenOdd(ctx);
        ctx.restore();
      }
    }
  }

  if (style.geographicShowCountries !== false && layer?.runtime?.showBasemapCountryPolygons === true) {
    const scale = normalizeScale(style.geographicCountryScale || style.geographicVectorScale, '50m');
    const countriesTopo = await fetchOutline(`ne-countries-${scale}`);
    if (countriesTopo) {
      const key = pickTopoObjectKey(countriesTopo, ['countries', 'country', 'admin0', 'ne_admin_0_countries']);
      if (key) {
        const hoveredId = String(layer?.runtime?.hoveredFeatureId || layer?.runtime?.hoveredCountryId || '').trim();
        const selectedIds = new Set((layer?.runtime?.selectedFeatureIds || layer?.runtime?.selectedCountryIds || []).map(id => String(id)));
        if (hoveredId || selectedIds.size) {
          const fc = topojson.feature(countriesTopo, countriesTopo.objects[key]);
          const features = fc?.type === 'FeatureCollection' ? (fc.features || []) : [fc].filter(Boolean);

          for (const feature of features) {
            const id = countryFeatureId(feature);
            if (!selectedIds.has(id) && id !== hoveredId) continue;
            ctx.save();
            ctx.beginPath();
            ctxPath(prepareForSeamClipping(feature));
            ctx.fillStyle = id === hoveredId
              ? (style.geographicCountryHoverFill || 'rgba(120, 205, 255, 0.32)')
              : (style.geographicCountrySelectFill || 'rgba(255, 196, 77, 0.34)');
            fillPathEvenOdd(ctx);
            ctx.restore();
          }
        }

        const mesh = prepareForSeamClipping(
          topojson.mesh(countriesTopo, countriesTopo.objects[key], (a, b) => a !== b)
        );
        ctx.save();
        ctx.beginPath();
        ctxPath(mesh);
        ctx.strokeStyle = style.geographicCountryStroke || '#3e3e3e';
        ctx.lineWidth = (style.geographicCountryStrokeWidth ?? 0.45) / k;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.globalAlpha *= (style.geographicCountryOpacity ?? 0.65);
        ctx.stroke();
        ctx.restore();
      }
    }
  }
}

export function drawCanvasGeoJsonLayer({
  ctx,
  layer,
  k,
  d3,
  projection,
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
  if (!ctx || !layer?.data || !projection) return;

  const perfNow = () => ((typeof performance !== 'undefined' && typeof performance.now === 'function')
    ? performance.now()
    : Date.now());
  const perfStart = perfNow();

  const s = layer.style || {};
  const resolved = getSimplifiedLayerData(layer, 0);
  if (!resolved) return;

  const rawFeatures = resolved.type === 'FeatureCollection' ? resolved.features : [resolved];
  const zoomK = currentTransform?.k || 1;
  const simplifyLevel = resolveGeojsonSimplifyLevel?.({
    zoomScale: zoomK,
    featureCount: rawFeatures.length,
    style: s,
  }) ?? Math.max(0, Math.min(5, Math.round(Number(s.simplify ?? 0))));

  const prepared = getPreparedLayerData
    ? getPreparedLayerData(layer, simplifyLevel)
    : prepareForSeamClipping(simplifyLevel > 0 ? getSimplifiedLayerData(layer, simplifyLevel) : resolved);
  if (!prepared) return;
  const allFeatures = prepared.type === 'FeatureCollection' ? prepared.features : [prepared];
  const perfAfterPrep = perfNow();

  const policy = geojsonRenderPolicy(allFeatures.length, s);
  if (currentTransform.k < policy.minZoom) {
    const perfEnd = perfNow();
    geojsonRenderStats.set(layer.id, {
      totalFeatures: allFeatures.length,
      inViewFeatures: 0,
      renderedFeatures: 0,
      zoomScale: zoomK,
      simplifyLevel,
      minZoom: policy.minZoom,
      maxVisibleFeatures: policy.maxVisibleFeatures,
      hiddenByZoom: true,
      capped: false,
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

  const frameRect = currentFrameRect || { x: 0, y: 0, width, height };
  const features = [];
  let renderedVertexCount = 0;
  let inViewFeatures = 0;
  let capped = false;
  const perfCullStart = perfNow();
  for (const feature of allFeatures) {
    const b = featureBounds(feature);
    if (!b) continue;
    if (!intersectsViewportAfterTransform(b, currentTransform, frameRect)) continue;
    inViewFeatures += 1;
    features.push(feature);
    renderedVertexCount += _countFeatureVertices(feature);
    if (features.length >= policy.maxVisibleFeatures) {
      capped = true;
      break;
    }
  }
  const perfAfterCull = perfNow();

  let perfAfterDraw = perfAfterCull;
  if (features.length) {
    const perfDrawStart = perfNow();

    const ctxPath = d3.geoPath(projection, ctx);
    const fc = { type: 'FeatureCollection', features };

    if (s.fill && s.fill !== 'none') {
      ctx.save();
      ctx.beginPath();
      ctxPath(fc);
      ctx.fillStyle = s.fill;
      ctx.globalAlpha *= (s.fillOpacity ?? 1);
      ctx.fill();
      ctx.restore();
    }

    if (s.stroke && s.stroke !== 'none' && s.strokeWidth > 0) {
      ctx.save();
      ctx.beginPath();
      ctxPath(fc);
      ctx.strokeStyle = s.stroke;
      ctx.lineWidth = s.strokeWidth / k;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.stroke();
      ctx.restore();
    }

    const hoveredId = String(layer?.runtime?.hoveredFeatureId || '').trim();
    const selectedIds = new Set((layer?.runtime?.selectedFeatureIds || []).map(id => String(id)));
    if (hoveredId || selectedIds.size) {
      for (const [idx, feature] of features.entries()) {
        const id = geojsonFeatureRuntimeId(feature, idx);
        if (!selectedIds.has(id) && id !== hoveredId) continue;
        ctx.save();
        ctx.beginPath();
        ctxPath(feature);
        ctx.fillStyle = id === hoveredId
          ? (s.featureHoverFill || 'rgba(120, 205, 255, 0.32)')
          : (s.featureSelectFill || 'rgba(255, 196, 77, 0.34)');
        ctx.fill();

        const stroke = id === hoveredId
          ? (s.featureHoverStroke || 'none')
          : (s.featureSelectStroke || 'none');
        if (stroke && stroke !== 'none') {
          ctx.strokeStyle = stroke;
          const strokeWidth = id === hoveredId
            ? (s.featureHoverStrokeWidth ?? s.strokeWidth ?? 1)
            : (s.featureSelectStrokeWidth ?? s.strokeWidth ?? 1);
          ctx.lineWidth = strokeWidth / k;
          ctx.lineJoin = 'round';
          ctx.lineCap = 'round';
          ctx.stroke();
        }

        ctx.restore();
      }
    }

    perfAfterDraw = perfNow();
  }

  geojsonRenderStats.set(layer.id, {
    totalFeatures: allFeatures.length,
    inViewFeatures,
    renderedFeatures: features.length,
    zoomScale: zoomK,
    simplifyLevel,
    minZoom: policy.minZoom,
    maxVisibleFeatures: policy.maxVisibleFeatures,
    hiddenByZoom: false,
    capped,
    renderedVertexCount,
    timingsMs: {
      prep: Math.max(0, perfAfterPrep - perfStart),
      cull: Math.max(0, perfAfterCull - perfCullStart),
      draw: Math.max(0, perfAfterDraw - perfAfterCull),
      total: Math.max(0, perfAfterDraw - perfStart),
    },
  });
}
