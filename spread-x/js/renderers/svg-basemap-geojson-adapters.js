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

  const showGlobe = s.showGlobe !== false;
  const oceanFill = s.oceanFill;
  const landFill = s.landFill;
  const showLandBoundaries = showGlobe && s.showLandBoundaries !== false;
  const showCountryBoundaries = showGlobe && s.showCountryBoundaries !== false;
  const landBoundaryStroke = s.landBoundaryStroke || s.landStroke || '#4a8a5a';
  const landBoundaryWidth = s.landBoundaryWidth ?? s.landStrokeWidth ?? 0.5;

  if (s.showGraticule) {
    const step = s.graticuleStep || 10;
    g.append('path')
      .datum(d3.geoGraticule().step([step, step])())
      .attr('d', path)
      .attr('fill', 'none')
      .attr('stroke', s.graticuleStroke || '#ffffff')
      .attr('stroke-width', 0.5)
      .attr('vector-effect', 'non-scaling-stroke')
      .attr('stroke-linejoin', 'round')
      .attr('stroke-linecap', 'round')
      .attr('opacity', s.graticuleOpacity ?? 0.1);
  }

  g.append('path')
    .datum({ type: 'Sphere' })
    .attr('d', path)
    .attr('fill', oceanFill)
    .attr('stroke', s.projectionBoundaryStroke || s.outlineStroke || '#4a8a5a')
    .attr('stroke-width', s.projectionBoundaryWidth ?? s.outlineStrokeWidth ?? 1)
    .attr('vector-effect', 'non-scaling-stroke')
    .attr('stroke-linejoin', 'round')
    .attr('stroke-linecap', 'round');

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

    if (land) {
      if (showGlobe) {
        g.append('path')
          .attr('class', 'land')
          .datum(land)
          .attr('d', path)
          .attr('fill-rule', 'evenodd')
          .attr('fill', landFill)
          .attr('stroke', 'none');
      }

      if (showLandBoundaries) {
        g.append('path')
          .attr('class', 'land-boundaries')
          .datum(land)
          .attr('d', path)
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
        .datum(countryMesh)
        .attr('d', path)
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
  const zoomK = currentTransform?.k || 1;
  const sourceType = s.geographicSourceType || 'raster';
  const oceanFill = s.geographicOceanFill || s.oceanFill || '#0d2f40';

  g.append('path')
    .datum({ type: 'Sphere' })
    .attr('d', path)
    .attr('fill', oceanFill)
    .attr('stroke', s.projectionBoundaryStroke || s.outlineStroke || '#4a8a5a')
    .attr('stroke-width', s.projectionBoundaryWidth ?? s.outlineStrokeWidth ?? 1)
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
    const landTopo = await fetchOutline(`ne-land-${vectorScale}`);
    if (landTopo) {
      const key = pickTopoObjectKey(landTopo, ['land']);
      if (key) {
        const land = prepareForSeamClipping(topojson.feature(landTopo, landTopo.objects[key]));
        g.append('path')
          .attr('class', 'ne-land')
          .datum(land)
          .attr('d', path)
          .attr('fill-rule', 'evenodd')
          .attr('fill', s.geographicLandFill || '#9aa876')
          .attr('stroke', 'none');
      }
    }
  }

  if (s.geographicShowCountries !== false && layer?.runtime?.showBasemapCountryPolygons === true) {
    await drawSvgGeographicCountries({
      g,
      style: s,
      runtime: layer?.runtime,
      topojson,
      path,
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

  const mesh = prepareForSeamClipping(
    topojson.mesh(countryTopo, countryTopo.objects[key], (a, b) => a !== b)
  );

  g.append('path')
    .attr('class', 'ne-countries')
    .datum(mesh)
    .attr('d', path)
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
  path,
  currentTransform,
  currentFrameRect,
  width,
  height,
  featureBounds,
  intersectsViewportAfterTransform,
  geojsonRenderPolicy,
  getSimplifiedLayerData,
  resolveGeojsonSimplifyLevel,
  prepareForSeamClipping,
  geojsonRenderStats,
} = {}) {
  if (!g || !layer?.data || !path) return;

  const s = layer.style || {};
  const resolved = getSimplifiedLayerData(layer, 0);
  if (!resolved) return;

  const rawFeatures = resolved.type === 'FeatureCollection' ? resolved.features : [resolved];
  const zoomT = currentTransform || d3.zoomIdentity;
  const simplifyLevel = resolveGeojsonSimplifyLevel?.({
    zoomScale: zoomT.k,
    featureCount: rawFeatures.length,
    style: s,
  }) ?? Math.max(0, Math.min(5, Math.round(Number(s.simplify ?? 0))));

  const simplified = simplifyLevel > 0
    ? getSimplifiedLayerData(layer, simplifyLevel)
    : resolved;
  if (!simplified) return;

  const prepared = prepareForSeamClipping(simplified);
  const allFeatures = prepared.type === 'FeatureCollection' ? prepared.features : [prepared];
  const policy = geojsonRenderPolicy(allFeatures.length, s);

  if (zoomT.k < policy.minZoom) {
    geojsonRenderStats.set(layer.id, {
      totalFeatures: allFeatures.length,
      inViewFeatures: 0,
      renderedFeatures: 0,
      zoomScale: zoomT.k,
      simplifyLevel,
      minZoom: policy.minZoom,
      maxVisibleFeatures: policy.maxVisibleFeatures,
      hiddenByZoom: true,
      capped: false,
    });
    return;
  }

  const frameRect = currentFrameRect || { x: 0, y: 0, width, height };
  const features = [];
  let inViewFeatures = 0;
  let capped = false;

  for (const feature of allFeatures) {
    const b = featureBounds(feature);
    if (!b) continue;
    if (!intersectsViewportAfterTransform(b, zoomT, frameRect)) continue;
    inViewFeatures += 1;
    features.push(feature);
    if (features.length >= policy.maxVisibleFeatures) {
      capped = true;
      break;
    }
  }

  geojsonRenderStats.set(layer.id, {
    totalFeatures: allFeatures.length,
    inViewFeatures,
    renderedFeatures: features.length,
    zoomScale: zoomT.k,
    simplifyLevel,
    minZoom: policy.minZoom,
    maxVisibleFeatures: policy.maxVisibleFeatures,
    hiddenByZoom: false,
    capped,
  });

  if (features.length > 250) {
    g.append('path')
      .datum({ type: 'FeatureCollection', features })
      .attr('d', path)
      .attr('fill', s.fill)
      .attr('fill-opacity', s.fillOpacity)
      .attr('stroke', s.stroke)
      .attr('stroke-width', s.strokeWidth)
      .attr('vector-effect', 'non-scaling-stroke')
      .attr('stroke-linejoin', 'round')
      .attr('stroke-linecap', 'round');
  } else {
    g.selectAll('path').data(features).join('path')
      .attr('d', path)
      .attr('fill', s.fill)
      .attr('fill-opacity', s.fillOpacity)
      .attr('stroke', s.stroke)
      .attr('stroke-width', s.strokeWidth)
      .attr('vector-effect', 'non-scaling-stroke')
      .attr('stroke-linejoin', 'round')
      .attr('stroke-linecap', 'round');
  }

  const hoveredId = String(layer?.runtime?.hoveredFeatureId || '').trim();
  const selectedIds = new Set((layer?.runtime?.selectedFeatureIds || []).map(id => String(id)));
  if (!hoveredId && !selectedIds.size) return;

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
