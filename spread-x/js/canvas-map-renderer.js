/**
 * canvas-map-renderer.js — Canvas 2D map renderer for SPREAD-X.
 *
 * Mirrors the public API of map-renderer.js (createMapRenderer) but
 * draws via the Canvas 2D API instead of SVG DOM nodes, eliminating
 * the DOM-rebuild cost that causes lag when panning/zooming at world
 * scale with large GeoJSON layers.
 *
 * The zoom/pan transform is applied directly to the Canvas 2D context
 * so the projection coordinates never change between frames.  Stroke
 * widths are divided by the zoom scale k to preserve pixel-space line
 * widths (equivalent to SVG vector-effect: non-scaling-stroke).
 *
 * At high zoom levels (k >= CANVAS_TO_SVG_THRESHOLD) the host should
 * switch to the SVG renderer where fewer features are in view and SVG
 * quality / interactivity advantages matter.
 */

import { LAYER_TYPES, MAP_OUTLINES } from './layers.js';
import { computeFrameRect } from './core/frame-geometry.js';
import { pickTopoObjectKey } from './core/topology-utils.js';
import {
  geojsonRenderPolicy as _geojsonRenderPolicyShared,
  getSimplifiedLayerData as _getSimplifiedLayerDataShared,
  resolveGeojsonSimplifyLevel as _resolveGeojsonSimplifyLevelShared,
  resolveLayerGeoJSON as _resolveLayerGeoJSONShared,
} from './core/geojson-layer-utils.js';
import {
  basemapOutlineIds as _sharedBasemapOutlineIds,
  chooseGeographicRasterPath as _sharedChooseGeographicRasterPath,
  clampLatitude as _sharedClampLatitude,
  computeGeographicImageRect as _sharedComputeGeographicImageRect,
  fillPathEvenOdd as _sharedFillPathEvenOdd,
  isProjectionDiscontinuous as _sharedIsProjectionDiscontinuous,
  makeProjection as _makeProjection,
  normalizeNaturalEarthScale as _sharedNormalizeScale,
  prepareForSeamClipping as _sharedPrepareForSeamClipping,
  wrapLongitude as _sharedWrapLongitude,
} from './core/renderer-basemap-utils.js';
import {
  createMutableCacheState,
  createRasterImageLoader,
  createTopologyOutlineFetcher,
} from './core/renderer-cache-services.js';
import { drawCanvasBasemapLayer, drawCanvasGeoJsonLayer } from './renderers/canvas-basemap-geojson-adapters.js';
import { drawCanvasPointsLayer, drawCanvasTreeLayer } from './renderers/canvas-layer-adapters.js';

/** Zoom scale at which to hand off rendering to the SVG renderer. */
export const CANVAS_TO_SVG_THRESHOLD = 8;

/* ── Renderer ─────────────────────────────────────────────────────── */

/**
 * @param {object} opts
 * @param {HTMLCanvasElement} opts.canvasElement
 * @param {object} opts.d3
 * @param {object} opts.topojson
 */
export function createCanvasMapRenderer({ canvasElement, d3, topojson, onZoomChange } = {}) {
  let _projection      = null;
  let _pathForBounds   = null; // geoPath without ctx — used for bounds only
  let _layers          = [];
  let _width           = 800;
  let _height          = 600;
  let _projId          = 'geoNaturalEarth1';
  let _spacePanActive  = false;
  let _currentTransform = d3.zoomIdentity;
  let _currentFrameRect = null;
  let _projectionStamp = 0;
  let _projectionSignature = '';
  let _animFrameQueued = false;
  let _renderInFlight  = false;
  let _renderAgain     = false;
  let _geojsonRenderStats = new Map();

  const _featureBoundsCache  = new WeakMap();
  const _resolvedGeoDataCache = new WeakMap();
  const _geojsonLayerCache   = new WeakMap();
  const _outlineFetcher = createTopologyOutlineFetcher({ mapOutlines: MAP_OUTLINES, fetchImpl: fetch });
  const _rasterLoader = createRasterImageLoader();
  const _cacheState = createMutableCacheState({
    basemapCache: null,
    graticuleCache: null,
  });

  /* ── D3 zoom ──────────────────────────────────────────────────── */

  let _suppressZoomCallback = false;
  const canvasSel = d3.select(canvasElement);
  const zoom = d3.zoom()
    .filter(event => {
      if (_spacePanActive && (event.type === 'mousedown' || event.type === 'touchstart')) return false;
      const modifierHeld = !!event.altKey;
      return (!modifierHeld || event.type === 'wheel') && !event.button;
    })
    .scaleExtent([0.5, 200])
    .on('zoom', ({ transform }) => {
      _currentTransform = transform;
      _queueAnimFrame();
      if (!_suppressZoomCallback) onZoomChange?.(transform);
    })
    .on('end', ({ transform }) => {
      _queueAnimFrame();
      if (!_suppressZoomCallback) onZoomChange?.(transform);
    });
  canvasSel.call(zoom);

  /* ── public API ───────────────────────────────────────────────── */

  function resize(w, h) {
    _width  = w;
    _height = h;
    const dpr = window.devicePixelRatio || 1;
    canvasElement.width  = Math.round(w * dpr);
    canvasElement.height = Math.round(h * dpr);
    canvasElement.style.width  = `${w}px`;
    canvasElement.style.height = `${h}px`;
  }

  function setLayers(layers) { _layers = layers; }

  async function render() {
    if (_renderInFlight) { _renderAgain = true; return; }
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
    canvasSel.transition().duration(400).call(zoom.transform, d3.zoomIdentity);
  }

  function getProjection() { return _projection; }
  function getPath()       { return _pathForBounds; }
  function getGeoJSONRenderStats(layerId) { return _geojsonRenderStats.get(layerId) || null; }

  /** Canvas has no DOM nodes per layer so visibility changes require a re-render. */
  function setLayerVisibility(_layerId, _visible) {
    render();
    return true;
  }

  /** Canvas cannot serialize to SVG. Export must use the SVG renderer. */
  function serializeSvg() { return null; }

  function setSpacePanActive(active) { _spacePanActive = !!active; }

  function panProjectionByPixels(dx, dy) {
    const base = _layers.find(l => l.type === LAYER_TYPES.BASEMAP);
    if (!base || !_projection || typeof _projection.invert !== 'function') return false;
    const k   = _currentTransform?.k || 1;
    const ndx = dx / k;
    const ndy = dy / k;
    const centerPx = [_width / 2, _height / 2];
    const geoA = _projection.invert(centerPx);
    const geoB = _projection.invert([centerPx[0] - ndx, centerPx[1] - ndy]);
    if (!geoA || !geoB) return false;
    const cur = base.style.center || [0, 0];
    base.style.center = [
      _sharedWrapLongitude((cur[0] || 0) + (geoB[0] - geoA[0])),
      _sharedClampLatitude((cur[1] || 0) + (geoB[1] - geoA[1])),
    ];
    return true;
  }

  function panProjectionLongitudeByPixels(dx) {
    const base = _layers.find(l => l.type === LAYER_TYPES.BASEMAP);
    if (!base || !_projection || typeof _projection.invert !== 'function') return false;
    const k   = _currentTransform?.k || 1;
    const ndx = dx / k;
    const centerPx = [_width / 2, _height / 2];
    const geoA = _projection.invert(centerPx);
    const geoB = _projection.invert([centerPx[0] - ndx, centerPx[1]]);
    if (!geoA || !geoB) return false;
    const cur = base.style.center || [0, 0];
    base.style.center = [
      _sharedWrapLongitude((cur[0] || 0) + (geoB[0] - geoA[0])),
      _sharedClampLatitude(cur[1] || 0),
    ];
    return true;
  }

  /* ── internal render ──────────────────────────────────────────── */

  function _getCtx() {
    const dpr = window.devicePixelRatio || 1;
    const ctx = canvasElement.getContext('2d');
    // Reset to identity then apply DPR scaling.
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return ctx;
  }

  async function _renderNow() {
    const ctx = _getCtx();
    ctx.clearRect(0, 0, _width, _height);
    _geojsonRenderStats = new Map();

    const base       = _layers.find(l => l.type === LAYER_TYPES.BASEMAP);
    const frameLayer = _layers.find(l => l.type === LAYER_TYPES.FRAME);
    const frameRect  = computeFrameRect(_width, _height, frameLayer?.style);
    _currentFrameRect = frameRect;

    const baseMode = base?.style?.baseMode || 'globe';
    const projId = baseMode === 'geographic'
      ? 'geoEquirectangular'
      : (base?.style.projection || 'geoNaturalEarth1');
    const center = base?.style.center     || [0, 0];
    const rotate = base?.style.rotate     || [0, 0, 0];
    const signature = JSON.stringify({ projId, center, rotate, frameRect, width: _width, height: _height });
    if (signature !== _projectionSignature) {
      _projectionSignature = signature;
      _projectionStamp += 1;
    }
    _projId     = projId;
    _projection = _makeProjection(d3, projId, _width, _height, center, rotate, frameRect);
    _pathForBounds = d3.geoPath(_projection); // no context — bounds only

    const k  = _currentTransform.k;
    const tx = _currentTransform.x;
    const ty = _currentTransform.y;

    const backgroundFill    = base?.style?.backgroundFill ||
      (frameLayer?.visible && frameLayer.style?.showFill ? frameLayer.style?.fill : null);
    const backgroundOpacity = Number(base?.style?.backgroundOpacity ??
      (frameLayer?.style?.fillOpacity ?? 1));

    // ── Clip everything to the frame rect ─────────────────────────
    ctx.save();
    ctx.beginPath();
    ctx.rect(frameRect.x, frameRect.y, frameRect.width, frameRect.height);
    ctx.clip();

    // Frame background (screen-space, before zoom transform)
    if (backgroundFill) {
      ctx.globalAlpha = backgroundOpacity;
      ctx.fillStyle = backgroundFill;
      ctx.fillRect(frameRect.x, frameRect.y, frameRect.width, frameRect.height);
      ctx.globalAlpha = 1;
    }

    // Apply zoom/pan transform for all geographic content
    ctx.translate(tx, ty);
    ctx.scale(k, k);

    // Clip geo content to the projected sphere boundary
    {
      const ctxPath = d3.geoPath(_projection, ctx);
      ctx.save();
      ctx.beginPath();
      ctxPath({ type: 'Sphere' });
      ctx.clip();

      for (const layer of _layers) {
        if (!layer.visible) continue;
        if (layer.type === LAYER_TYPES.FRAME) continue;
        ctx.save();
        ctx.globalAlpha = layer.opacity ?? 1;
        switch (layer.type) {
          case LAYER_TYPES.BASEMAP: await _drawBasemap(ctx, layer, k); break;
          case LAYER_TYPES.GEOJSON:       _drawGeoJSON(ctx, layer, k); break;
          case LAYER_TYPES.POINTS:        _drawPoints(ctx, layer, k);  break;
          case LAYER_TYPES.TREE:          _drawTree(ctx, layer, k);    break;
        }
        ctx.restore();
      }

      ctx.restore(); // sphere clip
    }

    ctx.restore(); // frame clip + zoom transform

    // ── Frame border (screen-space, no zoom) ──────────────────────
    if (frameLayer?.visible) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(frameRect.x, frameRect.y, frameRect.width, frameRect.height);
      ctx.strokeStyle = frameLayer.style?.stroke || '#d8d8d8';
      ctx.lineWidth   = frameLayer.style?.strokeWidth ?? 1.5;
      ctx.lineJoin    = 'round';
      ctx.lineCap     = 'round';
      ctx.globalAlpha = frameLayer.opacity ?? 1;
      ctx.stroke();
      ctx.restore();
    }
  }

  /* ── layer draw functions ─────────────────────────────────────── */

  async function _drawBasemap(ctx, layer, k) {
    await drawCanvasBasemapLayer({
      ctx,
      layer,
      zoomK: k,
      d3,
      topojson,
      projection: _projection,
      currentTransform: _currentTransform,
      projectionStamp: _projectionStamp,
      projId: _projId,
      basemapCache: _cacheState.get('basemapCache'),
      setBasemapCache: cache => { _cacheState.set('basemapCache', cache); },
      graticuleCache: _cacheState.get('graticuleCache'),
      setGraticuleCache: cache => { _cacheState.set('graticuleCache', cache); },
      fetchOutline: _fetchOutline,
      prepareForSeamClipping: _prepareForSeamClipping,
      basemapOutlineIds: _basemapOutlineIds,
      chooseGeographicRasterPath: _chooseGeographicRasterPath,
      computeGeographicImageRect: _computeGeographicImageRect,
      normalizeScale: _normalizeScale,
      pickTopoObjectKey,
      loadRasterImage: _loadRasterImage,
      fillPathEvenOdd: _fillPathEvenOdd,
    });
  }

  function _drawGeoJSON(ctx, layer, k) {
    drawCanvasGeoJsonLayer({
      ctx,
      layer,
      k,
      d3,
      projection: _projection,
      currentTransform: _currentTransform,
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

  function _drawPoints(ctx, layer, k) {
    drawCanvasPointsLayer({ ctx, layer, projection: _projection, zoomK: k });
  }

  function _drawTree(ctx, layer, k) {
    drawCanvasTreeLayer({
      ctx,
      layer,
      projection: _projection,
      ctxPath: d3.geoPath(_projection, ctx),
      zoomK: k,
      projId: _projId,
    });
  }

  /* ── shared helpers ───────────────────────────────────────────── */

  function _queueAnimFrame() {
    if (_animFrameQueued) return;
    _animFrameQueued = true;
    requestAnimationFrame(() => {
      _animFrameQueued = false;
      // Skip render if element is hidden (inactive renderer)
      if (canvasElement.style.display !== 'none') render();
    });
  }

  function _basemapOutlineIds(bsrc) {
    return _sharedBasemapOutlineIds(bsrc);
  }

  function _normalizeScale(scale, fallback = '50m') {
    return _sharedNormalizeScale(scale, fallback);
  }

  function _chooseGeographicRasterPath(style = {}, zoomK = 1) {
    return _sharedChooseGeographicRasterPath(style, zoomK);
  }

  function _computeGeographicImageRect() {
    return _sharedComputeGeographicImageRect(_projection);
  }

  function _loadRasterImage(url) {
    return _rasterLoader.load(url);
  }

  function _fillPathEvenOdd(ctx) {
    return _sharedFillPathEvenOdd(ctx);
  }

  function _fetchOutline(outlineId) {
    return _outlineFetcher.fetchOutline(outlineId);
  }

  function _prepareForSeamClipping(geometry) {
    return _sharedPrepareForSeamClipping(geometry, { d3, projId: _projId });
  }

  function _featureBounds(feature) {
    if (!feature || !_pathForBounds) return null;
    const cached = _featureBoundsCache.get(feature);
    if (cached && cached.stamp === _projectionStamp) return cached.bounds;
    try {
      const b = _pathForBounds.bounds(feature);
      if (!b || !Number.isFinite(b[0]?.[0]) || !Number.isFinite(b[1]?.[0])) return null;
      _featureBoundsCache.set(feature, { stamp: _projectionStamp, bounds: b });
      return b;
    } catch { return null; }
  }

  function _intersectsViewportAfterTransform(bounds, transform, frameRect) {
    if (!bounds || !transform || !frameRect) return false;
    const left   = Math.min(transform.applyX(bounds[0][0]), transform.applyX(bounds[1][0]));
    const right  = Math.max(transform.applyX(bounds[0][0]), transform.applyX(bounds[1][0]));
    const top    = Math.min(transform.applyY(bounds[0][1]), transform.applyY(bounds[1][1]));
    const bottom = Math.max(transform.applyY(bounds[0][1]), transform.applyY(bounds[1][1]));
    return right  >= frameRect.x && left   <= frameRect.x + frameRect.width &&
           bottom >= frameRect.y && top    <= frameRect.y + frameRect.height;
  }

  function _resolveLayerGeoJSON(layer) {
    return _resolveLayerGeoJSONShared(layer, {
      topojson,
      resolvedCache: _resolvedGeoDataCache,
    });
  }

  function _getSimplifiedLayerData(layer, simplifyLevel) {
    return _getSimplifiedLayerDataShared(layer, simplifyLevel, {
      topojson,
      resolvedCache: _resolvedGeoDataCache,
      layerCache: _geojsonLayerCache,
    });
  }

  function _geojsonRenderPolicy(featureCount, style = {}) {
    return _geojsonRenderPolicyShared(featureCount, style);
  }

  function _resolveGeojsonSimplifyLevel(args) {
    return _resolveGeojsonSimplifyLevelShared(args);
  }

  function getZoomTransform() { return _currentTransform; }

  /** Programmatically set zoom without firing onZoomChange. */
  function syncZoomTransform(transform) {
    _suppressZoomCallback = true;
    _currentTransform = transform;
    zoom.transform(canvasSel, transform);
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

