/**
 * map-renderer.js — D3-based SVG map renderer for SPREAD-X.
 *
 * Creates and manages a zoomable SVG map that renders an ordered stack
 * of geographic layers (basemap, GeoJSON overlays, points, trees).
 */

import { LAYER_TYPES, MAP_OUTLINES } from './layers.js';
import { computeFrameRect } from './core/frame-geometry.js';
import { pickTopoObjectKey } from './core/topology-utils.js';
import {
  countGeoJSONFeatures as _countGeoJSONFeaturesShared,
  geojsonRenderPolicy as _geojsonRenderPolicyShared,
  getSimplifiedLayerData as _getSimplifiedLayerDataShared,
  resolveGeojsonSimplifyLevel as _resolveGeojsonSimplifyLevelShared,
  resolveLayerGeoJSON as _resolveLayerGeoJSONShared,
} from './core/geojson-layer-utils.js';
import {
  basemapOutlineIds as _basemapOutlineIds,
  chooseGeographicRasterPath as _chooseGeographicRasterPath,
  clampLatitude as _clampLatitude,
  computeGeographicImageRect as _computeGeographicImageRectForProjection,
  makeProjection as _makeProjection,
  normalizeNaturalEarthScale as _normalizeScale,
  prepareForSeamClipping as _prepareForSeamClippingRaw,
  wrapLongitude as _wrapLongitude,
} from './core/renderer-basemap-utils.js';
import { createMutableCacheState, createTopologyOutlineFetcher } from './core/renderer-cache-services.js';
import { renderSvgBasemapLayer, renderSvgGeoJsonLayer } from './renderers/svg-basemap-geojson-adapters.js';
import { renderSvgPointsLayer, renderSvgTreeLayer } from './renderers/svg-layer-adapters.js';

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

  const _outlineFetcher = createTopologyOutlineFetcher({ mapOutlines: MAP_OUTLINES, fetchImpl: fetch });
  const _cacheState = createMutableCacheState({ basemapCache: null });

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
    .scaleExtent([0.5, 200])
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
    const frameRect = computeFrameRect(_width, _height, frameLayer?.style);
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
    await renderSvgBasemapLayer({
      g,
      layer,
      d3,
      topojson,
      path: _path,
      currentTransform: _currentTransform,
      projectionStamp: _projectionStamp,
      projId: _projId,
      basemapCache: _cacheState.get('basemapCache'),
      setBasemapCache: cache => { _cacheState.set('basemapCache', cache); },
      fetchOutline: _fetchOutline,
      prepareForSeamClipping: _prepareForSeamClipping,
      basemapOutlineIds: _basemapOutlineIds,
      chooseGeographicRasterPath: _chooseGeographicRasterPath,
      computeGeographicImageRect: _computeGeographicImageRect,
      normalizeScale: _normalizeScale,
      pickTopoObjectKey,
    });
  }

  function _isOceansLayer(layer) {
    if (!layer || layer.type !== LAYER_TYPES.GEOJSON) return false;
    const n = (layer.name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    return n === 'oceans' || n === 'oceanmask';
  }

  function _renderGeoJSON(g, layer) {
    renderSvgGeoJsonLayer({
      g,
      layer,
      d3,
      path: _path,
      currentTransform: _currentTransform || d3.zoomTransform(svg.node()) || d3.zoomIdentity,
      currentFrameRect: _currentFrameRect,
      width: _width,
      height: _height,
      featureBounds: _featureBounds,
      intersectsViewportAfterTransform: _intersectsViewportAfterTransform,
      geojsonRenderPolicy: _geojsonRenderPolicy,
      getSimplifiedLayerData: _getSimplifiedLayerData,
      resolveGeojsonSimplifyLevel: _resolveGeojsonSimplifyLevel,
      prepareForSeamClipping: _prepareForSeamClipping,
      geojsonRenderStats: _geojsonRenderStats,
    });
  }

  function _renderPoints(g, layer) {
    renderSvgPointsLayer({ g, layer, projection: _projection });
  }

  function _renderTree(g, layer) {
    renderSvgTreeLayer({
      g,
      layer,
      projection: _projection,
      path: _path,
      projId: _projId,
    });
  }

  /* ── outline fetch with cache ────────────────────────────────────── */

  function _computeGeographicImageRect() {
    return _computeGeographicImageRectForProjection(_projection);
  }

  function _fetchOutline(outlineId) {
    return _outlineFetcher.fetchOutline(outlineId);
  }

  function _prepareForSeamClipping(geometry) {
    return _prepareForSeamClippingRaw(geometry, { d3, projId: _projId });
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
    return _geojsonRenderPolicyShared(featureCount, style);
  }

  function _resolveGeojsonSimplifyLevel(args) {
    return _resolveGeojsonSimplifyLevelShared(args);
  }

  function _hasLargeGeoJSONLayer() {
    return _layers.some(layer => {
      if (!layer.visible || layer.type !== LAYER_TYPES.GEOJSON || !layer.data) return false;
      const resolved = _resolveLayerGeoJSON(layer);
      return _countGeoJSONFeatures(resolved) > 300;
    });
  }

  function _countGeoJSONFeatures(data) {
    return _countGeoJSONFeaturesShared(data);
  }

  function _getSimplifiedLayerData(layer, simplifyLevel) {
    return _getSimplifiedLayerDataShared(layer, simplifyLevel, {
      topojson,
      resolvedCache: _resolvedGeoDataCache,
      layerCache: _geojsonLayerCache,
    });
  }

  function _resolveLayerGeoJSON(layer) {
    return _resolveLayerGeoJSONShared(layer, {
      topojson,
      resolvedCache: _resolvedGeoDataCache,
    });
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

function _rectPath(r) {
  return `M${r.x},${r.y}H${r.x + r.width}V${r.y + r.height}H${r.x}Z`;
}
