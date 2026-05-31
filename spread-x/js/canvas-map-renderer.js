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

import { LAYER_TYPES, MAP_OUTLINES, FRAME_ASPECTS } from './layers.js';

/** Zoom scale at which to hand off rendering to the SVG renderer. */
export const CANVAS_TO_SVG_THRESHOLD = 8;

/* ── Shared projection factory (mirrors map-renderer.js) ─────────── */

function _makeProjection(d3, projId, width, height, center, rotate, frameRect) {
  const factory = d3[projId] || d3.geoNaturalEarth1;
  const proj = factory();
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
  const _topoCache = {};
  let _basemapCache = null; // { stamp, projId, land, countryMesh }
  let _graticuleCache = null; // { step, graticule }

  /* ── D3 zoom ──────────────────────────────────────────────────── */

  let _suppressZoomCallback = false;
  const canvasSel = d3.select(canvasElement);
  const zoom = d3.zoom()
    .filter(event => {
      if (_spacePanActive && (event.type === 'mousedown' || event.type === 'touchstart')) return false;
      return (!event.ctrlKey || event.type === 'wheel') && !event.button;
    })
    .scaleExtent([0.5, 30])
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
      _wrapLongitude((cur[0] || 0) + (geoB[0] - geoA[0])),
      _clampLatitude((cur[1] || 0) + (geoB[1] - geoA[1])),
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
      _wrapLongitude((cur[0] || 0) + (geoB[0] - geoA[0])),
      _clampLatitude(cur[1] || 0),
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
    const frameRect  = _computeFrameRect(_width, _height, frameLayer?.style);
    _currentFrameRect = frameRect;

    const projId = base?.style.projection || 'geoNaturalEarth1';
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
    const s = layer.style;
    const showGlobe            = s.showGlobe !== false;
    const showLandBoundaries   = showGlobe && s.showLandBoundaries !== false;
    const showCountryBoundaries = showGlobe && s.showCountryBoundaries !== false;
    const oceanFill            = s.oceanFill;
    const landFill             = s.landFill;
    const landStroke           = s.landBoundaryStroke || s.landStroke || '#4a8a5a';
    const landWidth            = (s.landBoundaryWidth ?? s.landStrokeWidth ?? 0.5) / k;
    const outlineStroke        = s.projectionBoundaryStroke || s.outlineStroke || '#4a8a5a';
    const outlineWidth         = (s.projectionBoundaryWidth ?? s.outlineStrokeWidth ?? 1) / k;

    const ctxPath = d3.geoPath(_projection, ctx);

    // Graticule (drawn before sphere fill so it appears under ocean)
    if (s.showGraticule) {
      const step = s.graticuleStep || 10;
      if (!_graticuleCache || _graticuleCache.step !== step) {
        _graticuleCache = { step, graticule: d3.geoGraticule().step([step, step])() };
      }
      ctx.save();
      ctx.beginPath();
      ctxPath(_graticuleCache.graticule);
      ctx.strokeStyle = s.graticuleStroke || '#ffffff';
      ctx.lineWidth   = 0.5 / k;
      ctx.lineJoin    = 'round';
      ctx.lineCap     = 'round';
      ctx.globalAlpha *= (s.graticuleOpacity ?? 0.1);
      ctx.stroke();
      ctx.restore();
    }

    // Ocean sphere fill
    ctx.save();
    ctx.beginPath();
    ctxPath({ type: 'Sphere' });
    if (oceanFill) { ctx.fillStyle = oceanFill; ctx.fill(); }
    ctx.strokeStyle = outlineStroke;
    ctx.lineWidth   = outlineWidth;
    ctx.lineJoin    = 'round';
    ctx.lineCap     = 'round';
    ctx.stroke();
    ctx.restore();

    // Land topology (cached across renders unless projection or source changes)
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
          const keys = Object.keys(landTopo.objects);
          land = _prepareForSeamClipping(topojson.feature(landTopo, landTopo.objects[keys[0]]));
        }
        if (countriesTopo) {
          const countriesKey = Object.keys(countriesTopo.objects)[0];
          if (countriesKey) {
            countryMesh = _prepareForSeamClipping(
              topojson.mesh(countriesTopo, countriesTopo.objects[countriesKey], (a, b) => a !== b)
            );
          }
        }
        _basemapCache = { stamp: _projectionStamp, projId: _projId, src: bsrc, land, countryMesh };
      }

      const { land, countryMesh } = _basemapCache;

      if (land && showGlobe) {
        ctx.save();
        ctx.beginPath();
        ctxPath(land);
        ctx.fillStyle = landFill;
        ctx.fill();
        ctx.restore();
      }

      if (land && showLandBoundaries) {
        ctx.save();
        ctx.beginPath();
        ctxPath(land);
        ctx.strokeStyle = landStroke;
        ctx.lineWidth   = landWidth;
        ctx.lineJoin    = 'round';
        ctx.lineCap     = 'round';
        ctx.stroke();
        ctx.restore();
      }

      if (showCountryBoundaries && countryMesh) {
        ctx.save();
        ctx.beginPath();
        ctxPath(countryMesh);
        ctx.strokeStyle = landStroke;
        ctx.lineWidth   = landWidth;
        ctx.lineJoin    = 'round';
        ctx.lineCap     = 'round';
        ctx.stroke();
        ctx.restore();
      }
    } catch (err) {
      console.warn('Failed to load basemap topology:', err);
    }
  }

  function _drawGeoJSON(ctx, layer, k) {
    if (!layer.data) return;
    const s = layer.style;
    const simplifyLevel = Math.max(0, Math.min(5, Math.round(Number(s.simplify ?? 0))));
    const simplified    = _getSimplifiedLayerData(layer, simplifyLevel);
    if (!simplified) return;
    const prepared     = _prepareForSeamClipping(simplified);
    const allFeatures  = prepared.type === 'FeatureCollection' ? prepared.features : [prepared];

    const policy = _geojsonRenderPolicy(allFeatures.length, s);
    if (_currentTransform.k < policy.minZoom) {
      _geojsonRenderStats.set(layer.id, {
        totalFeatures: allFeatures.length, inViewFeatures: 0, renderedFeatures: 0,
        zoomScale: _currentTransform.k, minZoom: policy.minZoom,
        maxVisibleFeatures: policy.maxVisibleFeatures, hiddenByZoom: true, capped: false,
      });
      return;
    }

    const frameRect = _currentFrameRect || { x: 0, y: 0, width: _width, height: _height };
    const features = [];
    let inViewFeatures = 0, capped = false;
    for (const feature of allFeatures) {
      const b = _featureBounds(feature);
      if (!b) continue;
      if (!_intersectsViewportAfterTransform(b, _currentTransform, frameRect)) continue;
      inViewFeatures += 1;
      features.push(feature);
      if (features.length >= policy.maxVisibleFeatures) { capped = true; break; }
    }

    _geojsonRenderStats.set(layer.id, {
      totalFeatures: allFeatures.length, inViewFeatures,
      renderedFeatures: features.length, zoomScale: _currentTransform.k,
      minZoom: policy.minZoom, maxVisibleFeatures: policy.maxVisibleFeatures,
      hiddenByZoom: false, capped,
    });

    if (!features.length) return;

    const ctxPath = d3.geoPath(_projection, ctx);
    const fc = { type: 'FeatureCollection', features };

    // Fill pass
    if (s.fill && s.fill !== 'none') {
      ctx.save();
      ctx.beginPath();
      ctxPath(fc);
      ctx.fillStyle   = s.fill;
      ctx.globalAlpha *= (s.fillOpacity ?? 1);
      ctx.fill();
      ctx.restore();
    }

    // Stroke pass
    if (s.stroke && s.stroke !== 'none' && s.strokeWidth > 0) {
      ctx.save();
      ctx.beginPath();
      ctxPath(fc);
      ctx.strokeStyle = s.stroke;
      ctx.lineWidth   = s.strokeWidth / k;
      ctx.lineJoin    = 'round';
      ctx.lineCap     = 'round';
      ctx.stroke();
      ctx.restore();
    }
  }

  function _drawPoints(ctx, layer, k) {
    if (!layer.data?.length) return;
    const s = layer.style;
    const r = s.radius || 4;

    for (const d of layer.data) {
      const lon = d.longitude ?? d.lon ?? d.lng;
      const lat = d.latitude  ?? d.lat;
      const xy  = _projection([+lon, +lat]);
      if (!xy) continue;

      ctx.save();
      ctx.beginPath();
      ctx.arc(xy[0], xy[1], r / k, 0, 2 * Math.PI);
      if (s.fill && s.fill !== 'none') {
        ctx.fillStyle   = s.fill;
        ctx.globalAlpha *= (s.fillOpacity ?? 1);
        ctx.fill();
      }
      if (s.stroke && s.strokeWidth > 0) {
        ctx.strokeStyle = s.stroke;
        ctx.lineWidth   = s.strokeWidth / k;
        ctx.stroke();
      }
      ctx.restore();

      if (s.labelField && d[s.labelField]) {
        ctx.save();
        ctx.font        = `${(s.labelSize || 12) / k}px sans-serif`;
        ctx.fillStyle   = '#ffffff';
        ctx.globalAlpha *= 0.9;
        ctx.fillText(d[s.labelField], xy[0] + (r + 3) / k, xy[1] + 3 / k);
        ctx.restore();
      }
    }
  }

  function _drawTree(ctx, layer, k) {
    if (!layer.data) return;
    const s = layer.style;
    const { branches = [], nodes = [] } = layer.data;
    const discontinuous = _isProjectionDiscontinuous(_projId);
    const ctxPath = d3.geoPath(_projection, ctx);

    if (branches.length) {
      ctx.save();
      ctx.strokeStyle = s.branchColor;
      ctx.lineWidth   = (s.branchWidth || 1) / k;
      ctx.lineJoin    = 'round';
      ctx.lineCap     = 'round';
      ctx.globalAlpha *= (s.branchOpacity ?? 1);
      for (const d of branches) {
        ctx.beginPath();
        if (s.branchStyle === 'greatcircle' || discontinuous) {
          ctxPath({ type: 'LineString', coordinates: [[d.startLon, d.startLat], [d.endLon, d.endLat]] });
        } else {
          const a = _projection([d.startLon, d.startLat]);
          const b = _projection([d.endLon, d.endLat]);
          if (a && b) { ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); }
        }
        ctx.stroke();
      }
      ctx.restore();
    }

    if (nodes.length) {
      ctx.save();
      ctx.fillStyle   = s.nodeColor;
      ctx.globalAlpha *= (s.nodeOpacity ?? 1);
      const nr = (s.nodeRadius || 3) / k;
      for (const d of nodes) {
        const xy = _projection([d.longitude ?? d.lon, d.latitude ?? d.lat]);
        if (!xy) continue;
        ctx.beginPath();
        ctx.arc(xy[0], xy[1], nr, 0, 2 * Math.PI);
        ctx.fill();
      }
      ctx.restore();
    }
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
    switch (bsrc) {
      case 'ne110': return ['ne-land-110m', 'ne-countries-110m'];
      case 'ne50':  return ['ne-land-50m',  'ne-countries-50m'];
      case 'ne10':  return ['ne-land-10m',  'ne-countries-10m'];
      default:      return ['land-110m',    'countries-110m'];
    }
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
    if (!_isProjectionDiscontinuous(_projId)) return geometry;
    if (!geometry || typeof d3.geoStitch !== 'function') return geometry;
    try { return d3.geoStitch(geometry); } catch { return geometry; }
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
    const data = layer?.data;
    if (!data) return null;
    if (data._sxFormat !== 'topojson-object') return data;
    let cached = _resolvedGeoDataCache.get(layer);
    if (cached && cached.sourceRef === data) return cached.resolved;
    const topology = data.topology;
    if (!topology || topology.type !== 'Topology') return null;
    const keys = Object.keys(topology.objects || {});
    const key = data.objectName && topology.objects?.[data.objectName] ? data.objectName : keys[0];
    if (!key) return null;
    const resolved = topojson.feature(topology, topology.objects[key]);
    _resolvedGeoDataCache.set(layer, { sourceRef: data, resolved });
    return resolved;
  }

  function _getSimplifiedLayerData(layer, simplifyLevel) {
    const resolved = _resolveLayerGeoJSON(layer);
    if (!resolved || simplifyLevel <= 0) return resolved;
    let cache = _geojsonLayerCache.get(layer);
    if (!cache || cache.sourceRef !== resolved || cache.simplifyLevel !== simplifyLevel) {
      cache = { sourceRef: resolved, simplifyLevel, simplified: _simplifyGeoJSON(resolved, simplifyLevel) };
      _geojsonLayerCache.set(layer, cache);
    }
    return cache.simplified;
  }

  function _simplifyGeoJSON(data, level) {
    if (!data || level <= 0) return data;
    if (data.type === 'FeatureCollection') return { ...data, features: data.features.map(f => _simplifyFeature(f, level)) };
    if (data.type === 'Feature') return _simplifyFeature(data, level);
    return { type: data.type, coordinates: _simplifyCoords(data.type, data.coordinates, level) };
  }

  function _simplifyFeature(feature, level) {
    if (!feature?.geometry) return feature;
    return { ...feature, geometry: { ...feature.geometry, coordinates: _simplifyCoords(feature.geometry.type, feature.geometry.coordinates, level) } };
  }

  function _simplifyCoords(type, coords, level) {
    if (!coords) return coords;
    const stride = level + 1;
    switch (type) {
      case 'LineString':     return _decimateLine(coords, stride, false);
      case 'MultiLineString': return coords.map(l => _decimateLine(l, stride, false));
      case 'Polygon':        return coords.map(r => _decimateLine(r, stride, true));
      case 'MultiPolygon':   return coords.map(p => p.map(r => _decimateLine(r, stride, true)));
      default:               return coords;
    }
  }

  function _decimateLine(coords, stride, closed) {
    if (!Array.isArray(coords)) return coords;
    const minPts = closed ? 4 : 2;
    if (coords.length <= minPts || stride <= 1) return coords;
    const out = [];
    for (let i = 0; i < coords.length; i++) {
      if (i === 0 || i === coords.length - 1 || (i % stride) === 0) out.push(coords[i]);
    }
    if (closed) {
      if (out[0] !== out[out.length - 1]) out.push(out[0]);
      while (out.length < 4) out.splice(out.length - 1, 0, out[0]);
    } else {
      while (out.length < 2 && coords.length > out.length) out.push(coords[out.length]);
    }
    return out;
  }

  function _geojsonRenderPolicy(featureCount, style = {}) {
    if (style.autoPerf === false) {
      return {
        minZoom: Math.max(1, Math.min(12, Number(style.minZoom) || 1)),
        maxVisibleFeatures: Math.max(100, Math.min(20000, Math.round(Number(style.maxVisible) || 2000))),
      };
    }
    if (featureCount > 8000) return { minZoom: 5,   maxVisibleFeatures: 900 };
    if (featureCount > 4000) return { minZoom: 4,   maxVisibleFeatures: 1200 };
    if (featureCount > 2000) return { minZoom: 3,   maxVisibleFeatures: 1600 };
    if (featureCount > 800)  return { minZoom: 2,   maxVisibleFeatures: 2000 };
    if (featureCount > 300)  return { minZoom: 1.5, maxVisibleFeatures: 2600 };
    return { minZoom: 1, maxVisibleFeatures: 4000 };
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
/* ── module-level helpers ─────────────────────────────────────────── */

function _wrapLongitude(lon) {
  if (!Number.isFinite(lon)) return 0;
  let x = ((lon + 180) % 360 + 360) % 360 - 180;
  return x === -180 ? 180 : x;
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

function _computeFrameRect(width, height, frameStyle) {
  const preset  = frameStyle?.aspectPreset || 'slideWide';
  const ratio   = FRAME_ASPECTS[preset]?.ratio || (16 / 9);
  const margin  = Math.max(0, Number(frameStyle?.margin ?? 24));
  const availW  = Math.max(1, width  - 2 * margin);
  const availH  = Math.max(1, height - 2 * margin);
  let w = availW, h = w / ratio;
  if (h > availH) { h = availH; w = h * ratio; }
  return { x: (width - w) / 2, y: (height - h) / 2, width: w, height: h };
}
