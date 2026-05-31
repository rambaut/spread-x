import { createMapRenderer } from '../map-renderer.js';
import { createCanvasMapRenderer, CANVAS_TO_SVG_THRESHOLD } from '../canvas-map-renderer.js';

export function createMapRendererCore({
  svgElement,
  canvasElement,
  d3,
  topojson,
  getLayers,
  onZoomChange,
  shouldForceCanvas,
  getCanvasToSvgThreshold,
  canvasToSvgThreshold = CANVAS_TO_SVG_THRESHOLD,
} = {}) {
  let _usingCanvas = true;

  function _shouldForceSvgForGeoJSON() {
    const layers = getLayers?.() || [];
    return layers.some(layer => layer?.type === 'geojson' && layer?.visible !== false && layer?.data);
  }

  function _threshold() {
    const dynamic = Number(getCanvasToSvgThreshold?.());
    if (Number.isFinite(dynamic) && dynamic > 0) return dynamic;
    return canvasToSvgThreshold;
  }

  function _switchToCanvas(transform) {
    if (_usingCanvas) return;
    _usingCanvas = true;
    svgElement.style.display = 'none';
    canvasElement.style.display = 'block';
    if (transform) canvasRenderer.syncZoomTransform(transform);
  }

  function _switchToSvg(transform) {
    if (!_usingCanvas) return;
    _usingCanvas = false;
    canvasElement.style.display = 'none';
    svgElement.style.display = 'block';
    if (transform) svgRenderer.syncZoomTransform(transform);
  }

  const canvasRenderer = createCanvasMapRenderer({
    canvasElement,
    d3,
    topojson,
    onZoomChange: transform => {
      onZoomChange?.(transform);
      if (_shouldForceSvgForGeoJSON()) {
        _switchToSvg(transform);
        return;
      }
      if (shouldForceCanvas?.()) return;
      if (transform.k >= _threshold()) _switchToSvg(transform);
    },
  });

  const svgRenderer = createMapRenderer({
    svgElement,
    d3,
    topojson,
    onZoomChange: transform => {
      onZoomChange?.(transform);
      if (_shouldForceSvgForGeoJSON()) return;
      if (shouldForceCanvas?.()) {
        _switchToCanvas(transform);
        return;
      }
      if (transform.k < _threshold()) _switchToCanvas(transform);
    },
  });

  function _reconcileRendererMode() {
    const transform = (_usingCanvas ? canvasRenderer : svgRenderer).getZoomTransform?.() || d3.zoomIdentity;
    if (_shouldForceSvgForGeoJSON()) {
      _switchToSvg(transform);
      return;
    }
    if (shouldForceCanvas?.()) {
      _switchToCanvas(transform);
      return;
    }
    if (transform.k >= _threshold()) _switchToSvg(transform);
    else _switchToCanvas(transform);
  }

  const api = {
    resize(w, h) {
      canvasRenderer.resize(w, h);
      svgRenderer.resize(w, h);
    },
    setLayers(layers) {
      canvasRenderer.setLayers(layers);
      svgRenderer.setLayers(layers);
    },
    render() {
      _reconcileRendererMode();
      const active = _usingCanvas ? canvasRenderer : svgRenderer;
      active.setLayers(getLayers?.() || []);
      return active.render();
    },
    resetZoom() {
      canvasRenderer.resetZoom();
      svgRenderer.resetZoom();
    },
    getProjection() {
      return (_usingCanvas ? canvasRenderer : svgRenderer).getProjection();
    },
    getPath() {
      return (_usingCanvas ? canvasRenderer : svgRenderer).getPath();
    },
    getGeoJSONRenderStats(id) {
      return (_usingCanvas ? canvasRenderer : svgRenderer).getGeoJSONRenderStats(id);
    },
    getLastRenderBreakdown() {
      return (_usingCanvas ? canvasRenderer : svgRenderer).getLastRenderBreakdown?.() || null;
    },
    setLayerVisibility(id, visible) {
      return (_usingCanvas ? canvasRenderer : svgRenderer).setLayerVisibility(id, visible);
    },
    async serializeSvg() {
      const wrapper = canvasElement?.parentElement;
      const w = wrapper?.clientWidth || 800;
      const h = wrapper?.clientHeight || 600;
      svgRenderer.resize(w, h);
      svgRenderer.setLayers(getLayers?.() || []);
      const t = (_usingCanvas ? canvasRenderer : svgRenderer).getZoomTransform();
      svgRenderer.syncZoomTransform(t);
      await svgRenderer.render();
      return svgRenderer.serializeSvg();
    },
    setSpacePanActive(active) {
      canvasRenderer.setSpacePanActive(active);
      svgRenderer.setSpacePanActive(active);
    },
    panProjectionByPixels(dx, dy) {
      return (_usingCanvas ? canvasRenderer : svgRenderer).panProjectionByPixels(dx, dy);
    },
    panProjectionLongitudeByPixels(dx) {
      return (_usingCanvas ? canvasRenderer : svgRenderer).panProjectionLongitudeByPixels(dx);
    },
    getZoomTransform() {
      return (_usingCanvas ? canvasRenderer : svgRenderer).getZoomTransform?.() || d3.zoomIdentity;
    },
    syncZoomTransform(transform) {
      canvasRenderer.syncZoomTransform(transform);
      svgRenderer.syncZoomTransform(transform);
    },
    isUsingCanvas() {
      return _usingCanvas;
    },
    switchToCanvas(transform) {
      _switchToCanvas(transform);
    },
    switchToSvg(transform) {
      _switchToSvg(transform);
    },
  };

  return api;
}
