/**
 * map-renderer.js — D3-based SVG map renderer for SPREAD-X.
 *
 * Creates and manages a zoomable SVG map that renders an ordered stack
 * of geographic layers (basemap, GeoJSON overlays, points, trees).
 */

import { LAYER_TYPES, MAP_OUTLINES, FRAME_ASPECTS } from './layers.js';

/* ── Projection factory ────────────────────────────────────────────── */

/**
 * Instantiate a D3 geo projection by function name and fit it to the
 * given viewport.  Falls back to geoNaturalEarth1 if `projId` is not
 * found on the d3 namespace.
 */
function _makeProjection(d3, projId, width, height, center, rotate, frameRect) {
  const factory = d3[projId] || d3.geoNaturalEarth1;
  const proj = factory();
  // To keep the frame fixed while panning the map content, treat center
  // as an additional inverse rotation of the globe.
  const cx = Number(center?.[0] || 0);
  const cy = Number(center?.[1] || 0);
  const rx = Number(rotate?.[0] || 0);
  const ry = Number(rotate?.[1] || 0);
  const rz = Number(rotate?.[2] || 0);
  proj.rotate([rx - cx, ry - cy, rz]);
  const fitW = frameRect?.width || width;
  const fitH = frameRect?.height || height;
  proj.fitSize([fitW, fitH], { type: 'Sphere' });
  if (frameRect) {
    proj.translate([frameRect.x + frameRect.width / 2, frameRect.y + frameRect.height / 2]);
  }
  return proj;
}

/* ── Renderer ──────────────────────────────────────────────────────── */

/**
 * @param {object} opts
 * @param {SVGElement} opts.svgElement
 * @param {object} opts.d3        — the d3 module
 * @param {object} opts.topojson  — the topojson-client module
 */
export function createMapRenderer({ svgElement, d3, topojson, onZoomChange } = {}) {
  let _projection = null;
  let _path       = null;
  let _layers     = [];
  let _width      = 800;
  let _height     = 600;
  let _projId     = 'geoNaturalEarth1';
  let _spacePanActive = false;
  let _currentTransform = d3.zoomIdentity;
  let _currentFrameRect = null;
  let _projectionStamp = 0;
  let _projectionSignature = '';
  let _viewportRenderQueued = false;
  let _lastViewportRenderZoom = 1;
  let _renderInFlight = false;
  let _renderAgain = false;
  let _geojsonRenderStats = new Map();

  const _featureBoundsCache = new WeakMap();
  const _resolvedGeoDataCache = new WeakMap();
  const _geojsonLayerCache = new WeakMap();

  // Cached TopoJSON fetches (url → Promise<topo>)
  const _topoCache = {};

  // Cached basemap geometry — invalidated when projection stamp changes
  // or when the underlying topology resolves for the first time.
  let _basemapCache = null; // { stamp, projId, land, countryMesh }

  const svg  = d3.select(svgElement);
  const gFrameBackground = svg.append('g').attr('class', 'map-frame-background');
  const gFrameClipRoot = svg.append('g').attr('class', 'map-frame-clip-root');
  const gMap = gFrameClipRoot.append('g').attr('class', 'map-root');
  const gOverlay = svg.append('g').attr('class', 'map-overlay-root');
  const clipBaseId = `${(svgElement.id || 'sx-map').replace(/[^A-Za-z0-9_-]/g, '')}-clip`;
  const frameClipId = `${clipBaseId}-frame`;
  const sphereClipId = `${clipBaseId}-sphere`;
  const defs = svg.select('defs').empty() ? svg.append('defs') : svg.select('defs');
  const frameClipPath = defs.select(`#${frameClipId}`).empty()
    ? defs.append('clipPath').attr('id', frameClipId).attr('clipPathUnits', 'userSpaceOnUse')
    : defs.select(`#${frameClipId}`);
  const frameClipShape = frameClipPath.select('path').empty()
    ? frameClipPath.append('path').attr('clip-rule', 'evenodd')
    : frameClipPath.select('path').attr('clip-rule', 'evenodd');
  const sphereClipPath = defs.select(`#${sphereClipId}`).empty()
    ? defs.append('clipPath').attr('id', sphereClipId).attr('clipPathUnits', 'userSpaceOnUse')
    : defs.select(`#${sphereClipId}`);
  const sphereClipShape = sphereClipPath.select('path').empty()
    ? sphereClipPath.append('path').attr('clip-rule', 'evenodd')
    : sphereClipPath.select('path').attr('clip-rule', 'evenodd');

  // Zoom behaviour
  let _suppressZoomCallback = false;
  const zoom = d3.zoom()
    .filter(event => {
      if (_spacePanActive && (event.type === 'mousedown' || event.type === 'touchstart')) return false;
      const modifierHeld = !!event.altKey;
      return (!modifierHeld || event.type === 'wheel') && !event.button;
    })
    .scaleExtent([0.5, 30])
    .on('zoom', ({ transform }) => {
      _currentTransform = transform;
      gMap.attr('transform', transform);
      if (!_suppressZoomCallback) onZoomChange?.(transform);
      if (_hasLargeGeoJSONLayer() && Math.abs(transform.k - _lastViewportRenderZoom) >= 0.5) {
        _lastViewportRenderZoom = transform.k;
        _queueViewportRender();
      }
    })
    .on('end', ({ transform }) => {
      if (!_suppressZoomCallback) onZoomChange?.(transform);
      if (_hasLargeGeoJSONLayer()) {
        _lastViewportRenderZoom = _currentTransform?.k || _lastViewportRenderZoom;
        _queueViewportRender();
      }
    });
  svg.call(zoom);

  /* ── public API ──────────────────────────────────────────────────── */

  function resize(w, h) {
    _width = w; _height = h;
    svg.attr('viewBox', `0 0 ${w} ${h}`);
  }

  function setLayers(layers) { _layers = layers; }

  async function _renderNow() {
    gFrameBackground.selectAll('*').remove();
    gMap.selectAll('*').remove();
    gOverlay.selectAll('*').remove();
    _geojsonRenderStats = new Map();

    // Resolve projection from base-map layer (or fallback)
    const base = _layers.find(l => l.type === LAYER_TYPES.BASEMAP);
    const frameLayer = _layers.find(l => l.type === LAYER_TYPES.FRAME);
    const frameRect = _computeFrameRect(_width, _height, frameLayer?.style);
    _currentFrameRect = frameRect;
    const baseMode = base?.style?.baseMode || 'globe';
    const projId = baseMode === 'geographic'
      ? 'geoEquirectangular'
      : (base?.style.projection || 'geoNaturalEarth1');
    const center = base?.style.center  || [0, 0];
    const rotate = base?.style.rotate  || [0, 0, 0];
    const signature = JSON.stringify({ projId, center, rotate, frameRect, width: _width, height: _height });
    if (signature !== _projectionSignature) {
      _projectionSignature = signature;
      _projectionStamp += 1;
    }
    _projId = projId;
    _projection = _makeProjection(d3, projId, _width, _height, center, rotate, frameRect);
    _path = d3.geoPath(_projection);

    // First clip map contents to the figure boundary.
    frameClipShape.attr('d', _rectPath(frameRect));
    gFrameClipRoot.attr('clip-path', `url(#${frameClipId})`);

    // Then clip to the projected boundary so interrupted/polyhedral seams
    // don't spill into projection voids.
    const spherePath = _path({ type: 'Sphere' });
    if (spherePath) {
      sphereClipShape.attr('d', spherePath);
      gMap.attr('clip-path', `url(#${sphereClipId})`);
    } else {
      gMap.attr('clip-path', null);
    }

    const backgroundFill = base?.style?.backgroundFill ||
      (frameLayer?.visible && frameLayer.style?.showFill ? frameLayer.style?.fill : null);
    const backgroundOpacity = Number(base?.style?.backgroundOpacity ??
      (frameLayer?.style?.fillOpacity ?? 1));

    if (backgroundFill) {
      gFrameBackground.append('path')
        .attr('class', 'layer layer-frame-fill')
        .attr('d', _rectPath(frameRect))
        .attr('fill', backgroundFill)
        .attr('fill-opacity', backgroundOpacity)
        .attr('stroke', 'none')
        .attr('opacity', base?.opacity ?? 1);
    }

    for (const layer of _layers) {
      if (!layer.visible) continue;
      if (layer.type === LAYER_TYPES.FRAME) continue;
      const g = gMap.append('g')
        .attr('class', `layer layer-${layer.type}`)
        .attr('data-layer-id', layer.id)
        .attr('opacity', layer.opacity);

      switch (layer.type) {
        case LAYER_TYPES.BASEMAP: await _renderBasemap(g, layer);  break;
        case LAYER_TYPES.GEOJSON:       _renderGeoJSON(g, layer);  break;
        case LAYER_TYPES.POINTS:        _renderPoints(g, layer);   break;
        case LAYER_TYPES.TREE:          _renderTree(g, layer);     break;
      }
    }

    // Draw frame on top as a dedicated overlay layer.
    if (frameLayer?.visible) {
      gOverlay.append('path')
        .attr('class', 'layer layer-frame')
        .attr('d', _rectPath(frameRect))
        .attr('fill', 'none')
        .attr('stroke', frameLayer.style?.stroke || '#d8d8d8')
        .attr('stroke-width', frameLayer.style?.strokeWidth ?? 1.5)
        .attr('stroke-linejoin', 'round')
        .attr('stroke-linecap', 'round')
        .attr('opacity', frameLayer.opacity ?? 1);
    }
  }

  async function render() {
    if (_renderInFlight) {
      _renderAgain = true;
      return;
    }

    _renderInFlight = true;
    try {
      do {
        _renderAgain = false;
        await _renderNow();
      } while (_renderAgain);
    } finally {
      _renderInFlight = false;
    }
  }

  function resetZoom() {
    svg.transition().duration(400).call(zoom.transform, d3.zoomIdentity);
  }

  function getProjection() { return _projection; }
  function getPath()       { return _path; }
  function getGeoJSONRenderStats(layerId) { return _geojsonRenderStats.get(layerId) || null; }

  function setLayerVisibility(layerId, visible) {
    if (!layerId) return false;
    const group = gMap.selectAll('g.layer').filter(function () {
      return this.getAttribute('data-layer-id') === layerId;
    });
    if (group.empty()) return false;
    group.attr('display', visible ? null : 'none');
    return true;
  }

  function setSpacePanActive(active) {
    _spacePanActive = !!active;
  }

  /**
   * Pan the active basemap projection by a screen-space delta.
   * This updates basemap.style.center in lon/lat, constrained to valid bounds.
   */
  function panProjectionByPixels(dx, dy) {
    const base = _layers.find(l => l.type === LAYER_TYPES.BASEMAP);
    if (!base || !_projection || typeof _projection.invert !== 'function') return false;

    const zoomT = d3.zoomTransform(svg.node());
    const k = zoomT?.k || 1;
    const ndx = dx / k;
    const ndy = dy / k;

    const centerPx = [_width / 2, _height / 2];
    const geoA = _projection.invert(centerPx);
    const geoB = _projection.invert([centerPx[0] - ndx, centerPx[1] - ndy]);
    if (!geoA || !geoB) return false;

    const curCenter = base.style.center || [0, 0];
    const newLon = _wrapLongitude((curCenter[0] || 0) + (geoB[0] - geoA[0]));
    const newLat = _clampLatitude((curCenter[1] || 0) + (geoB[1] - geoA[1]));
    base.style.center = [newLon, newLat];
    return true;
  }

  /**
   * Pan longitude only (keep latitude fixed), used for Shift+Space dragging.
   */
  function panProjectionLongitudeByPixels(dx) {
    const base = _layers.find(l => l.type === LAYER_TYPES.BASEMAP);
    if (!base || !_projection || typeof _projection.invert !== 'function') return false;

    const zoomT = d3.zoomTransform(svg.node());
    const k = zoomT?.k || 1;
    const ndx = dx / k;

    const centerPx = [_width / 2, _height / 2];
    const geoA = _projection.invert(centerPx);
    const geoB = _projection.invert([centerPx[0] - ndx, centerPx[1]]);
    if (!geoA || !geoB) return false;

    const curCenter = base.style.center || [0, 0];
    const newLon = _wrapLongitude((curCenter[0] || 0) + (geoB[0] - geoA[0]));
    const keepLat = _clampLatitude(curCenter[1] || 0);
    base.style.center = [newLon, keepLat];
    return true;
  }

  /** Serialise current SVG content for export. */
  function serializeSvg() {
    const clone = svgElement.cloneNode(true);
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    clone.setAttribute('width', _width);
    clone.setAttribute('height', _height);
    return new XMLSerializer().serializeToString(clone);
  }

  /* ── layer renderers ─────────────────────────────────────────────── */

  async function _renderBasemap(g, layer) {
    const s = layer.style;
    if ((s.baseMode || 'globe') === 'geographic') {
      await _renderGeographicBasemap(g, layer);
      return;
    }

    const showGlobe = s.showGlobe !== false;
    const oceanFill = s.oceanFill;
    const landFill = s.landFill;
    const showLandBoundaries = showGlobe && s.showLandBoundaries !== false;
    const showCountryBoundaries = showGlobe && s.showCountryBoundaries !== false;
    const landBoundaryStroke = s.landBoundaryStroke || s.landStroke || '#4a8a5a';
    const landBoundaryWidth = s.landBoundaryWidth ?? s.landStrokeWidth ?? 0.5;

    // Draw reticule first so it stays below other map content.
    if (s.showGraticule) {
      const step = s.graticuleStep || 10;
      g.append('path')
        .datum(d3.geoGraticule().step([step, step])())
        .attr('d', _path)
        .attr('fill', 'none')
        .attr('stroke', s.graticuleStroke || '#ffffff')
        .attr('stroke-width', 0.5)
        .attr('vector-effect', 'non-scaling-stroke')
        .attr('stroke-linejoin', 'round')
        .attr('stroke-linecap', 'round')
        .attr('opacity', s.graticuleOpacity ?? 0.1);
    }

    // Sphere (ocean)
    g.append('path')
      .datum({ type: 'Sphere' })
      .attr('d', _path)
      .attr('fill', oceanFill)
      .attr('stroke', s.projectionBoundaryStroke || s.outlineStroke || '#4a8a5a')
      .attr('stroke-width', s.projectionBoundaryWidth ?? s.outlineStrokeWidth ?? 1)
      .attr('vector-effect', 'non-scaling-stroke')
      .attr('stroke-linejoin', 'round')
      .attr('stroke-linecap', 'round');

    // Land / boundaries
    // Use cached geometry — topojson.feature/mesh and seam-clipping are
    // expensive; only redo them when the projection changes (stamp), the
    // projection type changes (projId), or the source changes (bsrc).
    const bsrc = s.basemapSource || 'd3';
    const [landId, countriesId] = _basemapOutlineIds(bsrc);
    try {
      const [landTopo, countriesTopo] = await Promise.all([
        _fetchOutline(landId),
        _fetchOutline(countriesId),
      ]);

      if (_basemapCache?.stamp !== _projectionStamp || _basemapCache?.projId !== _projId || _basemapCache?.src !== bsrc) {
        let land = null;
        let countryMesh = null;
        if (landTopo) {
          const landKey = _pickTopoObjectKey(landTopo, ['land']);
          if (landKey) {
            land = _prepareForSeamClipping(topojson.feature(landTopo, landTopo.objects[landKey]));
          }
        }
        if (countriesTopo) {
          const countriesKey = _pickTopoObjectKey(countriesTopo, ['countries', 'country', 'admin0', 'ne_admin_0_countries']);
          if (countriesKey) {
            countryMesh = _prepareForSeamClipping(
              topojson.mesh(countriesTopo, countriesTopo.objects[countriesKey], (a, b) => a !== b)
            );
          }
        }
        _basemapCache = { stamp: _projectionStamp, projId: _projId, src: bsrc, land, countryMesh };
      }

      const { land, countryMesh } = _basemapCache;

      if (land) {
        if (showGlobe) {
          g.append('path')
            .attr('class', 'land')
            .datum(land)
            .attr('d', _path)
            .attr('fill-rule', 'evenodd')
            .attr('fill', landFill)
            .attr('stroke', 'none');
        }

        if (showLandBoundaries) {
          g.append('path')
            .attr('class', 'land-boundaries')
            .datum(land)
            .attr('d', _path)
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
          .attr('d', _path)
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

  async function _renderGeographicBasemap(g, layer) {
    const s = layer.style || {};
    const zoomK = _currentTransform?.k || 1;
    const sourceType = s.geographicSourceType || 'raster';
    const oceanFill = s.geographicOceanFill || s.oceanFill || '#0d2f40';

    g.append('path')
      .datum({ type: 'Sphere' })
      .attr('d', _path)
      .attr('fill', oceanFill)
      .attr('stroke', s.projectionBoundaryStroke || s.outlineStroke || '#4a8a5a')
      .attr('stroke-width', s.projectionBoundaryWidth ?? s.outlineStrokeWidth ?? 1)
      .attr('vector-effect', 'non-scaling-stroke')
      .attr('stroke-linejoin', 'round')
      .attr('stroke-linecap', 'round');

    if (sourceType === 'raster') {
      const rasterUrl = _chooseGeographicRasterPath(s, zoomK);
      const rect = _computeGeographicImageRect();
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
      const vectorScale = _normalizeScale(s.geographicVectorScale, '50m');
      const landTopo = await _fetchOutline(`ne-land-${vectorScale}`);
      if (landTopo) {
        const key = _pickTopoObjectKey(landTopo, ['land']);
        if (key) {
          const land = _prepareForSeamClipping(topojson.feature(landTopo, landTopo.objects[key]));
          g.append('path')
            .attr('class', 'ne-land')
            .datum(land)
            .attr('d', _path)
            .attr('fill-rule', 'evenodd')
            .attr('fill', s.geographicLandFill || '#9aa876')
            .attr('stroke', 'none');
        }
      }
    }

    if (s.geographicShowCountries !== false) {
      await _drawGeographicCountries(g, s, layer?.runtime);
    }
  }

  async function _drawGeographicCountries(g, style, runtime = null) {
    const scale = _normalizeScale(style.geographicCountryScale || style.geographicVectorScale, '50m');
    const countryTopo = await _fetchOutline(`ne-countries-${scale}`);
    if (!countryTopo) return;
    const key = _pickTopoObjectKey(countryTopo, ['countries', 'country', 'admin0', 'ne_admin_0_countries']);
    if (!key) return;

    const hoveredId = String(runtime?.hoveredCountryId || '').trim();
    const selectedIds = new Set((runtime?.selectedCountryIds || []).map(id => String(id)));

    if (hoveredId || selectedIds.size) {
      const fc = topojson.feature(countryTopo, countryTopo.objects[key]);
      const features = fc?.type === 'FeatureCollection' ? (fc.features || []) : [fc].filter(Boolean);
      const countryId = feature => {
        const p = feature?.properties || {};
        return String(
          p.ISO_A3_EH ||
          p.ADM0_A3 ||
          p.ISO_A3 ||
          p.iso_a3 ||
          p.SOV_A3 ||
          p.GU_A3 ||
          p.NAME_EN ||
          p.NAME ||
          p.ADMIN ||
          p.name ||
          feature?.id ||
          ''
        ).trim();
      };

      const selectedFeatures = features
        .filter(feature => selectedIds.has(countryId(feature)))
        .map(_prepareForSeamClipping);

      const hoveredFeature = features.find(feature => countryId(feature) === hoveredId);

      if (selectedFeatures.length) {
        g.selectAll('path.ne-country-selected')
          .data(selectedFeatures)
          .join('path')
          .attr('class', 'ne-country-selected')
          .attr('d', _path)
          .attr('fill', style.geographicCountrySelectFill || 'rgba(255, 196, 77, 0.34)')
          .attr('stroke', 'none');
      }

      if (hoveredFeature) {
        g.append('path')
          .attr('class', 'ne-country-hover')
          .datum(_prepareForSeamClipping(hoveredFeature))
          .attr('d', _path)
          .attr('fill', style.geographicCountryHoverFill || 'rgba(120, 205, 255, 0.32)')
          .attr('stroke', 'none');
      }
    }

    const mesh = _prepareForSeamClipping(
      topojson.mesh(countryTopo, countryTopo.objects[key], (a, b) => a !== b)
    );

    g.append('path')
      .attr('class', 'ne-countries')
      .datum(mesh)
      .attr('d', _path)
      .attr('fill', 'none')
      .attr('stroke', style.geographicCountryStroke || '#3e3e3e')
      .attr('stroke-width', style.geographicCountryStrokeWidth ?? 0.45)
      .attr('stroke-opacity', style.geographicCountryOpacity ?? 0.65)
      .attr('vector-effect', 'non-scaling-stroke')
      .attr('stroke-linejoin', 'round')
      .attr('stroke-linecap', 'round');
  }

  function _isOceansLayer(layer) {
    if (!layer || layer.type !== LAYER_TYPES.GEOJSON) return false;
    const n = (layer.name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    return n === 'oceans' || n === 'oceanmask';
  }

  function _renderGeoJSON(g, layer) {
    if (!layer.data) return;
    const s = layer.style;
    const simplifyLevel = Math.max(0, Math.min(5, Math.round(Number(s.simplify ?? 0))));
    const simplified = _getSimplifiedLayerData(layer, simplifyLevel);
    if (!simplified) return;
    const prepared = _prepareForSeamClipping(simplified);
    const allFeatures = prepared.type === 'FeatureCollection'
      ? prepared.features : [prepared];

    const zoomT = _currentTransform || d3.zoomTransform(svg.node()) || d3.zoomIdentity;
    const policy = _geojsonRenderPolicy(allFeatures.length, s);

    // For very large polygon sets, defer rendering until the user zooms in.
    if (zoomT.k < policy.minZoom) {
      _geojsonRenderStats.set(layer.id, {
        totalFeatures: allFeatures.length,
        inViewFeatures: 0,
        renderedFeatures: 0,
        zoomScale: zoomT.k,
        minZoom: policy.minZoom,
        maxVisibleFeatures: policy.maxVisibleFeatures,
        hiddenByZoom: true,
        capped: false,
      });
      return;
    }

    const frameRect = _currentFrameRect || { x: 0, y: 0, width: _width, height: _height };
    const features = [];
    let inViewFeatures = 0;
    let capped = false;
    for (const feature of allFeatures) {
      const b = _featureBounds(feature);
      if (!b) continue;
      if (!_intersectsViewportAfterTransform(b, zoomT, frameRect)) continue;
      inViewFeatures += 1;
      features.push(feature);
      if (features.length >= policy.maxVisibleFeatures) {
        capped = true;
        break;
      }
    }

    _geojsonRenderStats.set(layer.id, {
      totalFeatures: allFeatures.length,
      inViewFeatures,
      renderedFeatures: features.length,
      zoomScale: zoomT.k,
      minZoom: policy.minZoom,
      maxVisibleFeatures: policy.maxVisibleFeatures,
      hiddenByZoom: false,
      capped,
    });

    // For large homogeneous polygon layers, draw one merged path instead of
    // thousands of DOM nodes; this significantly lowers Safari graphics CPU.
    if (features.length > 250) {
      g.append('path')
        .datum({ type: 'FeatureCollection', features })
        .attr('d', _path)
        .attr('fill', s.fill)
        .attr('fill-opacity', s.fillOpacity)
        .attr('stroke', s.stroke)
        .attr('stroke-width', s.strokeWidth)
        .attr('vector-effect', 'non-scaling-stroke')
        .attr('stroke-linejoin', 'round')
        .attr('stroke-linecap', 'round');
      return;
    }

    g.selectAll('path').data(features).join('path')
      .attr('d', _path)
      .attr('fill', s.fill)
      .attr('fill-opacity', s.fillOpacity)
      .attr('stroke', s.stroke)
      .attr('stroke-width', s.strokeWidth)
      .attr('vector-effect', 'non-scaling-stroke')
      .attr('stroke-linejoin', 'round')
      .attr('stroke-linecap', 'round');
  }

  function _renderPoints(g, layer) {
    if (!layer.data?.length) return;
    const s = layer.style;

    const projected = layer.data.map(d => {
      const lon = d.longitude ?? d.lon ?? d.lng;
      const lat = d.latitude  ?? d.lat;
      const xy  = _projection([+lon, +lat]);
      return { ...d, _x: xy?.[0], _y: xy?.[1] };
    }).filter(d => d._x != null);

    g.selectAll('circle').data(projected).join('circle')
      .attr('cx', d => d._x)
      .attr('cy', d => d._y)
      .attr('r', s.radius)
      .attr('fill', s.fill)
      .attr('fill-opacity', s.fillOpacity)
      .attr('stroke', s.stroke)
      .attr('vector-effect', 'non-scaling-stroke')
      .attr('stroke-width', s.strokeWidth);

    if (s.labelField) {
      g.selectAll('text').data(projected.filter(d => d[s.labelField]))
        .join('text')
        .attr('x', d => d._x + s.radius + 3)
        .attr('y', d => d._y + 3)
        .attr('font-size', s.labelSize)
        .attr('fill', 'currentColor')
        .text(d => d[s.labelField]);
    }
  }

  function _renderTree(g, layer) {
    if (!layer.data) return;
    const s = layer.style;
    const { branches = [], nodes = [] } = layer.data;
    const discontinuousProjection = _isProjectionDiscontinuous(_projId);

    if (branches.length) {
      g.selectAll('path.branch').data(branches).join('path')
        .attr('class', 'branch')
        .attr('d', d => {
          if (s.branchStyle === 'greatcircle' || discontinuousProjection) {
            return _path({
              type: 'LineString',
              coordinates: [[d.startLon, d.startLat], [d.endLon, d.endLat]],
            });
          }
          const a = _projection([d.startLon, d.startLat]);
          const b = _projection([d.endLon, d.endLat]);
          return a && b ? `M${a[0]},${a[1]}L${b[0]},${b[1]}` : null;
        })
        .attr('fill', 'none')
        .attr('stroke', s.branchColor)
        .attr('stroke-width', s.branchWidth)
        .attr('vector-effect', 'non-scaling-stroke')
        .attr('stroke-linejoin', 'round')
        .attr('stroke-linecap', 'round')
        .attr('opacity', s.branchOpacity);
    }

    if (nodes.length) {
      const proj = nodes.map(d => {
        const xy = _projection([d.longitude ?? d.lon, d.latitude ?? d.lat]);
        return { ...d, _x: xy?.[0], _y: xy?.[1] };
      }).filter(d => d._x != null);

      g.selectAll('circle.node').data(proj).join('circle')
        .attr('class', 'node')
        .attr('cx', d => d._x).attr('cy', d => d._y)
        .attr('r', s.nodeRadius)
        .attr('fill', s.nodeColor)
        .attr('opacity', s.nodeOpacity);
    }
  }

  /* ── outline fetch with cache ────────────────────────────────────── */

  function _basemapOutlineIds(bsrc) {
    switch (bsrc) {
      case 'ne110': return ['ne-land-110m', 'ne-countries-110m'];
      case 'ne50':  return ['ne-land-50m',  'ne-countries-50m'];
      case 'ne10':  return ['ne-land-10m',  'ne-countries-10m'];
      default:      return ['land-110m',    'countries-110m'];
    }
  }

  function _normalizeScale(scale, fallback = '50m') {
    return scale === '10m' || scale === '50m' || scale === '110m' ? scale : fallback;
  }

  function _chooseGeographicRasterPath(style = {}, zoomK = 1) {
    const setName = String(style.geographicRasterSet || 'NE1').toUpperCase();
    const switchZoom = Number(style.geographicRasterSwitchZoom ?? 2.5);
    const forcedTier = String(style.geographicRasterForceTier || 'auto').toLowerCase();
    const useHr = forcedTier === 'hr' ? true : forcedTier === '50m' ? false : zoomK >= switchZoom;
    const base = `data/maps/NaturalEarth/${setName}`;
    const low = `${base}/${setName}_50M_SR_W/${setName}_50M_SR_W.tif`;
    const hr = `${base}/${setName}_HR_LC_SR_W_DR/${setName}_HR_LC_SR_W_DR.tif`;
    return useHr ? hr : low;
  }

  function _computeGeographicImageRect() {
    if (!_projection) return null;
    const nw = _projection([-180, 90]);
    const se = _projection([180, -90]);
    if (!nw || !se) return null;
    const x = Math.min(nw[0], se[0]);
    const y = Math.min(nw[1], se[1]);
    const width = Math.abs(se[0] - nw[0]);
    const height = Math.abs(se[1] - nw[1]);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
      return null;
    }
    return { x, y, width, height };
  }

  function _fetchOutline(outlineId) {
    if (_topoCache[outlineId]) return _topoCache[outlineId];
    const src = MAP_OUTLINES.find(o => o.id === outlineId);
    if (!src?.url) return Promise.resolve(null);
    _topoCache[outlineId] = fetch(src.url)
      .then(r => { if (!r.ok) throw new Error(r.statusText); return r.json(); });
    return _topoCache[outlineId];
  }

  function _prepareForSeamClipping(geometry) {
    const needsStitch = _isProjectionDiscontinuous(_projId) || _projId === 'geoEquirectangular';
    if (!needsStitch) return geometry;
    if (!geometry || typeof d3.geoStitch !== 'function') return geometry;
    try {
      return d3.geoStitch(geometry);
    } catch {
      return geometry;
    }
  }

  function _pickTopoObjectKey(topology, preferredNames = []) {
    const objects = topology?.objects || {};
    const keys = Object.keys(objects);
    if (!keys.length) return null;
    const preferred = preferredNames.map(name => String(name).toLowerCase());
    const direct = keys.find(k => preferred.includes(String(k).toLowerCase()));
    if (direct) return direct;
    const fuzzy = keys.find(k => preferred.some(name => String(k).toLowerCase().includes(name)));
    return fuzzy || keys[0];
  }

  function _featureBounds(feature) {
    if (!feature || !_path) return null;
    const cached = _featureBoundsCache.get(feature);
    if (cached && cached.stamp === _projectionStamp) return cached.bounds;
    try {
      const b = _path.bounds(feature);
      if (!b || !Number.isFinite(b[0]?.[0]) || !Number.isFinite(b[0]?.[1]) ||
          !Number.isFinite(b[1]?.[0]) || !Number.isFinite(b[1]?.[1])) {
        return null;
      }
      _featureBoundsCache.set(feature, { stamp: _projectionStamp, bounds: b });
      return b;
    } catch {
      return null;
    }
  }

  function _intersectsViewportAfterTransform(bounds, transform, frameRect) {
    if (!bounds || !transform || !frameRect) return false;
    const minX = bounds[0][0];
    const minY = bounds[0][1];
    const maxX = bounds[1][0];
    const maxY = bounds[1][1];

    const tMinX = transform.applyX(minX);
    const tMaxX = transform.applyX(maxX);
    const tMinY = transform.applyY(minY);
    const tMaxY = transform.applyY(maxY);

    const left = Math.min(tMinX, tMaxX);
    const right = Math.max(tMinX, tMaxX);
    const top = Math.min(tMinY, tMaxY);
    const bottom = Math.max(tMinY, tMaxY);

    const frameLeft = frameRect.x;
    const frameTop = frameRect.y;
    const frameRight = frameRect.x + frameRect.width;
    const frameBottom = frameRect.y + frameRect.height;

    return right >= frameLeft && left <= frameRight && bottom >= frameTop && top <= frameBottom;
  }

  function _geojsonRenderPolicy(featureCount, style = {}) {
    const auto = style.autoPerf !== false;
    if (auto) return _autoGeojsonRenderPolicy(featureCount);
    const minZoom = Math.max(1, Math.min(12, Number(style.minZoom) || 1));
    const maxVisibleFeatures = Math.max(100, Math.min(20000, Math.round(Number(style.maxVisible) || 2000)));
    return { minZoom, maxVisibleFeatures };
  }

  function _autoGeojsonRenderPolicy(featureCount) {
    if (featureCount > 8000) return { minZoom: 5, maxVisibleFeatures: 900 };
    if (featureCount > 4000) return { minZoom: 4, maxVisibleFeatures: 1200 };
    if (featureCount > 2000) return { minZoom: 3, maxVisibleFeatures: 1600 };
    if (featureCount > 800) return { minZoom: 2, maxVisibleFeatures: 2000 };
    if (featureCount > 300) return { minZoom: 1.5, maxVisibleFeatures: 2600 };
    return { minZoom: 1, maxVisibleFeatures: 4000 };
  }

  function _hasLargeGeoJSONLayer() {
    return _layers.some(layer => {
      if (!layer.visible || layer.type !== LAYER_TYPES.GEOJSON || !layer.data) return false;
      const resolved = _resolveLayerGeoJSON(layer);
      return _countGeoJSONFeatures(resolved) > 300;
    });
  }

  function _countGeoJSONFeatures(data) {
    if (!data) return 0;
    if (data.type === 'FeatureCollection') return data.features?.length || 0;
    if (data.type === 'Feature') return 1;
    return 1;
  }

  function _getSimplifiedLayerData(layer, simplifyLevel) {
    const resolved = _resolveLayerGeoJSON(layer);
    if (!resolved || simplifyLevel <= 0) return resolved;
    let cache = _geojsonLayerCache.get(layer);
    if (!cache || cache.sourceRef !== resolved || cache.simplifyLevel !== simplifyLevel) {
      cache = {
        sourceRef: resolved,
        simplifyLevel,
        simplified: _simplifyGeoJSON(resolved, simplifyLevel),
      };
      _geojsonLayerCache.set(layer, cache);
    }
    return cache.simplified;
  }

  function _resolveLayerGeoJSON(layer) {
    const data = layer?.data;
    if (!data) return null;

    if (data._sxFormat !== 'topojson-object') {
      return data;
    }

    let cached = _resolvedGeoDataCache.get(layer);
    if (cached && cached.sourceRef === data) return cached.resolved;

    const topology = data.topology;
    if (!topology || topology.type !== 'Topology') return null;
    const keys = Object.keys(topology.objects || {});
    const key = data.objectName && topology.objects?.[data.objectName]
      ? data.objectName
      : keys[0];
    if (!key) return null;

    const resolved = topojson.feature(topology, topology.objects[key]);
    _resolvedGeoDataCache.set(layer, { sourceRef: data, resolved });
    return resolved;
  }

  function _simplifyGeoJSON(data, simplifyLevel) {
    if (!data || simplifyLevel <= 0) return data;
    if (data.type === 'FeatureCollection') {
      return {
        ...data,
        features: (data.features || []).map(f => _simplifyFeature(f, simplifyLevel)),
      };
    }
    if (data.type === 'Feature') return _simplifyFeature(data, simplifyLevel);
    return { type: data.type, coordinates: _simplifyGeometryCoordinates(data.type, data.coordinates, simplifyLevel) };
  }

  function _simplifyFeature(feature, simplifyLevel) {
    if (!feature?.geometry) return feature;
    return {
      ...feature,
      geometry: {
        ...feature.geometry,
        coordinates: _simplifyGeometryCoordinates(feature.geometry.type, feature.geometry.coordinates, simplifyLevel),
      },
    };
  }

  function _simplifyGeometryCoordinates(type, coordinates, simplifyLevel) {
    if (!coordinates) return coordinates;
    const stride = simplifyLevel + 1;
    switch (type) {
      case 'LineString':
        return _decimateLine(coordinates, stride, false);
      case 'MultiLineString':
        return coordinates.map(line => _decimateLine(line, stride, false));
      case 'Polygon':
        return coordinates.map(ring => _decimateLine(ring, stride, true));
      case 'MultiPolygon':
        return coordinates.map(poly => poly.map(ring => _decimateLine(ring, stride, true)));
      default:
        return coordinates;
    }
  }

  function _decimateLine(coords, stride, closed) {
    if (!Array.isArray(coords)) return coords;
    const minPoints = closed ? 4 : 2;
    if (coords.length <= minPoints || stride <= 1) return coords;

    const out = [];
    for (let i = 0; i < coords.length; i++) {
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

  function _queueViewportRender() {
    if (_viewportRenderQueued) return;
    _viewportRenderQueued = true;
    requestAnimationFrame(() => {
      _viewportRenderQueued = false;
      // Skip render if SVG element is hidden (inactive renderer)
      if (svgElement.style.display !== 'none') render();
    });
  }

  function getZoomTransform() { return _currentTransform; }

  /** Programmatically set zoom without firing onZoomChange. */
  function syncZoomTransform(transform) {
    _suppressZoomCallback = true;
    _currentTransform = transform;
    gMap.attr('transform', transform);
    zoom.transform(svg, transform);
    _suppressZoomCallback = false;
  }

  /* ── return public interface ─────────────────────────────────────── */

  return {
    resize,
    setLayers,
    render,
    resetZoom,
    getProjection,
    getPath,
    getGeoJSONRenderStats,
    setLayerVisibility,
    serializeSvg,
    setSpacePanActive,
    panProjectionByPixels,
    panProjectionLongitudeByPixels,
    getZoomTransform,
    syncZoomTransform,
  };
}
function _wrapLongitude(lon) {
  if (!Number.isFinite(lon)) return 0;
  let x = ((lon + 180) % 360 + 360) % 360 - 180;
  if (x === -180) x = 180;
  return x;
}

function _clampLatitude(lat) {
  if (!Number.isFinite(lat)) return 0;
  return Math.max(-89.999, Math.min(89.999, lat));
}

function _isProjectionDiscontinuous(projId) {
  if (!projId) return false;
  return projId.startsWith('geoInterrupted') ||
    projId.startsWith('geoPolyhedral') ||
    projId === 'geoGringortenQuincuncial' ||
    projId === 'geoPeirceQuincuncial';
}

function _rectPath(r) {
  return `M${r.x},${r.y}H${r.x + r.width}V${r.y + r.height}H${r.x}Z`;
}

function _computeFrameRect(width, height, frameStyle) {
  const preset = frameStyle?.aspectPreset || 'slideWide';
  const ratio = FRAME_ASPECTS[preset]?.ratio || (16 / 9);
  const margin = Math.max(0, Number(frameStyle?.margin ?? 24));

  const availW = Math.max(1, width - (2 * margin));
  const availH = Math.max(1, height - (2 * margin));

  let w = availW;
  let h = w / ratio;
  if (h > availH) {
    h = availH;
    w = h * ratio;
  }

  return {
    x: (width - w) / 2,
    y: (height - h) / 2,
    width: w,
    height: h,
  };
}
