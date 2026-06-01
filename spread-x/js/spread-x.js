/**
 * spread-x.js — SPREAD-X application entry module.
 *
 * GIS-style spatial phylogenetic mapping application.
 * Uses D3 geo projections to render layers onto an SVG map.
 */

import { downloadBlob, wireDropZone } from '@artic-network/pearcore/utils.js';
import { createCommands } from '@artic-network/pearcore/commands.js';
import { createGraphicsExporter } from '@artic-network/pearcore/graphics-export.js';
import { loadSettings, saveSettings as _saveSettings } from '@artic-network/pearcore/pearcore-app.js';
import { upgradeAllPaletteColourPickers } from '@artic-network/pearcore/colorpicker.js';
import { CATEGORICAL_PALETTES } from '@artic-network/pearcore/palettes.js';
import { createLayer, duplicateLayer, LAYER_TYPES, LAYER_ICONS, MAP_OUTLINES } from './layers.js';
import {
  pointFields,
} from './parsers.js';
import { createMapRendererCore } from './core/map-renderer-core.js';
import { createMapViewport } from './core/map-viewport.js';
import { createBasemapController } from './core/basemap-controller.js';
import { createCountryInteractionState } from './core/country-interaction-state.js';
import { applyNamedGeojsonPerformanceProfile, createDefaultGeojsonLayerBootstrap } from './core/default-geojson-layers.js';
import { createLayerImportService } from './core/layer-import-service.js';
import { createMapInteractionController } from './core/map-interaction-controller.js';
import { openTreeMappingDialog } from './core/tree-mapping-dialog.js';
import { createPanelController } from './core/panel-controller.js';
import { createAppCommandController } from './core/app-command-controller.js';
import {
  bindSettingsPanelHandlers,
  populateSettingsForLayer,
  readSettingsFromLayerUI,
  syncBasemapModeUI as syncBasemapModeUIControl,
} from './core/settings-controller.js';
import { createBasemapStatusController } from './core/basemap-status-controller.js';
import { createLayoutModeController } from './core/layout-mode-controller.js';
import { createWelcomeOverlayController } from './core/welcome-overlay-controller.js';
import { createImportUiController } from './core/import-ui-controller.js';
import { createFeatureInteractionController } from './core/feature-interaction-controller.js';
import {
  buildPresetFeatureLayers,
  groupPresetLayers,
  loadPresetCatalog,
  loadPresetManifest,
  loadPresetTopologySource,
  resolvePresetDetailSelection,
  resolvePresetFeatureSelection,
} from './core/preset-layer-service.js';
import { computeFrameRect } from './core/frame-geometry.js';
import { pickTopoObjectKey } from './core/topology-utils.js';
import { createLayerManager } from './core/layer-manager.js';
import { FRAME_PADDING_UI, GEOJSON_LIMITS, RENDERER_MODE_LIMITS } from './config.js';
import { CANVAS_TO_SVG_THRESHOLD } from './canvas-map-renderer.js';
import {
  autoGeojsonRenderPolicy,
  countGeoJSONFeatures,
  resolveGeojsonAdaptiveDetailPercent,
  resolveLayerGeoJSON,
} from './core/vector-layer-utils.js';

// ── Command definitions ──────────────────────────────────────────────────

const COMMAND_DEFS = [
  { id: 'import', label: 'Import…',        shortcut: 'CmdOrCtrl+O', buttonId: 'btn-import-auto' },
  { id: 'export', label: 'Export Image…',   shortcut: 'CmdOrCtrl+Shift+E', buttonId: 'btn-export' },
];

// ── Main app ─────────────────────────────────────────────────────────────

export async function app(opts = {}) {
  const root = document;
  const $ = id => root.querySelector('#' + id);
  const statusStats = $('status-stats');

  // Wait for D3 + topojson to be available (loaded via CDN in HTML)
  const d3 = window.d3;
  const topojson = window.topojson;
  if (!d3 || !topojson) {
    console.error('SPREAD-X: d3 and topojson must be loaded before app()');
    return;
  }

  // ── State ────────────────────────────────────────────────────────────
  const layerManager = createLayerManager({ createLayer, duplicateLayer, layerTypes: LAYER_TYPES });
  const layers = layerManager.layers;
  let selectedId = null;
  let settings = {};
  let _layoutMode = false;
  let mapInteractionController = null;
  let _canvasToSvgSwitchZoom = CANVAS_TO_SVG_THRESHOLD;
  let _naturalEarthRasterSets = ['NE1'];
  let _rasterSetsDiscovered = false;
  const countryInteractionState = createCountryInteractionState();
  const _countryFeaturesCache = new Map();
  const _selectedGeojsonFeaturesCache = new Map();
  const _settingsResolvedGeojsonCache = new WeakMap();
  const defaultGeojsonBootstrap = createDefaultGeojsonLayerBootstrap({
    layers,
    createLayer,
    layerTypes: LAYER_TYPES,
    insertLayer: layer => layerManager.insertBeforeFrame(layer),
    fetchImpl: fetch,
  });
  const basemapController = createBasemapController({
    getLayers: () => layers,
    layerTypes: LAYER_TYPES,
    normalizeScale: (value, fallback) => _normalizeScale(value, fallback),
  });
  const layerImportService = createLayerImportService({
    layerTypes: LAYER_TYPES,
    topojson,
    createLayer,
    applyNamedGeojsonPerformanceProfile,
    requestTreeMapping: analysis => openTreeMappingDialog({ overlay: treeMapOverlay, getEl: $ }, analysis),
  });

  function _isGeographicRasterMode() {
    return basemapController.isGeographicRasterMode();
  }

  function _activeBasemapLayer() {
    return basemapController.getBasemap();
  }

  function _activeCountryScale() {
    return basemapController.activeCountryScale();
  }

  function _activeGeojsonFeatureLayer() {
    const selected = layers.find(l => l.id === selectedId);
    if (selected?.type === LAYER_TYPES.GEOJSON && selected.data) return selected;
    return null;
  }

  function _geojsonFeatureId(feature, index = -1) {
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

  function _geojsonFeatureName(feature, index = -1) {
    const p = feature?.properties || {};
    return String(
      p.name ||
      p.NAME ||
      p.NAME_EN ||
      p.ADMIN ||
      p.label ||
      _geojsonFeatureId(feature, index) ||
      'Feature'
    ).trim();
  }

  function _extractGeojsonFeatures(data) {
    if (!data || typeof data !== 'object') return [];
    if (data.type === 'FeatureCollection') return Array.isArray(data.features) ? data.features : [];
    if (data.type === 'Feature') return [data];
    return [];
  }

  async function _getSelectedGeojsonFeatureCache() {
    const layer = _activeGeojsonFeatureLayer();
    if (!layer?.data) return null;

    const cached = _selectedGeojsonFeaturesCache.get(layer.id);
    if (cached?.dataRef === layer.data) return cached.cache;

    const resolved = resolveLayerGeoJSON(layer, {
      topojson,
      resolvedCache: _settingsResolvedGeojsonCache,
    });
    if (!resolved) return null;

    const features = _extractGeojsonFeatures(resolved);
    const byId = new Map();
    const nameById = new Map();

    features.forEach((feature, idx) => {
      const id = _geojsonFeatureId(feature, idx);
      if (!id) return;
      byId.set(id, feature);
      nameById.set(id, _geojsonFeatureName(feature, idx));
    });

    const cache = { features, byId, nameById };
    _selectedGeojsonFeaturesCache.set(layer.id, { dataRef: layer.data, cache });
    return cache;
  }

  function _countryFeatureId(feature) {
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
  }

  function _countryFeatureName(feature) {
    const p = feature?.properties || {};
    return String(
      p.NAME_EN ||
      p.NAME ||
      p.ADMIN ||
      p.NAME_LONG ||
      p.name ||
      _countryFeatureId(feature) ||
      'Unknown'
    ).trim();
  }

  function _isCountryFeatureHitTestable(feature) {
    try {
      const area = d3.geoArea(feature);
      // Guard against malformed/complement polygons that effectively cover
      // most of the globe and cause ocean hover false positives.
      return Number.isFinite(area) && area > 0 && area <= (Math.PI * 1.5);
    } catch {
      return false;
    }
  }

  async function _getCountryFeatureCache(scale) {
    const key = _normalizeScale(scale, '50m');
    if (_countryFeaturesCache.has(key)) return _countryFeaturesCache.get(key);

    const outline = MAP_OUTLINES.find(o => o.id === `ne-countries-${key}`);
    if (!outline?.url) return null;

    try {
      const topology = await fetch(outline.url).then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      });
      const objKey = pickTopoObjectKey(topology, ['countries', 'country', 'admin0', 'ne_admin_0_countries']);
      if (!objKey) return null;
      const collection = topojson.feature(topology, topology.objects[objKey]);
      const features = collection?.type === 'FeatureCollection'
        ? (collection.features || [])
        : [collection].filter(Boolean);

      const byId = new Map();
      const nameById = new Map();
      for (const f of features) {
        if (!_isCountryFeatureHitTestable(f)) continue;
        const id = _countryFeatureId(f);
        if (!id) continue;
        byId.set(id, f);
        nameById.set(id, _countryFeatureName(f));
      }

      const cached = { scale: key, features, byId, nameById };
      _countryFeaturesCache.set(key, cached);
      return cached;
    } catch (err) {
      console.warn('Could not load country polygons:', err);
      return null;
    }
  }

  function _syncBasemapCountryInteractionRuntime() {
    const hoveredId = countryInteractionState.hoveredId();
    const selectedIds = Array.from(countryInteractionState.selectedIds());
    const activeGeojson = _activeGeojsonFeatureLayer();

    for (const layer of layers) {
      if (layer.type !== LAYER_TYPES.GEOJSON) continue;
      layer.runtime = layer.runtime || {};
      if (activeGeojson && layer.id === activeGeojson.id) {
        layer.runtime.hoveredFeatureId = hoveredId;
        layer.runtime.selectedFeatureIds = selectedIds;
      } else {
        delete layer.runtime.hoveredFeatureId;
        delete layer.runtime.selectedFeatureIds;
      }
    }

    const base = _activeBasemapLayer();
    if (base) {
      base.runtime = base.runtime || {};
      const featuresLayoutOnly = base.style?.featuresLayoutOnly === true;
      base.runtime.showBasemapFeatures = _layoutMode || !featuresLayoutOnly;
      base.runtime.showBasemapCountryPolygons = _layoutMode;
      if (_layoutMode) {
        base.runtime.hoveredFeatureId = hoveredId;
        base.runtime.selectedFeatureIds = selectedIds;
      } else {
        delete base.runtime.hoveredFeatureId;
        delete base.runtime.selectedFeatureIds;
      }
    }
  }

  function _countryStatusText() {
    return geojsonFeatureInteraction.statusText();
  }

  function _updateCountryStatusBar() {
    geojsonFeatureInteraction.updateStatusBar();
  }

  function _clearLayoutCountryInteraction({ keepSelection = false } = {}) {
    countryInteractionState.clear({ keepSelection });
    _syncBasemapCountryInteractionRuntime();
  }

  function _isCountryHoverEnabled() {
    if (_layoutMode) {
      const base = _activeBasemapLayer();
      if (!base || base.visible === false) return false;
      const s = base.style || {};
      if ((s.baseMode || 'globe') === 'geographic') {
        return s.geographicShowCountries !== false;
      }
      return s.showCountryBoundaries !== false;
    }
    const layer = _activeGeojsonFeatureLayer();
    return !!(layer && layer.visible !== false);
  }

  // ── Commands ─────────────────────────────────────────────────────────
  const commands = createCommands(root, COMMAND_DEFS);

  // ── Settings persistence ─────────────────────────────────────────────
  const storageKey = opts.storageKey ?? null;
  function _saveState() { if (storageKey) _saveSettings(storageKey, _serialize()); }

  function _serialize() {
    return {
      layers: layers.map(l => ({
        id: l.id, name: l.name, type: l.type,
        visible: l.visible, opacity: l.opacity, style: l.style,
      })),
      selectedId,
      layoutMode: _layoutMode,
      render: {
        canvasToSvgSwitchZoom: _canvasToSvgSwitchZoom,
      },
    };
  }

  function _setCanvasToSvgSwitchZoom(value) {
    const num = Number(value);
    const clamped = Math.max(
      RENDERER_MODE_LIMITS.canvasToSvgSwitchMin,
      Math.min(
        RENDERER_MODE_LIMITS.canvasToSvgSwitchMax,
        Number.isFinite(num) ? num : CANVAS_TO_SVG_THRESHOLD
      )
    );
    _canvasToSvgSwitchZoom = clamped;
  }

  function _getCanvasToSvgSwitchZoom() {
    return _canvasToSvgSwitchZoom;
  }

  function _autoGeojsonPerfPolicyForLayer(layer) {
    if (!layer || layer.type !== LAYER_TYPES.GEOJSON) return null;
    const resolved = resolveLayerGeoJSON(layer, {
      topojson,
      resolvedCache: _settingsResolvedGeojsonCache,
    });
    const featureCount = countGeoJSONFeatures(resolved);
    return autoGeojsonRenderPolicy(featureCount);
  }

  function _currentGeojsonSimplifyLevel(layer) {
    if (!layer || layer.type !== LAYER_TYPES.GEOJSON) return null;
    const stats = renderer.getGeoJSONRenderStats(layer.id);
    const simplifyLevel = Number(stats?.simplifyLevel);
    return Number.isFinite(simplifyLevel) ? simplifyLevel : null;
  }

  // ── Core UI bindings ─────────────────────────────────────────────────
  const { helpAbout } = initCoreUIBindings(root, {
    fetchContent: async (filename) => {
      try { const r = await fetch(filename); return r.ok ? r.text() : ''; }
      catch { return ''; }
    },
    helpFile: 'help.md',
    aboutFile: 'about.md',
    paletteEnabled: false,          // We use custom panels instead
    onPaletteStateChange: () => {},
  });

  // ── Map renderers ─────────────────────────────────────────────────────
  const svgEl    = $('map-svg');
  const canvasEl = $('map-canvas');

  const renderer = createMapRendererCore({
    svgElement: svgEl,
    canvasElement: canvasEl,
    d3,
    topojson,
    getLayers: () => _layersForRender(),
    onZoomChange: transform => {
      const effective = _constrainViewModeTransform(transform);
      if (effective !== transform) {
        mapViewport.withSuppressedHistory(() => {
          renderer.syncZoomTransform(effective);
        });
      }
      _updateSelectedGeoJSONStatus(effective.k);
      _recordZoomTransform(effective);
    },
    shouldForceCanvas: () => _layoutMode,
    shouldForceSvg: () => false,
    getCanvasToSvgThreshold: () => _getCanvasToSvgSwitchZoom(),
  });

  const mapViewport = createMapViewport({
    d3,
    onHistoryChange: _updateZoomNavButtons,
  });

  function _updateZoomNavButtons() {
    const back = $('btn-zoom-back');
    const fwd = $('btn-zoom-forward');
    if (back) back.disabled = !mapViewport.canGoBack();
    if (fwd) fwd.disabled = !mapViewport.canGoForward();
  }

  function _recordZoomTransform(transform, { immediate = false } = {}) {
    mapViewport.record(transform, { immediate });
  }

  function _viewportSize() {
    const wrapper = $('canvas-wrapper');
    return {
      width: wrapper?.clientWidth || 0,
      height: wrapper?.clientHeight || 0,
    };
  }

  function _frameRectForSize(size) {
    const frameStyle = layers.find(l => l.type === LAYER_TYPES.FRAME)?.style;
    return computeFrameRect(size.width, size.height, frameStyle);
  }

  function _transformClose(a, b, epsilon = 1e-6) {
    if (!a || !b) return false;
    return (
      Math.abs((a.k || 1) - (b.k || 1)) <= epsilon &&
      Math.abs((a.x || 0) - (b.x || 0)) <= epsilon &&
      Math.abs((a.y || 0) - (b.y || 0)) <= epsilon
    );
  }

  function _constrainViewModeTransform(transform) {
    if (_layoutMode || !mapViewport.hasViewConstraint()) return transform;
    const clamped = mapViewport.clampToViewConstraint(transform, _viewportSize());
    return _transformClose(clamped, transform) ? transform : clamped;
  }

  function _layersForRender() {
    if (!_layoutMode) return layers;
    const basemap = layers.find(layer => layer.type === LAYER_TYPES.BASEMAP);
    const frame = layers.find(layer => layer.type === LAYER_TYPES.FRAME);
    const layoutLayers = [];
    if (basemap) layoutLayers.push(basemap);
    if (frame) layoutLayers.push({ ...frame, visible: false });
    return layoutLayers;
  }

  function _applyHistoryTransform(index) {
    const target = mapViewport.getAt(index);
    if (!target) return;
    const constrained = _constrainViewModeTransform(target);
    mapViewport.withSuppressedHistory(() => {
      renderer.syncZoomTransform(constrained);
    });
    mapViewport.setIndex(index);
    _updateSelectedGeoJSONStatus(constrained.k);
    _queueRender();
  }

  function _resize() {
    const wrapper = $('canvas-wrapper');
    if (!wrapper) return;
    renderer.resize(wrapper.clientWidth, wrapper.clientHeight);
  }

  let _lastViewportSize = _viewportSize();
  let _resizePreserveScheduled = false;

  function _scheduleResizePreserveViewport() {
    if (_resizePreserveScheduled) return;
    _resizePreserveScheduled = true;
    requestAnimationFrame(async () => {
      _resizePreserveScheduled = false;
      await _handleResizePreserveViewport();
    });
  }

  async function _handleResizePreserveViewport() {
    const projectionBefore = renderer.getProjection?.();
    const transformBefore = renderer.getZoomTransform?.() || d3.zoomIdentity;
    const prevSize = _lastViewportSize;
    const prevFrameRect = _frameRectForSize(prevSize);
    const prevCenter = {
      x: prevFrameRect.x + (prevFrameRect.width / 2),
      y: prevFrameRect.y + (prevFrameRect.height / 2),
    };

    let anchorLonLat = null;
    if (projectionBefore?.invert && Number.isFinite(transformBefore.k) && transformBefore.k > 0) {
      const px = (prevCenter.x - transformBefore.x) / transformBefore.k;
      const py = (prevCenter.y - transformBefore.y) / transformBefore.k;
      anchorLonLat = projectionBefore.invert([px, py]);
    }

    await _render();

    if (!anchorLonLat || !Array.isArray(anchorLonLat)) return;

    const projectionAfter = renderer.getProjection?.();
    const projectedAfter = projectionAfter?.(anchorLonLat);
    if (!projectedAfter || !Number.isFinite(projectedAfter[0]) || !Number.isFinite(projectedAfter[1])) return;

    const newSize = _viewportSize();
    const newFrameRect = _frameRectForSize(newSize);
    const newCenter = {
      x: newFrameRect.x + (newFrameRect.width / 2),
      y: newFrameRect.y + (newFrameRect.height / 2),
    };

    const k = transformBefore.k || 1;
    const candidate = d3.zoomIdentity
      .translate(newCenter.x - (projectedAfter[0] * k), newCenter.y - (projectedAfter[1] * k))
      .scale(k);
    // During resize, the existing view constraint is based on the pre-resize
    // viewport/frame. Clamping against that stale constraint can produce large
    // jumps. Apply the preserved transform first, then rebuild constraint base.
    const corrected = candidate;

    mapViewport.withSuppressedHistory(() => {
      renderer.syncZoomTransform(corrected);
    });

    if (!_layoutMode) {
      mapViewport.setViewConstraintBase(corrected, newSize);
    }
    _updateSelectedGeoJSONStatus(corrected.k);
  }

  let _renderQueued = false;
  let _lastRenderDurationMs = 0;
  let _lastRendererBreakdown = null;
  let _lastGeojsonPerfConsoleAt = 0;
  let _geojsonPerfEmitCount = 0;
  let _geojsonPerfLastEmitAt = '';
  function _queueRender() {
    if (_renderQueued) return;
    _renderQueued = true;
    requestAnimationFrame(() => {
      _renderQueued = false;
      _render();
    });
  }
  window.addEventListener('resize', () => {
    _scheduleResizePreserveViewport();
  });

  const resizeObservedWrapper = $('canvas-wrapper');
  if (resizeObservedWrapper && typeof ResizeObserver !== 'undefined') {
    const wrapperResizeObserver = new ResizeObserver(() => {
      _scheduleResizePreserveViewport();
    });
    wrapperResizeObserver.observe(resizeObservedWrapper);
  }

  async function _render() {
    const renderStartedAt = (typeof performance !== 'undefined' && typeof performance.now === 'function')
      ? performance.now()
      : Date.now();
    _resize();
    _syncBasemapCountryInteractionRuntime();
    renderer.setLayers(_layersForRender());
    await renderer.render();
    _lastRendererBreakdown = renderer.getLastRenderBreakdown?.() || null;
    const renderEndedAt = (typeof performance !== 'undefined' && typeof performance.now === 'function')
      ? performance.now()
      : Date.now();
    _lastRenderDurationMs = Math.max(0, renderEndedAt - renderStartedAt);

    const selectedLayer = layers.find(l => l.id === selectedId);
    if (selectedLayer?.type === LAYER_TYPES.GEOJSON) {
      const selectedStats = renderer.getGeoJSONRenderStats(selectedLayer.id);
      let perfLayer = selectedLayer;
      let perfStats = selectedStats;

      // If selected GeoJSON has no fresh stats (e.g. hidden layer), report the
      // slowest visible GeoJSON layer so diagnostics stay actionable.
      if (!perfStats) {
        let slowest = null;
        for (const layer of layers) {
          if (layer.type !== LAYER_TYPES.GEOJSON || layer.visible === false) continue;
          const stats = renderer.getGeoJSONRenderStats(layer.id);
          if (!stats) continue;
          const total = Number(stats?.timingsMs?.total) || 0;
          if (!slowest || total > slowest.total) {
            slowest = { layer, stats, total };
          }
        }
        if (slowest) {
          perfLayer = slowest.layer;
          perfStats = slowest.stats;
        }
      }

      _maybeLogGeojsonPerfToConsole(perfLayer, perfStats, 'render');
    }

    _lastViewportSize = _viewportSize();
    _syncLayerRenderModeIndicators();
    _updateSelectedGeoJSONStatus();
  }

  // ── Create default base-map layer ────────────────────────────────────
  layerManager.initializeDefaults();
  selectedId = layers[0].id;

  // Restore saved state (layer styles only — data isn't persisted)
  const saved = loadSettings(storageKey);
  const isFirstLoad = !saved?.layers?.length;
  if (saved?.layers) {
    for (const sl of saved.layers) {
      const existing = layers.find(l => l.id === sl.id);
      if (existing) Object.assign(existing.style, sl.style);
    }
    for (const layer of layers) {
      const presetId = layer.style?.presetInstanceId;
      const match = typeof presetId === 'string' && presetId.match(/^preset-(\d+)$/);
      if (match) {
        _presetState.counter = Math.max(_presetState.counter, Number(match[1]) + 1);
      }
    }
    if (saved.selectedId) selectedId = saved.selectedId;
  }
  if (saved?.render?.canvasToSvgSwitchZoom != null) {
    _setCanvasToSvgSwitchZoom(saved.render.canvasToSvgSwitchZoom);
  }
  _ensureFixedBoundaryLayers();

  // ── Layer panel (left) ───────────────────────────────────────────────
  const layerPanel  = $('layer-panel');
  const layerList   = $('layer-list');
  const settingsPanel = $('settings-panel');
  const settingsPanelBody = $('settings-panel-body');
  const panelController = createPanelController({
    documentRef: document,
    windowRef: window,
    layerPanel,
    settingsPanel,
    layerPinButton: $('btn-layer-pin'),
    settingsPinButton: $('btn-settings-pin'),
  });
  panelController.bindUI({
    layerToggleButton: $('btn-layers'),
    layerCloseButton: $('btn-layer-close'),
    settingsToggleButton: $('btn-settings'),
    settingsCloseButton: $('btn-settings-close'),
  });

  _upgradeSettingsColourPickers();
  _installSliderReadouts();
  _configureFramePaddingControl();
  _configureGeojsonPerformanceControls();
  _populateGeographicRasterSetOptions();
  _discoverNaturalEarthRasterSets().catch(err => {
    console.warn('Could not discover Natural Earth raster sets:', err);
  });

  function _configureFramePaddingControl() {
    const input = $('set-fr-padding');
    if (!input) return;
    input.min = String(FRAME_PADDING_UI.min);
    input.max = String(FRAME_PADDING_UI.max);
    input.step = String(FRAME_PADDING_UI.step);
    if (!Number.isFinite(Number(input.value))) {
      input.value = String(FRAME_PADDING_UI.defaultValue);
    }
  }

  function _configureGeojsonPerformanceControls() {
    const minZoom = $('set-gj-min-zoom');
    if (minZoom) {
      minZoom.min = String(GEOJSON_LIMITS.renderPolicy.minZoomMin);
      minZoom.max = String(GEOJSON_LIMITS.renderPolicy.minZoomMax);
      if (!Number.isFinite(Number(minZoom.value))) minZoom.value = String(GEOJSON_LIMITS.renderPolicy.minZoomDefault);
    }

    const detail = $('set-gj-simplify');
    if (detail) {
      detail.min = '0';
      detail.max = '4';
      detail.step = '1';
      if (!Number.isFinite(Number(detail.value))) detail.value = '4';
    }
  }

  function _upgradeSettingsColourPickers() {
    if (!settingsPanelBody) return;
    upgradeAllPaletteColourPickers(settingsPanelBody, { palettes: CATEGORICAL_PALETTES });
  }

  function _installSliderReadouts() {
    if (!settingsPanelBody) return;
    const ranges = settingsPanelBody.querySelectorAll('input.form-range[type="range"]');
    for (const slider of ranges) {
      const row = slider.closest('.sx-setting-row');
      if (!row || row.querySelector('.sx-range-value')) continue;
      row.classList.add('has-range');
      const out = document.createElement('span');
      out.className = 'sx-range-value';
      row.appendChild(out);

      const update = () => {
        const stepStr = slider.getAttribute('step') || '';
        const decimals = (stepStr.includes('.') ? stepStr.split('.')[1].length : 0);
        const num = Number(slider.value);
        out.textContent = Number.isFinite(num) ? num.toFixed(Math.min(decimals, 3)) : slider.value;
      };

      slider.addEventListener('input', update);
      slider.addEventListener('change', update);
      update();
    }
  }

  // ── Layer list rendering ─────────────────────────────────────────────

  function _renderLayerList() {
    if (!layerList) return;
    layerList.innerHTML = '';
    const modeClass = renderer.isUsingCanvas() ? 'canvas' : 'svg';
    const modeLabel = renderer.isUsingCanvas() ? 'Canvas' : 'SVG';
    const reversed = [...layers].reverse();
    const frameFromList = reversed.find(layer => layer.type === LAYER_TYPES.FRAME) || null;
    const presetGroups = _groupPresetLayersForRender();
    const listLayers = _layoutMode
      ? [
          ...reversed.filter(layer => layer.type !== LAYER_TYPES.FRAME && !_isPresetFeatureLayer(layer)),
          ...presetGroups.map(group => ({
            id: group.id,
            type: 'preset-group',
            name: group.name,
            visible: group.featureLayers.some(layer => layer.visible !== false),
            presetGroup: group,
          })),
        ]
      : reversed.filter(layer => layer.type !== LAYER_TYPES.FRAME);
    if (frameFromList) listLayers.push(frameFromList);

    // Render top-most first, but keep the frame row at the bottom.
    for (const layer of listLayers) {
      const isPresetGroup = layer.type === 'preset-group';
      const presetGroup = isPresetGroup ? layer.presetGroup : null;
      const visLocked = layer.type === LAYER_TYPES.FRAME
        || isPresetGroup
        || (_layoutMode && layer.type === LAYER_TYPES.BASEMAP);
      const layoutLocked = _layoutMode && layer.type !== LAYER_TYPES.BASEMAP && !isPresetGroup;
      const isPresetFeature = !isPresetGroup && _isPresetFeatureLayer(layer);
      const showConfigButton = layer.type === LAYER_TYPES.BASEMAP || isPresetGroup || isPresetFeature;
      const rowColor = isPresetGroup ? presetGroup.color : (layer.style?.presetColor || '');
      const el = document.createElement('div');
      el.className = 'sx-layer-item'
        + (layer.id === selectedId ? ' selected' : '')
        + (layoutLocked ? ' layout-locked' : '')
        + (isPresetGroup ? ' preset-group-row' : '')
        + (isPresetFeature ? ' preset-feature-row' : '');
      el.dataset.layerId = layer.id;
      el.dataset.presetInstanceId = isPresetGroup ? presetGroup.id : (layer.style?.presetInstanceId || '');
      el.innerHTML = `
        <button class="sx-layer-vis ${layer.visible ? '' : 'off'} ${visLocked || layoutLocked ? 'disabled' : ''}" data-vis="${layer.id}" title="${visLocked ? 'Visibility locked' : layoutLocked ? 'Hidden in Layout Mode' : 'Toggle visibility'}" ${visLocked || layoutLocked ? 'disabled' : ''}>
          <i class="bi ${layer.visible ? 'bi-eye' : 'bi-eye-slash'}"></i>
        </button>
        <i class="bi ${isPresetGroup ? 'bi-stack' : (LAYER_ICONS[layer.type] || 'bi-square')} sx-layer-icon"></i>
        ${rowColor ? `<span class="sx-preset-color-dot" style="background:${_escapeHtml(rowColor)}"></span>` : ''}
        <span class="sx-render-mode-indicator ${modeClass}" title="Rendered via ${modeLabel}" aria-label="Rendered via ${modeLabel}"></span>
        <span class="sx-layer-name">${_escapeHtml(layer.name)}</span>
        ${isPresetGroup ? `<span class="sx-layer-meta">${_escapeHtml((presetGroup.featureLayers || []).map(feature => feature.name).join(', '))}</span>` : ''}
        ${showConfigButton ? `<button class="sx-layer-action-btn" data-layer-config="${layer.id}" title="Configure layer preset">Config</button>` : ''}
        ${isPresetGroup ? `<button class="sx-layer-action-btn" data-layer-remove-preset="${presetGroup.id}" title="Remove this preset">Remove</button>` : ''}`;
      layerList.appendChild(el);
    }
    _updateLayerButtons();
  }

  function _syncLayerRenderModeIndicators() {
    const modeClass = renderer.isUsingCanvas() ? 'canvas' : 'svg';
    const modeLabel = renderer.isUsingCanvas() ? 'Canvas' : 'SVG';
    layerList?.querySelectorAll('.sx-render-mode-indicator').forEach(indicator => {
      indicator.classList.toggle('canvas', modeClass === 'canvas');
      indicator.classList.toggle('svg', modeClass === 'svg');
      indicator.title = `Rendered via ${modeLabel}`;
      indicator.setAttribute('aria-label', `Rendered via ${modeLabel}`);
    });
  }

  function _frameIndex() {
    return layerManager.frameIndex();
  }

  function _baseIndex() {
    return layerManager.baseIndex();
  }

  function _ensureFixedBoundaryLayers() {
    layerManager.ensureFixedBoundaryLayers();
  }

  const _presetState = {
    catalog: { version: 1, presets: [] },
    manifests: new Map(),
    topologyByFolder: new Map(),
    modal: {
      mode: 'browse',
      manifest: null,
      source: null,
      featureSelection: new Set(),
      detailSelection: new Set(),
      detailRows: [],
      editGroup: null,
      operationToken: 0,
      activeOperationToken: null,
      canceledOperationTokens: new Set(),
      progressReturnMode: 'browse',
    },
    counter: 1,
  };

  void (async () => {
    _presetState.catalog = await loadPresetCatalog({ fetchImpl: fetch });
    await _rehydratePresetLayersFromState();
    _ensureFixedBoundaryLayers();
    _renderLayerList();
    _showSettingsForLayer(selectedId);
    _queueRender();
  })();

  async function _rehydratePresetLayersFromState() {
    const presetLayers = layers.filter(layer => _isPresetFeatureLayer(layer));
    if (!presetLayers.length) return;

    if (!Array.isArray(_presetState.catalog?.presets) || !_presetState.catalog.presets.length) {
      _presetState.catalog = await loadPresetCatalog({ fetchImpl: fetch });
    }

    for (const layer of presetLayers) {
      const folder = layer.style?.presetFolder || layer.style?.presetKey;
      if (!folder) continue;

      let manifest = _presetState.manifests.get(folder);
      if (!manifest) {
        const entry = _presetState.catalog.presets.find(item => item.folder === folder) || { folder };
        manifest = await _loadPresetEntry(entry);
      }
      if (!manifest) continue;

      let source = _presetState.topologyByFolder.get(folder);
      if (!source) {
        source = await loadPresetTopologySource({ fetchImpl: fetch, manifest });
        if (source) _presetState.topologyByFolder.set(folder, source);
      }
      if (!source) continue;

      const featureKey = String(layer.style?.presetFeatureKey || '').toLowerCase();
      const objectName = manifest.objects?.[featureKey] || manifest.objects?.[layer.style?.presetFeatureLabel] || featureKey;
      layer.data = {
        ...source,
        objectName,
      };
    }
  }

  function _presetInstanceIdForLayer(layer) {
    return layer?.style?.presetInstanceId || null;
  }

  function _isPresetFeatureLayer(layer) {
    return !!_presetInstanceIdForLayer(layer);
  }

  function _groupPresetLayersForRender() {
    return groupPresetLayers(layers);
  }

  function _findPresetGroupByLayerId(layerId) {
    const directGroup = _groupPresetLayersForRender().find(group => group.id === layerId);
    if (directGroup) return directGroup;
    const layer = layers.find(item => item.id === layerId);
    const instanceId = _presetInstanceIdForLayer(layer);
    if (!instanceId) return null;
    return _groupPresetLayersForRender().find(group => group.id === instanceId) || null;
  }

  function _presetFeatureRowsFromManifest(manifest) {
    return Array.isArray(manifest?.features) ? manifest.features : [];
  }

  function _presetSwitchZoomBoundary(rank) {
    const exponent = Math.max(0, 8 - (Math.max(0, Number(rank) || 0) * 0.5));
    return Math.max(1, Math.round((2 ** exponent) * 100) / 100);
  }

  function _presetDetailRowsFromManifest(manifest) {
    const levels = Array.isArray(manifest?.detailLevels) ? manifest.detailLevels : [];
    const normalized = levels
      .map(level => ({
        ...level,
        level: Number(level?.level),
      }))
      .filter(level => Number.isFinite(level.level))
      .sort((a, b) => a.level - b.level);

    return normalized.map((level, index) => ({
      ...level,
      switchZoom: _presetSwitchZoomBoundary(index),
    }));
  }

  function _presetDefaultName(manifest) {
    return manifest?.name || manifest?.title || manifest?.folder || 'Preset Layer';
  }

  function _presetDefaultColor(manifest) {
    const color = manifest?.color || manifest?.accentColor || '';
    return color || '#2aa198';
  }

  function _presetInstanceName(manifest, overrideName = '') {
    return overrideName?.trim() || _presetDefaultName(manifest);
  }

  function _presetInstanceCountPrefix() {
    const current = _presetState.counter++;
    return `preset-${current}`;
  }

  function _presetSelectedFeatures(manifest) {
    return new Set(_presetFeatureRowsFromManifest(manifest).map(feature => String(feature.key || '').toLowerCase()));
  }

  function _presetSelectedDetails(manifest) {
    return new Set(_presetDetailRowsFromManifest(manifest).map(level => Number(level.level)));
  }

  function _presetConfigToSelection() {
    return {
      features: [..._presetState.modal.featureSelection],
      detailLevels: _presetState.modal.detailRows
        .filter(row => row.enabled)
        .map(row => ({
          level: row.level,
          label: row.label,
          switchZoom: row.switchZoom,
        })),
    };
  }

  function _presetModalSetFooterMode(mode) {
    const isBrowse = mode === 'browse';
    const isConfig = mode === 'config';
    const browseCancel = $('btn-preset-cancel');
    const browseReset = $('btn-preset-reset');
    const browseApply = $('btn-preset-apply');
    const configCancel = $('btn-preset-config-cancel');
    const configAdd = $('btn-preset-add');

    if (browseCancel) browseCancel.style.display = isBrowse ? '' : 'none';
    if (browseReset) browseReset.style.display = isBrowse ? '' : 'none';
    if (browseApply) browseApply.style.display = isBrowse ? '' : 'none';
    if (configCancel) configCancel.style.display = isConfig ? '' : 'none';
    if (configAdd) configAdd.style.display = isConfig ? '' : 'none';
  }

  function _presetOperationIsCanceled(token) {
    if (!Number.isFinite(token)) return false;
    return _presetState.modal.canceledOperationTokens.has(token)
      || _presetState.modal.activeOperationToken !== token;
  }

  function _presetModalRestore(mode = 'browse') {
    const browser = $('preset-browser-section');
    const config = $('preset-config-section');
    const progress = $('preset-progress-section');
    if (progress) progress.style.display = 'none';

    if (mode === 'config' && _presetState.modal.manifest) {
      _presetState.modal.mode = 'config';
      if (browser) browser.style.display = 'none';
      if (config) config.style.display = '';
      _presetModalSetFooterMode('config');
      const addButton = $('btn-preset-add');
      if (addButton) {
        addButton.disabled = false;
        addButton.textContent = _presetState.modal.editGroup ? 'Save' : 'Add';
      }
      _presetModalSetVisible('config');
      return;
    }

    _presetModalShowBrowse();
  }

  function _presetModalBeginProgress(message, { returnMode = 'config' } = {}) {
    const browser = $('preset-browser-section');
    const config = $('preset-config-section');
    const progress = $('preset-progress-section');
    const progressMessage = $('preset-progress-message');
    if (browser) browser.style.display = 'none';
    if (config) config.style.display = 'none';
    if (progress) progress.style.display = '';
    if (progressMessage) progressMessage.textContent = message || 'Working...';
    _presetState.modal.mode = 'progress';
    _presetState.modal.progressReturnMode = returnMode;
    _presetModalSetFooterMode('progress');
    _presetModalSetVisible('progress');

    const token = ++_presetState.modal.operationToken;
    _presetState.modal.activeOperationToken = token;
    _presetState.modal.canceledOperationTokens.delete(token);
    return token;
  }

  function _presetWaitForPaint() {
    return new Promise(resolve => {
      if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(() => resolve());
      } else {
        setTimeout(resolve, 0);
      }
    });
  }

  function _presetModalCancelActiveOperation({ restore = true } = {}) {
    const token = _presetState.modal.activeOperationToken;
    if (Number.isFinite(token)) {
      _presetState.modal.canceledOperationTokens.add(token);
    }
    _presetState.modal.activeOperationToken = null;

    if (restore) {
      _presetModalRestore(_presetState.modal.progressReturnMode || 'browse');
    }
  }

  function _presetModalCompleteOperation(token, { restoreMode = 'browse' } = {}) {
    if (_presetOperationIsCanceled(token)) return false;
    _presetState.modal.activeOperationToken = null;
    _presetState.modal.canceledOperationTokens.delete(token);
    _presetModalRestore(restoreMode);
    return true;
  }

  function _presetFolderAdded(folder) {
    if (!folder) return false;
    return _groupPresetLayersForRender().some(group => String(group.folder || '') === String(folder));
  }

  async function _renderPresetBrowserList() {
    const browser = $('preset-browser-list');
    if (!browser) return;

    browser.innerHTML = '<div class="text-muted" style="padding:8px">Loading presets…</div>';
    const presets = Array.isArray(_presetState.catalog?.presets) ? _presetState.catalog.presets : [];
    const manifestRows = await Promise.all(presets.map(async preset => ({
      preset,
      manifest: await _loadPresetEntry(preset),
    })));

    browser.innerHTML = '';
    for (const entry of manifestRows) {
      const preset = entry.preset;
      const manifest = entry.manifest || preset;
      const folder = String(manifest.folder || preset.folder || '');
      const features = Array.isArray(manifest.features) ? manifest.features : [];
      const levels = _presetDetailRowsFromManifest(manifest);
      const isAdded = _presetFolderAdded(folder);

      const card = document.createElement('div');
      card.className = `preset-browser-card${isAdded ? ' is-added' : ''}`;
      card.innerHTML = `
        <div class="preset-browser-card-head">
          <div>
            <div class="preset-browser-title">
              ${manifest.logo ? (String(manifest.logo).startsWith('bi-') ? `<i class="bi ${_escapeHtml(manifest.logo)}"></i>` : _escapeHtml(manifest.logo)) : ''}
              <span>${_escapeHtml(manifest.name || manifest.title || folder || 'Preset')}</span>
            </div>
            <div class="preset-browser-subtitle">${_escapeHtml(manifest.description || preset.description || '')}</div>
          </div>
          <button class="btn btn-sm btn-primary" data-preset-add="${_escapeHtml(folder)}" ${isAdded ? 'disabled' : ''}>${isAdded ? 'Added' : 'Add'}</button>
        </div>
        <div class="preset-browser-meta">
          <span class="badge text-bg-secondary">${_escapeHtml(folder || 'No folder')}</span>
          <span class="badge text-bg-secondary">${_escapeHtml(manifest.license?.name || manifest.license || preset.license?.name || preset.license || 'No license')}</span>
          <span class="badge text-bg-dark">${_escapeHtml(`${levels.length} detail levels`)}</span>
        </div>
        <div class="preset-browser-features">
          ${features.map(feature => `<span class="badge text-bg-info">${_escapeHtml(feature.label || feature.name || feature.key || 'Feature')}</span>`).join('')}
        </div>`;
      browser.appendChild(card);
    }

    browser.querySelectorAll('[data-preset-add]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const originalText = btn.textContent || 'Add';
        btn.disabled = true;
        btn.textContent = 'Loading...';
        const folder = btn.dataset.presetAdd;
        const presetEntry = _presetState.catalog.presets.find(item => item.folder === folder);
        try {
          if (!presetEntry) {
            $('status-stats').textContent = 'Preset entry could not be found.';
            return;
          }
          const manifest = await _loadPresetEntry(presetEntry);
          if (!manifest) {
            $('status-stats').textContent = `Could not load preset manifest: ${folder}`;
            return;
          }
          _presetModalShowConfig(manifest, {
            instanceName: _presetInstanceName(manifest),
          });
          if (!_presetState.modal.source) {
            void loadPresetTopologySource({ fetchImpl: fetch, manifest }).then(source => {
              if (!source) return;
              if (_presetState.modal.manifest?.folder === manifest.folder) {
                _presetState.modal.source = source;
              }
              if (manifest.folder) {
                _presetState.topologyByFolder.set(manifest.folder, source);
              }
            }).catch(err => {
              console.warn('Could not prefetch preset topology source:', err);
            });
          }
        } catch (err) {
          console.error('Failed to open preset configuration:', err);
          $('status-stats').textContent = 'Could not open preset configuration.';
          btn.disabled = false;
          btn.textContent = originalText;
        }
      });
    });
  }

  function _presetModalSetVisible(mode) {
    const overlay = $('preset-layer-overlay');
    if (!overlay) return;
    const isVisible = mode !== 'none' && !!mode;
    overlay.classList.toggle('open', isVisible);
    overlay.style.display = isVisible ? '' : 'none';
    overlay.dataset.mode = isVisible ? mode : 'none';
  }

  function _presetModalShowBrowse() {
    _presetState.modal.mode = 'browse';
    _presetState.modal.manifest = null;
    _presetState.modal.source = null;
    _presetState.modal.featureSelection = new Set();
    _presetState.modal.detailSelection = new Set();
    _presetState.modal.detailRows = [];
    _presetState.modal.editGroup = null;
    const browser = $('preset-browser-section');
    const config = $('preset-config-section');
    const progress = $('preset-progress-section');
    if (browser) browser.style.display = '';
    if (config) config.style.display = 'none';
    if (progress) progress.style.display = 'none';
    _presetModalSetFooterMode('browse');
    _presetModalSetVisible('browse');
    void _renderPresetBrowserList();
  }

  function _presetModalShowConfig(manifest, { instanceName = '', selectedFeatures = null, selectedDetails = null, detailRows = null, editGroup = null } = {}) {
    if (!manifest) return;
    _presetState.modal.mode = 'config';
    _presetState.modal.manifest = manifest;
    _presetState.modal.source = manifest.folder
      ? (_presetState.topologyByFolder.get(manifest.folder) || null)
      : null;
    _presetState.modal.editGroup = editGroup;
    _presetState.modal.featureSelection = selectedFeatures instanceof Set ? new Set(selectedFeatures) : _presetSelectedFeatures(manifest);
    _presetState.modal.detailSelection = selectedDetails instanceof Set ? new Set(selectedDetails) : _presetSelectedDetails(manifest);
    const sourceDetailRows = Array.isArray(detailRows) && detailRows.length
      ? detailRows
      : _presetDetailRowsFromManifest(manifest);
    _presetState.modal.detailRows = sourceDetailRows.map(row => ({
      level: Number(row.level),
      label: String(row.label || `Level ${row.level}`),
      switchZoom: Number(row.switchZoom) || 1,
      enabled: _presetState.modal.detailSelection.has(Number(row.level)),
    }));

    const browser = $('preset-browser-section');
    const config = $('preset-config-section');
    const progress = $('preset-progress-section');
    const nameInput = $('preset-instance-name');
    const label = $('preset-instance-label');
    const folder = $('preset-instance-folder');
    const license = $('preset-instance-license');
    const description = $('preset-instance-description');

    if (browser) browser.style.display = 'none';
    if (config) config.style.display = '';
    if (progress) progress.style.display = 'none';
    _presetModalSetFooterMode('config');
    const addButton = $('btn-preset-add');
    if (addButton) {
      addButton.disabled = false;
      addButton.textContent = editGroup ? 'Save' : 'Add';
    }
    if (nameInput) nameInput.value = _presetInstanceName(manifest, instanceName);
    if (label) label.textContent = _presetDefaultName(manifest);
    if (folder) folder.textContent = manifest.folder || '';
    if (description) description.setAttribute('title', manifest.description || '');
    if (license) license.textContent = manifest.license?.name || manifest.license || '';
    if (description) description.textContent = manifest.description || '';

    _presetModalSetVisible('config');
    _renderPresetModalFeatureList();
    _renderPresetModalDetailList();
  }

  function _renderPresetModalFeatureList() {
    const container = $('preset-feature-list');
    if (!container) return;
    const manifest = _presetState.modal.manifest;
    const features = _presetFeatureRowsFromManifest(manifest);
    container.innerHTML = '';
    for (const feature of features) {
      const key = String(feature.key || '').toLowerCase();
      const row = document.createElement('label');
      row.className = 'preset-feature-item';
      row.innerHTML = `
        <input type="checkbox" class="form-check-input me-2" data-preset-feature="${_escapeHtml(feature.key || '')}" ${_presetState.modal.featureSelection.has(key) ? 'checked' : ''} />
        <span class="preset-feature-swatch" style="background:${_escapeHtml(feature.color || _presetDefaultColor(manifest))}"></span>
        <span class="preset-feature-name">${_escapeHtml(feature.label || feature.name || feature.key || 'Feature')}</span>
        <span class="preset-feature-meta">${_escapeHtml(feature.description || '')}</span>`;
      container.appendChild(row);
    }

    container.querySelectorAll('[data-preset-feature]').forEach(input => {
      input.addEventListener('change', () => {
        const value = String(input.dataset.presetFeature || '').toLowerCase();
        if (input.checked) _presetState.modal.featureSelection.add(value);
        else _presetState.modal.featureSelection.delete(value);
      });
    });
  }

  function _renderPresetModalDetailList() {
    const body = $('preset-detail-list');
    if (!body) return;
    body.innerHTML = '';
    for (const rowData of _presetState.modal.detailRows) {
      const row = document.createElement('tr');
      row.innerHTML = `
        <td><input type="checkbox" class="form-check-input" data-preset-detail-enabled="${rowData.level}" ${rowData.enabled ? 'checked' : ''} /></td>
        <td>${_escapeHtml(String(rowData.level))}</td>
        <td><input type="number" class="form-control form-control-sm" data-preset-detail-zoom="${rowData.level}" min="1" max="256" step="0.01" value="${_escapeHtml(String(rowData.switchZoom))}" /></td>
        <td>${_escapeHtml(rowData.label || `Level ${rowData.level}`)}</td>`;
      body.appendChild(row);
    }

    body.querySelectorAll('[data-preset-detail-enabled]').forEach(input => {
      input.addEventListener('change', () => {
        const level = Number(input.dataset.presetDetailEnabled);
        const row = _presetState.modal.detailRows.find(item => item.level === level);
        if (row) row.enabled = input.checked;
      });
    });

    body.querySelectorAll('[data-preset-detail-zoom]').forEach(input => {
      input.addEventListener('input', () => {
        const level = Number(input.dataset.presetDetailZoom);
        const row = _presetState.modal.detailRows.find(item => item.level === level);
        if (row) row.switchZoom = Math.max(1, Number(input.value) || 1);
      });
    });
  }

  async function _loadPresetEntry(entry) {
    if (!entry?.folder) return null;
    if (_presetState.manifests.has(entry.folder)) return _presetState.manifests.get(entry.folder);

    const manifest = await loadPresetManifest({ fetchImpl: fetch, folder: entry.folder });
    if (!manifest) return null;
    _presetState.manifests.set(entry.folder, manifest);
    return manifest;
  }

  function _closePresetModal() {
    _presetModalCancelActiveOperation({ restore: false });
    _presetModalSetVisible('none');
    _renderLayerList();
  }

  async function _applyPresetSelection({ operationToken = null } = {}) {
    const manifest = _presetState.modal.manifest;
    if (!manifest) return false;
    if (_presetOperationIsCanceled(operationToken)) return false;
    const selection = _presetConfigToSelection();
    const featureRows = resolvePresetFeatureSelection(manifest, selection);
    const detailRows = resolvePresetDetailSelection(manifest, selection);
    if (!featureRows.length || !detailRows.length) {
      $('status-stats').textContent = 'Select at least one feature and one detail level.';
      return false;
    }

    const cachedSource = manifest.folder ? _presetState.topologyByFolder.get(manifest.folder) : null;
    if (!_presetState.modal.source && !cachedSource) {
      $('status-stats').textContent = `Loading preset source: ${manifest.name || manifest.folder}`;
    }
    const source = _presetState.modal.source
      || cachedSource
      || await loadPresetTopologySource({ fetchImpl: fetch, manifest });
    if (_presetOperationIsCanceled(operationToken)) return false;
    if (!source) {
      $('status-stats').textContent = `Could not load preset source: ${manifest.name || manifest.folder}`;
      return false;
    }
    _presetState.modal.source = source;
    if (manifest.folder) {
      _presetState.topologyByFolder.set(manifest.folder, source);
    }

    const instanceName = _presetInstanceName(manifest, $('preset-instance-name')?.value || '');
    const existingGroup = _presetState.modal.editGroup;
    const instanceId = existingGroup?.id || _presetInstanceCountPrefix();
    const presetColor = _presetDefaultColor(manifest);
    const featureLayers = buildPresetFeatureLayers({
      createLayer,
      layerTypes: LAYER_TYPES,
      manifest,
      topologySource: source,
      presetInstanceId: instanceId,
      presetInstanceName: instanceName,
      presetColor,
      features: featureRows,
      detailLevels: detailRows,
    });

    if (!featureLayers.length) {
      $('status-stats').textContent = 'No preset layers were created.';
      return false;
    }
    if (_presetOperationIsCanceled(operationToken)) return false;

    if (existingGroup) {
      for (const featureLayer of existingGroup.featureLayers) {
        layerManager.deleteById(featureLayer.id);
      }
    }

    const totalLayers = featureLayers.length;
    const insertedLayerIds = new Set();
    for (let index = 0; index < totalLayers; index += 1) {
      if (_presetOperationIsCanceled(operationToken)) return false;
      const layer = featureLayers[index];
      layerManager.insertBeforeFrame(layer);
      insertedLayerIds.add(layer.id);

      const progressMessage = $('preset-progress-message');
      if (progressMessage) {
        progressMessage.textContent = `Adding layers ${index + 1}/${totalLayers}...`;
      }

      if ((index + 1) < totalLayers && ((index + 1) % 6 === 0)) {
        await _presetWaitForPaint();
      }
    }

    // Defensive integrity pass: ensure every created preset layer exists in the
    // live layer array. If anything is missing, repair before rendering UI.
    const missingLayers = featureLayers.filter(layer => !layers.some(item => item.id === layer.id));
    if (missingLayers.length) {
      for (const layer of missingLayers) {
        layerManager.insertBeforeFrame(layer);
        insertedLayerIds.add(layer.id);
      }
      console.warn('Preset add repaired missing layer insertions.', {
        expected: totalLayers,
        repaired: missingLayers.length,
      });
    }

    if (![...insertedLayerIds].some(id => layers.some(item => item.id === id))) {
      $('status-stats').textContent = 'Preset layers were not inserted. Please try again.';
      return false;
    }

    selectedId = featureLayers[0].id;
    _ensureFixedBoundaryLayers();
    _renderLayerList();
    _showSettingsForLayer(selectedId);
    _render();
    _saveState();
    $('status-stats').textContent = `${existingGroup ? 'Updated' : 'Added'} preset: ${instanceName}`;
    return true;
  }

  layerList?.addEventListener('click', async e => {
    const configBtn = e.target.closest('[data-layer-config]');
    if (configBtn) {
      const group = _findPresetGroupByLayerId(configBtn.dataset.layerConfig);
      const layer = layers.find(item => item.id === configBtn.dataset.layerConfig);
      if (group) {
        const presetEntry = _presetState.catalog.presets.find(item => item.folder === group.folder) || null;
        const manifest = _presetState.manifests.get(group.folder) || await _loadPresetEntry(presetEntry || { folder: group.folder });
        if (manifest) {
          _presetModalShowConfig(manifest, {
            instanceName: group.name,
            selectedFeatures: new Set(group.featureLayers.map(feature => String(feature.style?.presetFeatureKey || '').toLowerCase())),
            selectedDetails: new Set((group.featureLayers[0]?.style?.detailLevels || []).map(level => Number(level.level))),
            detailRows: group.featureLayers[0]?.style?.detailLevels || null,
            editGroup: group,
          });
        }
      } else if (layer?.type === LAYER_TYPES.BASEMAP) {
        _enterLayoutMode();
      }
      return;
    }
    const removePresetBtn = e.target.closest('[data-layer-remove-preset]');
    if (removePresetBtn) {
      const group = _groupPresetLayersForRender().find(item => item.id === removePresetBtn.dataset.layerRemovePreset);
      if (!group) return;
      for (const featureLayer of group.featureLayers) {
        layerManager.deleteById(featureLayer.id);
      }
      if (selectedId && group.featureLayers.some(layer => layer.id === selectedId)) {
        selectedId = layers.find(layer => layer.type === LAYER_TYPES.BASEMAP)?.id || null;
      }
      _ensureFixedBoundaryLayers();
      _renderLayerList();
      _render();
      _saveState();
      return;
    }
    // Visibility toggle
    const visBtn = e.target.closest('[data-vis]');
    if (visBtn) {
      const layer = layers.find(l => l.id === visBtn.dataset.vis);
      if (layer) {
        const visLocked = layer.type === LAYER_TYPES.FRAME
          || (_layoutMode && layer.type === LAYER_TYPES.BASEMAP);
        const nextVisible = visLocked ? true : !layer.visible;
        const prevVisible = layer.visible;
        layer.visible = nextVisible;

        let applied = false;
        if (prevVisible !== nextVisible) {
          applied = renderer.setLayerVisibility(layer.id, nextVisible);
        }

        _renderLayerList();
        if (!applied || nextVisible) _render();
        _updateSelectedGeoJSONStatus();
        _saveState();
      }
      return;
    }
    // Select
    const item = e.target.closest('.sx-layer-item');
    if (item) {
      if (item.dataset.presetInstanceId && _layoutMode) return;
      const layer = layers.find(l => l.id === item.dataset.layerId);
      // In layout mode only the basemap layer is selectable
      if (_layoutMode && layer?.type !== LAYER_TYPES.BASEMAP) return;
      selectedId = item.dataset.layerId;
      _renderLayerList();
      _showSettingsForLayer(selectedId);
      _updateSelectedGeoJSONStatus();
    }
  });

  function _updateLayerButtons() {
    const sel = layers.find(l => l.id === selectedId);
    const isLocked = _isLockedLayer(sel);
    $('btn-delete-layer').disabled  = _layoutMode || !sel || isLocked;
    $('btn-dup-layer').disabled     = _layoutMode || !sel || sel?.type === LAYER_TYPES.FRAME;
    const idx = layers.findIndex(l => l.id === selectedId);
    const minMovableIdx = Math.max(1, _baseIndex() + 1);
    const maxMovableIdx = Math.max(minMovableIdx, _frameIndex() - 1);
    $('btn-move-up').disabled   = _layoutMode || idx < 0 || isLocked || idx >= maxMovableIdx;
    $('btn-move-down').disabled = _layoutMode || idx < 0 || isLocked || idx <= minMovableIdx;
  }

  // Layer CRUD buttons
  $('btn-delete-layer')?.addEventListener('click', () => {
    const current = layerManager.findById(selectedId);
    if (!current || _isLockedLayer(current)) return;
    const result = layerManager.deleteById(selectedId);
    if (!result) return;
    const idx = result.index;
    selectedId = layers[Math.min(idx, layers.length - 1)]?.id || null;
    _renderLayerList(); _showSettingsForLayer(selectedId); _render(); _saveState();
  });

  $('btn-dup-layer')?.addEventListener('click', () => {
    const src = layerManager.findById(selectedId);
    if (!src || src.type === LAYER_TYPES.FRAME) return;
    const dup = layerManager.duplicateById(selectedId);
    if (!dup) return;
    selectedId = dup.id;
    _renderLayerList(); _showSettingsForLayer(selectedId); _render(); _saveState();
  });

  $('btn-move-up')?.addEventListener('click', () => _moveLayer(1));
  $('btn-move-down')?.addEventListener('click', () => _moveLayer(-1));

  function _moveLayer(dir) {
    const current = layerManager.findById(selectedId);
    if (!current || _isLockedLayer(current)) return;
    if (!layerManager.moveById(selectedId, dir)) return;
    _renderLayerList(); _render(); _saveState();
  }

  // ── Add layer preset modal ────────────────────────────────────────────
  async function _openPresetModal() {
    if (!_presetState.catalog?.presets?.length) {
      _presetState.catalog = await loadPresetCatalog({ fetchImpl: fetch });
    }

    _presetModalShowBrowse();
  }

  $('btn-add-toolbar')?.addEventListener('click', e => {
    e.stopPropagation();
    _openPresetModal();
  });
  $('btn-add-layer')?.addEventListener('click', e => {
    e.stopPropagation();
    _openPresetModal();
  });
  $('btn-preset-cancel')?.addEventListener('click', () => _closePresetModal());
  $('btn-preset-reset')?.addEventListener('click', () => _closePresetModal());
  $('btn-preset-apply')?.addEventListener('click', () => _closePresetModal());
  $('btn-preset-config-cancel')?.addEventListener('click', () => _presetModalShowBrowse());
  $('btn-preset-progress-cancel')?.addEventListener('click', () => {
    _presetModalCancelActiveOperation({ restore: true });
    $('status-stats').textContent = 'Preset operation canceled.';
  });
  $('btn-preset-add')?.addEventListener('click', async () => {
    const button = $('btn-preset-add');
    if (!button) {
      const token = _presetModalBeginProgress('Adding preset layers…', { returnMode: 'config' });
      await _presetWaitForPaint();
      const ok = await _applyPresetSelection({ operationToken: token });
      if (ok) {
        _presetModalCompleteOperation(token, { restoreMode: 'browse' });
        _renderLayerList();
      }
      return;
    }
    const originalText = button.textContent || 'Add';
    button.disabled = true;
    button.textContent = 'Adding...';
    try {
      const token = _presetModalBeginProgress('Adding preset layers…', { returnMode: 'config' });
      await _presetWaitForPaint();
      const ok = await _applyPresetSelection({ operationToken: token });
      if (ok) {
        _presetModalCompleteOperation(token, { restoreMode: 'browse' });
        _renderLayerList();
      } else if (!_presetOperationIsCanceled(token)) {
        _presetModalCompleteOperation(token, { restoreMode: 'config' });
        button.disabled = false;
        button.textContent = originalText;
      } else {
        button.disabled = false;
        button.textContent = originalText;
      }
    } catch (err) {
      console.error('Failed to add preset selection:', err);
      $('status-stats').textContent = 'Could not add preset selection.';
      _presetModalCancelActiveOperation({ restore: true });
      button.disabled = false;
      button.textContent = originalText;
    }
  });
  $('btn-preset-import')?.addEventListener('click', () => {
    _closePresetModal();
    _openImportModal('auto');
  });
  $('btn-preset-layer-close')?.addEventListener('click', () => _closePresetModal());
  $('preset-layer-overlay')?.addEventListener('click', e => {
    if (e.target?.id === 'preset-layer-overlay') _closePresetModal();
  });

  // ── Settings panel wiring ────────────────────────────────────────────

  const SETTINGS_SECTIONS = ['settings-basemap', 'settings-frame', 'settings-geojson', 'settings-points', 'settings-tree'];
  const basemapStatusController = createBasemapStatusController({
    getEl: $,
    getLayers: () => layers,
    layerTypes: LAYER_TYPES,
    getZoomTransform: () => renderer.getZoomTransform?.(),
    isGeographicRasterMode: _isGeographicRasterMode,
    normalizeScale: _normalizeScale,
  });

  function _updateBasemapReadonlyPanel(zoomK = null) {
    basemapStatusController.updateBasemapReadonlyPanel(zoomK);
  }

  function _simplifyLevelToDetailPercent(simplifyLevel) {
    const level = Math.max(
      GEOJSON_LIMITS.simplifyLevel.min,
      Math.min(GEOJSON_LIMITS.simplifyLevel.max, Math.round(Number(simplifyLevel) || 0))
    );
    const simplifySpan = GEOJSON_LIMITS.simplifyLevel.max - GEOJSON_LIMITS.simplifyLevel.min;
    const detailSpan = GEOJSON_LIMITS.detailPercent.max - GEOJSON_LIMITS.detailPercent.min;
    if (simplifySpan <= 0 || detailSpan <= 0) return GEOJSON_LIMITS.detailPercent.max;
    const normalized = (level - GEOJSON_LIMITS.simplifyLevel.min) / simplifySpan;
    const detail = GEOJSON_LIMITS.detailPercent.max - Math.round(normalized * detailSpan);
    return Math.max(GEOJSON_LIMITS.detailPercent.min, Math.min(GEOJSON_LIMITS.detailPercent.max, detail));
  }

  function _presetDetailPercentFromStyle(style = {}, simplifyLevel = null) {
    const levels = Array.isArray(style?.detailLevels)
      ? [...new Set(style.detailLevels
          .map(level => Number(level?.level))
          .filter(Number.isFinite))]
          .sort((a, b) => a - b)
      : [];
    if (!levels.length) return null;
    if (levels.length === 1) return 100;

    const requested = Number(simplifyLevel);
    const resolved = Number.isFinite(requested) ? requested : levels[0];
    let nearestIndex = 0;
    for (let i = 1; i < levels.length; i += 1) {
      if (Math.abs(levels[i] - resolved) < Math.abs(levels[nearestIndex] - resolved)) {
        nearestIndex = i;
      }
    }
    if (nearestIndex >= levels.length - 1) return 1;
    return Math.max(1, Math.round(100 - ((nearestIndex * 100) / (levels.length - 1))));
  }

  function _selectedLayerDetailPercent(selected, stats = null, zoomK = null) {
    if (!selected || selected.type !== LAYER_TYPES.GEOJSON) return null;
    if (Array.isArray(selected.style?.detailLevels) && selected.style.detailLevels.length) {
      const simplifyLevel = Number(stats?.simplifyLevel);
      if (!Number.isFinite(simplifyLevel)) return null;
      const mapped = _presetDetailPercentFromStyle(selected.style, simplifyLevel);
      return Number.isFinite(mapped) ? mapped : _simplifyLevelToDetailPercent(simplifyLevel);
    }
    if (selected.style?.adaptiveSimplify !== false) {
      return resolveGeojsonAdaptiveDetailPercent({
        zoomScale: _statusZoomK(zoomK),
        targetZoom: selected.style?.detailZoom,
      });
    }
    const simplifyLevel = Number(stats?.simplifyLevel);
    if (!Number.isFinite(simplifyLevel)) return null;
    return _simplifyLevelToDetailPercent(simplifyLevel);
  }

  function _syncAdaptiveDetailSliderForSelectedLayer() {
    const selected = layers.find(l => l.id === selectedId);
    if (!selected || selected.type !== LAYER_TYPES.GEOJSON) return;
    const slider = $('set-gj-simplify');
    if (!slider) return;

    const liveSimplify = _currentGeojsonSimplifyLevel(selected);
    if (!Number.isFinite(liveSimplify)) return;

    let options = [];
    try {
      options = JSON.parse(slider.dataset.detailOptions || '[]');
    } catch {
      options = [];
    }
    if (!Array.isArray(options) || !options.length) return;

    let nearestIndex = 0;
    for (let i = 1; i < options.length; i += 1) {
      if (Math.abs(Number(options[i]?.simplifyLevel) - liveSimplify) < Math.abs(Number(options[nearestIndex]?.simplifyLevel) - liveSimplify)) {
        nearestIndex = i;
      }
    }
    const nextValue = String(nearestIndex);
    if (slider.value !== nextValue) slider.value = nextValue;

    const readout = $('set-gj-simplify-readout');
    if (readout) readout.textContent = String(options[nearestIndex]?.label || '');
  }

  function _syncBasemapLayoutLockUI(layer) {
    const sec = $('settings-basemap');
    if (!sec) return;
    const note = $('settings-basemap-layout-note');
    const readOnlyPanel = $('settings-basemap-readonly');
    const isBasemap = layer?.type === LAYER_TYPES.BASEMAP;
    const readOnly = isBasemap && !_layoutMode;

    if (note) note.style.display = readOnly ? '' : 'none';
    if (readOnlyPanel) readOnlyPanel.style.display = readOnly ? '' : 'none';

    for (const child of sec.children) {
      if (child.id === 'settings-basemap-layout-note') continue;
      if (child.id === 'settings-basemap-readonly') continue;
      if (child.tagName === 'H3') continue;
      if (readOnly) child.style.display = 'none';
      else child.style.display = '';
    }

    if (!readOnly) syncBasemapModeUIControl({ getEl: $ });

    if (readOnly) _updateBasemapReadonlyPanel();
  }

  function _showSettingsForLayer(id) {
    const layer = layers.find(l => l.id === id);
    // Hide all type sections
    for (const sec of SETTINGS_SECTIONS) {
      const el = $(sec);
      if (el) el.style.display = 'none';
    }

    if (!layer) {
      $('settings-none').style.display = '';
      $('settings-common').style.display = 'none';
      return;
    }

    $('settings-none').style.display = 'none';
    $('settings-common').style.display = '';
    $('setting-layer-name').value = layer.name;
    $('setting-layer-opacity').value = layer.opacity;

    const basemapReadOnly = layer.type === LAYER_TYPES.BASEMAP && !_layoutMode;
    $('settings-common').style.display = basemapReadOnly ? 'none' : '';

    // Show type-specific section and populate
    const secId = 'settings-' + layer.type;
    const sec = $(secId);
    if (sec) sec.style.display = '';

    populateSettingsForLayer({
      layer,
      layerTypes: LAYER_TYPES,
      getEl: $,
      pointFields,
      normalizeScale: _normalizeScale,
      populateGeographicRasterSetOptions: _populateGeographicRasterSetOptions,
      getCanvasToSvgThreshold: () => _getCanvasToSvgSwitchZoom(),
      getCurrentGeojsonSimplifyLevel: _currentGeojsonSimplifyLevel,
      autoGeojsonPerfPolicy: _autoGeojsonPerfPolicyForLayer,
    });
    _syncBasemapLayoutLockUI(layer);
    if (layer.type === LAYER_TYPES.BASEMAP) _updateBasemapReadonlyPanel();
  }

  function _normalizeScale(value, fallback = '50m') {
    const allowed = new Set(['10m', '50m', '110m']);
    return allowed.has(value) ? value : fallback;
  }

  function _rasterCandidatePaths(setName) {
    const base = `data/maps/NaturalEarth/${setName}`;
    return [
      `${base}/${setName}_50M_SR_W/${setName}_50M_SR_W.tif`,
      `${base}/${setName}_50M_SR_W/${setName}_50M_SR_W.jpg`,
      `${base}/${setName}_50M_SR_W/${setName}_50M_SR_W.png`,
    ];
  }

  async function _resourceExists(path) {
    try {
      const head = await fetch(path, { method: 'HEAD' });
      if (head.ok) return true;
    } catch {
      // fall through to GET
    }
    try {
      const get = await fetch(path, { cache: 'no-store' });
      return get.ok;
    } catch {
      return false;
    }
  }

  async function _discoverNaturalEarthRasterSets() {
    if (_rasterSetsDiscovered) return _naturalEarthRasterSets;
    let sets = [];
    try {
      const manifest = await fetch('data/maps/NaturalEarth/raster-sets.json', { cache: 'no-store' });
      if (manifest.ok) {
        const json = await manifest.json();
        if (Array.isArray(json?.sets)) {
          sets = json.sets
            .map(v => String(v || '').trim().toUpperCase())
            .filter(v => /^NE[0-9]+$/.test(v));
        }
      }
    } catch {
      // optional manifest
    }

    _naturalEarthRasterSets = sets.length ? sets : ['NE1'];
    _rasterSetsDiscovered = true;
    _populateGeographicRasterSetOptions();
    return _naturalEarthRasterSets;
  }

  function _populateGeographicRasterSetOptions(selectedValue = null) {
    const sel = $('set-bm-geographic-raster-set');
    if (!sel) return;
    const selected = selectedValue || sel.value || _naturalEarthRasterSets[0] || 'NE1';
    sel.innerHTML = '';
    for (const setName of _naturalEarthRasterSets) {
      const opt = document.createElement('option');
      opt.value = setName;
      opt.textContent = setName;
      if (setName === selected) opt.selected = true;
      sel.appendChild(opt);
    }
    if (!sel.value && sel.options.length) sel.value = sel.options[0].value;
  }

  bindSettingsPanelHandlers({
    settingsPanel,
    getSelectedLayer: () => layers.find(l => l.id === selectedId),
    applyLayer: layer => {
      const wasDebugPerf = layer?.type === LAYER_TYPES.GEOJSON && layer?.style?.debugPerfStatus === true;
      readSettingsFromLayerUI({
        layer,
        layerTypes: LAYER_TYPES,
        getEl: $,
        normalizeScale: _normalizeScale,
        isLayoutMode: _layoutMode,
        switchToCanvas: () => renderer.switchToCanvas?.(renderer.getZoomTransform?.()),
        setCanvasToSvgThreshold: value => _setCanvasToSvgSwitchZoom(value),
        autoGeojsonPerfPolicy: _autoGeojsonPerfPolicyForLayer,
      });
      const isDebugPerf = layer?.type === LAYER_TYPES.GEOJSON && layer?.style?.debugPerfStatus === true;
      if (!wasDebugPerf && isDebugPerf) {
        _lastGeojsonPerfConsoleAt = 0;
        _emitPerfDebug('enabled', {
          layer: layer.name || layer.id,
          zoom: Number(renderer.getZoomTransform?.()?.k) || null,
          emittedAt: new Date().toISOString(),
        });
      }
      _renderLayerList();
      _queueRender();
      _saveState();
    },
    debounceMs: 150,
  });

  $('btn-gj-auto-perf')?.addEventListener('click', () => {
    const layer = layers.find(l => l.id === selectedId);
    if (!layer || layer.type !== LAYER_TYPES.GEOJSON) return;
    const policy = _autoGeojsonPerfPolicyForLayer(layer);
    if (!policy) return;

    if ($('set-gj-min-zoom')) $('set-gj-min-zoom').value = String(policy.minZoom);

    readSettingsFromLayerUI({
      layer,
      layerTypes: LAYER_TYPES,
      getEl: $,
      normalizeScale: _normalizeScale,
      isLayoutMode: _layoutMode,
      switchToCanvas: () => renderer.switchToCanvas?.(renderer.getZoomTransform?.()),
      setCanvasToSvgThreshold: value => _setCanvasToSvgSwitchZoom(value),
      autoGeojsonPerfPolicy: _autoGeojsonPerfPolicyForLayer,
    });

    _renderLayerList();
    _render();
    _saveState();
  });

  // ── Import modal ─────────────────────────────────────────────────────
  const importOverlay = $('import-file-overlay');
  const treeMapOverlay = $('tree-map-overlay');
  let _importType = 'auto';
  const importUiController = createImportUiController({
    getEl: $,
    importOverlay,
    wireDropZone,
    onImportFile: file => _importFile(file),
    setImportType: value => { _importType = value; },
  });

  // ── Layout mode ──────────────────────────────────────────────────────
  const welcomeOverlay = $('welcome-overlay');
  const layoutModeController = createLayoutModeController({
    documentRef: document,
    getEl: $,
    getLayoutMode: () => _layoutMode,
    setLayoutMode: value => { _layoutMode = !!value; },
    mapViewport,
    layerManager,
    getLayers: () => layers,
    layerTypes: LAYER_TYPES,
    panelController,
    showSettingsForLayer: id => _showSettingsForLayer(id),
    setSelectedId: id => { selectedId = id; },
    getSelectedId: () => selectedId,
    clearLayoutCountryInteraction: opts => _clearLayoutCountryInteraction(opts),
    syncBasemapCountryInteractionRuntime: () => _syncBasemapCountryInteractionRuntime(),
    getCountryFeatureCache: scale => _getCountryFeatureCache(scale),
    activeCountryScale: () => _activeCountryScale(),
    renderLayerList: () => _renderLayerList(),
    render: () => _render(),
    saveState: () => _saveState(),
    getZoomTransform: () => renderer.getZoomTransform?.(),
    getViewportSize: () => _viewportSize(),
    mapOutlines: MAP_OUTLINES,
    fetchImpl: fetch,
    topojson,
    createLayer,
    escapeHtml: _escapeHtml,
  });

  function _enterLayoutMode() {
    layoutModeController.enterLayoutMode();
  }

  function _exitLayoutMode() {
    layoutModeController.exitLayoutMode();
  }

  layoutModeController.bindStandardLayerListClicks();

  const welcomeOverlayController = createWelcomeOverlayController({
    overlay: welcomeOverlay,
    getLayers: () => layers,
    layerTypes: LAYER_TYPES,
    normalizeScale: _normalizeScale,
    enterLayoutMode: () => _enterLayoutMode(),
    render: () => _render(),
  });

  // Welcome overlay (shown on first load — no saved state)
  function _showWelcome() {
    welcomeOverlayController.showWelcome();
  }
  welcomeOverlayController.bindModeCards();

  function _openImportModal(type) {
    importUiController.openImportModal(type);
  }

  function _closeImportModal() { importUiController.closeImportModal(); }

  importUiController.bindImportUi();

  // Wire drop on map SVG
  const canvasWrapper = $('canvas-wrapper');
  importUiController.bindCanvasDrop(canvasWrapper);

  const zoomBox = document.createElement('div');
  zoomBox.className = 'sx-zoom-box';
  zoomBox.style.display = 'none';
  canvasWrapper?.appendChild(zoomBox);

  const geojsonFeatureInteraction = createFeatureInteractionController({
    canvasWrapper,
    d3,
    renderer,
    mapViewport,
    interactionState: countryInteractionState,
    statusStats,
    computeFrameRect,
    getFrameStyle: () => layers.find(l => l.type === LAYER_TYPES.FRAME)?.style,
    getActiveFeatureScale: () => (_layoutMode ? _activeCountryScale() : selectedId),
    getFeatureCache: () => (_layoutMode
      ? _getCountryFeatureCache(_activeCountryScale())
      : _getSelectedGeojsonFeatureCache()),
    getFeatureId: (feature, index) => (_layoutMode
      ? _countryFeatureId(feature)
      : _geojsonFeatureId(feature, index)),
    getFeatureName: (feature, index) => (_layoutMode
      ? _countryFeatureName(feature)
      : _geojsonFeatureName(feature, index)),
    isFeatureHoverEnabled: () => _isCountryHoverEnabled(),
    constrainViewModeTransform: transform => _constrainViewModeTransform(transform),
    recordZoomTransform: (transform, opts) => _recordZoomTransform(transform, opts),
    queueRender: () => _queueRender(),
    updateFallbackStatus: () => _updateSelectedGeoJSONStatus(),
    featureLabel: 'Feature',
  });

  function _eventToProjectedPoint(e) {
    return geojsonFeatureInteraction.eventToProjectedPoint(e);
  }

  async function _hitTestCountryFromPointerEvent(e) {
    return geojsonFeatureInteraction.hitTestFeatureFromPointerEvent(e);
  }

  async function _zoomToSelectedCountries() {
    await geojsonFeatureInteraction.zoomToSelectedFeatures();
  }

  function _appendRasterTierStatus(baseText, zoomK, asHtml = false, detailPercent = null) {
    return basemapStatusController.appendRasterTierStatus(baseText, zoomK, asHtml, detailPercent);
  }

  function _statusZoomK(zoomK = null) {
    if (Number.isFinite(zoomK)) return zoomK;
    const live = Number(renderer.getZoomTransform?.()?.k);
    return Number.isFinite(live) ? live : 1;
  }

  function _statusCoordDecimals(zoomK = null) {
    const k = Math.max(1, _statusZoomK(zoomK));
    return Math.max(2, Math.min(6, Math.floor(Math.log10(k)) + 2));
  }

  function _formatLatLon(lat, lon, decimals = 2) {
    const latNum = Number(lat);
    const lonNum = Number(lon);
    if (!Number.isFinite(latNum) || !Number.isFinite(lonNum)) return 'center --';
    const latAbs = Math.abs(latNum).toFixed(decimals);
    const lonAbs = Math.abs(lonNum).toFixed(decimals);
    const latHem = latNum >= 0 ? 'N' : 'S';
    const lonHem = lonNum >= 0 ? 'E' : 'W';
    return `center ${latAbs}${latHem}, ${lonAbs}${lonHem}`;
  }

  function _formatDistanceKmOrM(km) {
    const valueKm = Number(km);
    if (!Number.isFinite(valueKm) || valueKm <= 0) return '--';
    if (valueKm < 1) return `${Math.round(valueKm * 1000)} m`;
    if (valueKm < 100) return `${valueKm.toFixed(2)} km`;
    if (valueKm < 1000) return `${valueKm.toFixed(1)} km`;
    return `${Math.round(valueKm)} km`;
  }

  function _frameGeoMetrics(zoomK = null) {
    const projection = renderer.getProjection?.();
    const invert = projection?.invert?.bind(projection);
    if (!invert) return null;

    const transform = renderer.getZoomTransform?.() || d3.zoomIdentity;
    const k = Number.isFinite(transform.k) && transform.k > 0 ? transform.k : _statusZoomK(zoomK);
    const x = Number.isFinite(transform.x) ? transform.x : 0;
    const y = Number.isFinite(transform.y) ? transform.y : 0;

    const frame = _frameRectForSize(_viewportSize());
    if (!frame || !Number.isFinite(frame.width) || !Number.isFinite(frame.height) || frame.width <= 0 || frame.height <= 0) {
      return null;
    }

    const invPoint = (sx, sy) => {
      const px = (sx - x) / k;
      const py = (sy - y) / k;
      const ll = invert([px, py]);
      if (!Array.isArray(ll) || !Number.isFinite(ll[0]) || !Number.isFinite(ll[1])) return null;
      return ll;
    };

    const cx = frame.x + (frame.width / 2);
    const cy = frame.y + (frame.height / 2);
    const left = invPoint(frame.x, cy);
    const right = invPoint(frame.x + frame.width, cy);
    const top = invPoint(cx, frame.y);
    const bottom = invPoint(cx, frame.y + frame.height);
    const center = invPoint(cx, cy);
    if (!left || !right || !top || !bottom || !center) return null;

    const earthKm = 6371.0088;
    const widthKm = d3.geoDistance(left, right) * earthKm;
    const heightKm = d3.geoDistance(top, bottom) * earthKm;

    return {
      centerLon: center[0],
      centerLat: center[1],
      widthKm,
      heightKm,
    };
  }

  function _selectedLayerStatus(selected, zoomK = null) {
    if (!selected) return { text: 'layer none', asHtml: false };

    if (selected.type === LAYER_TYPES.GEOJSON) {
      const stats = renderer.getGeoJSONRenderStats(selected.id);
      if (!stats) {
        return { text: `${selected.name || 'GeoJSON'}: objects --, detail --`, asHtml: false };
      }
      const visible = stats.hiddenByZoom ? 0 : (Number.isFinite(+stats.renderedFeatures) ? +stats.renderedFeatures : 0);
      const total = Number.isFinite(+stats.totalFeatures) ? +stats.totalFeatures : 0;
      const detailPercent = _selectedLayerDetailPercent(selected, stats, zoomK);
      const debugSuffix = selected?.style?.debugPerfStatus === true
        ? _boundaryDebugStatusSuffix(stats)
        : '';
      return {
        text: `${selected.name || 'GeoJSON'}: objects ${visible}/${total}, detail ${detailPercent}%${debugSuffix}`,
        asHtml: false,
      };
    }

    if (selected.type === LAYER_TYPES.BASEMAP && _isGeographicRasterMode()) {
      return {
        text: _appendRasterTierStatus('', zoomK, false),
        html: _appendRasterTierStatus('', zoomK, true),
        asHtml: true,
      };
    }

    return { text: `${selected.name || selected.type}: active`, asHtml: false };
  }

  function _boundaryDebugStatusSuffix(stats) {
    const dbg = stats?.boundaryDebug;
    if (!dbg) return '';
    const parts = [` | dbg ${dbg.renderer || 'unknown'}`];
    const sharedPct = Number(dbg?.topology?.sharedArcPct);
    if (Number.isFinite(sharedPct)) parts.push(`shared ${sharedPct.toFixed(1)}%`);
    const lineParts = Number(dbg?.lineParts);
    if (Number.isFinite(lineParts)) parts.push(`parts ${lineParts}`);
    const projectedSubpaths = Number(dbg?.projectedSubpaths);
    if (Number.isFinite(projectedSubpaths)) parts.push(`subpaths ${projectedSubpaths}`);
    const featurePaths = Number(dbg?.featurePaths);
    if (Number.isFinite(featurePaths)) parts.push(`features ${featurePaths}`);
    return `, ${parts.join(' ')}`;
  }

  function _perfDebugTargets() {
    const targets = [window];
    try {
      if (window.top && window.top !== window) targets.push(window.top);
    } catch {
      // Ignore cross-origin access failures.
    }
    return targets;
  }

  function _emitPerfDebug(label, payload) {
    _geojsonPerfEmitCount += 1;
    _geojsonPerfLastEmitAt = payload?.emittedAt || new Date().toISOString();
    for (const target of _perfDebugTargets()) {
      const sink = Array.isArray(target.__SPREAD_X_PERF_LOGS__) ? target.__SPREAD_X_PERF_LOGS__ : [];
      sink.push(payload);
      if (sink.length > 200) sink.shift();
      target.__SPREAD_X_PERF_LOGS__ = sink;
      target.__SPREAD_X_LAST_PERF__ = payload;
      target.dispatchEvent?.(new CustomEvent('spreadx:perf', { detail: payload }));
      target.console?.info?.(`[SPREAD-X PERF] ${label} ${JSON.stringify(payload)}`);
    }
  }

  function _maybeLogGeojsonPerfToConsole(selectedLayer, stats, source = 'render') {
    if (!selectedLayer || selectedLayer.type !== LAYER_TYPES.GEOJSON) return;
    if (selectedLayer?.style?.debugPerfStatus !== true) return;

    const liveZoom = Number(renderer.getZoomTransform?.()?.k);
    const statsZoom = Number(stats?.zoomScale);
    const zoomDrift = (Number.isFinite(liveZoom) && Number.isFinite(statsZoom))
      ? (Math.round((liveZoom - statsZoom) * 1000) / 1000)
      : null;

    // Status updates can run while a new heavy render is still in flight.
    // Skip those stale snapshots and only log the next completed render stats.
    if (source === 'status' && Number.isFinite(zoomDrift) && Math.abs(zoomDrift) > 0.25) return;

    const now = Date.now();
    if ((now - _lastGeojsonPerfConsoleAt) < 900) return;
    _lastGeojsonPerfConsoleAt = now;

    const timings = stats?.timingsMs || {};
    const breakdown = _lastRendererBreakdown;
    const mode = renderer.isUsingCanvas() ? 'canvas' : 'svg';
    const payload = {
      layer: selectedLayer.name || selectedLayer.id,
      source,
      hasStats: !!stats,
      mode,
      zoom: Number.isFinite(liveZoom) ? liveZoom : null,
      statsZoom: Number.isFinite(statsZoom) ? statsZoom : null,
      zoomDrift,
      simplifyLevel: Number.isFinite(+stats?.simplifyLevel) ? +stats.simplifyLevel : null,
      totalFeatures: Number.isFinite(+stats?.totalFeatures) ? +stats.totalFeatures : null,
      inViewFeatures: Number.isFinite(+stats?.inViewFeatures) ? +stats.inViewFeatures : null,
      renderedFeatures: Number.isFinite(+stats?.renderedFeatures) ? +stats.renderedFeatures : null,
      renderedVertexCount: Number.isFinite(+stats?.renderedVertexCount) ? +stats.renderedVertexCount : null,
      partCullChecked: Number.isFinite(+stats?.partCullChecked) ? +stats.partCullChecked : null,
      partCullApplied: Number.isFinite(+stats?.partCullApplied) ? +stats.partCullApplied : null,
      hiddenByZoom: !!stats?.hiddenByZoom,
      minZoom: Number.isFinite(+stats?.minZoom) ? +stats.minZoom : null,
      rendererFrameMs: Math.round(_lastRenderDurationMs * 100) / 100,
      prepMs: Number.isFinite(+timings.prep) ? +(Math.round(timings.prep * 100) / 100) : null,
      cullMs: Number.isFinite(+timings.cull) ? +(Math.round(timings.cull * 100) / 100) : null,
      drawMs: Number.isFinite(+timings.draw) ? +(Math.round(timings.draw * 100) / 100) : null,
      totalGeojsonMs: Number.isFinite(+timings.total) ? +(Math.round(timings.total * 100) / 100) : null,
      rendererProjectionMs: Number.isFinite(+breakdown?.projectionMs) ? +breakdown.projectionMs : null,
      rendererCleanupMs: Number.isFinite(+breakdown?.cleanupMs) ? +breakdown.cleanupMs : null,
      rendererBackgroundMs: Number.isFinite(+breakdown?.backgroundMs) ? +breakdown.backgroundMs : null,
      rendererBasemapMs: Number.isFinite(+breakdown?.basemapMs) ? +breakdown.basemapMs : null,
      rendererGeojsonMs: Number.isFinite(+breakdown?.geojsonMs) ? +breakdown.geojsonMs : null,
      rendererPointsMs: Number.isFinite(+breakdown?.pointsMs) ? +breakdown.pointsMs : null,
      rendererTreeMs: Number.isFinite(+breakdown?.treeMs) ? +breakdown.treeMs : null,
      rendererFrameOverlayMs: Number.isFinite(+breakdown?.frameMs) ? +breakdown.frameMs : null,
      rendererLayerCount: Number.isFinite(+breakdown?.renderedLayerCount) ? +breakdown.renderedLayerCount : null,
      rendererTopLayers: Array.isArray(breakdown?.topLayers) ? breakdown.topLayers : null,
      boundaryDebug: stats?.boundaryDebug || null,
      emittedAt: new Date(now).toISOString(),
    };
    _emitPerfDebug('stats', payload);
  }

  function _updateSelectedGeoJSONStatus(zoomK = null) {
    _updateBasemapReadonlyPanel(zoomK);
    const selected = layers.find(l => l.id === selectedId) || null;
    if (selected?.type === LAYER_TYPES.GEOJSON) {
      _syncAdaptiveDetailSliderForSelectedLayer();
    }
    if (countryInteractionState.hoveredName() && !mapInteractionController?.isSpaceHeld() && _isCountryHoverEnabled()) {
      _updateCountryStatusBar();
      return;
    }
    if (!statusStats || mapInteractionController?.isSpaceHeld()) return;

    const metrics = _frameGeoMetrics(zoomK);
    const decimals = _statusCoordDecimals(zoomK);
    const centerText = metrics
      ? _formatLatLon(metrics.centerLat, metrics.centerLon, decimals)
      : 'center --';
    const frameText = metrics
      ? `frame ${_formatDistanceKmOrM(metrics.widthKm)} x ${_formatDistanceKmOrM(metrics.heightKm)}`
      : 'frame --';
    const zoomText = `zoom ${_statusZoomK(zoomK).toFixed(2)}`;

    const layerStatus = _selectedLayerStatus(selected, zoomK);
    const prefix = `${centerText} | ${frameText} | ${zoomText}`;

    if (layerStatus.asHtml) {
      statusStats.innerHTML = `${prefix} | ${layerStatus.html || layerStatus.text}`;
      statusStats.dataset.mode = 'raster';
    } else {
      statusStats.textContent = `${prefix} | ${layerStatus.text}`;
      statusStats.dataset.mode = selected?.type === LAYER_TYPES.GEOJSON ? 'geojson' : 'status';
    }
  }

  function _isEditableTarget(el) {
    if (!el) return false;
    if (el.isContentEditable) return true;
    const tag = el.tagName?.toLowerCase();
    return tag === 'input' || tag === 'textarea' || tag === 'select';
  }

  mapInteractionController = createMapInteractionController({
    windowRef: window,
    canvasWrapper,
    statusStats,
    d3,
    renderer,
    mapViewport,
    countryInteractionState,
    zoomBox,
    getBasemapCenter: () => basemapController.basemapCenter(),
    isEditableTarget: _isEditableTarget,
    isCountryHoverEnabled: _isCountryHoverEnabled,
    hitTestCountryFromPointerEvent: _hitTestCountryFromPointerEvent,
    zoomToSelectedCountries: _zoomToSelectedCountries,
    syncBasemapCountryInteractionRuntime: _syncBasemapCountryInteractionRuntime,
    updateCountryStatusBar: _updateCountryStatusBar,
    queueRender: _queueRender,
    saveState: _saveState,
    updateSelectedGeoJSONStatus: _updateSelectedGeoJSONStatus,
    constrainViewModeTransform: _constrainViewModeTransform,
    recordZoomTransform: _recordZoomTransform,
    isGeographicRasterMode: _isGeographicRasterMode,
    findBasemapLayer: () => layers.find(l => l.type === LAYER_TYPES.BASEMAP),
  });

  statusStats?.addEventListener('click', e => {
    const toggle = e.target.closest('[data-raster-tier-toggle]');
    if (!toggle) return;
    mapInteractionController?.cycleRasterTier({
      shiftKey: !!e.shiftKey,
      displayedTier: toggle.textContent,
    });
  });

  // ── File import logic ────────────────────────────────────────────────

  function _importFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      _processImport(reader.result, file.name)
        .catch(err => {
          console.error('Import failed:', err);
          $('status-stats').textContent = `Import failed: ${file.name}`;
        });
    };
    reader.readAsText(file);
  }

  async function _processImport(text, filename) {
    const forced = $('import-layer-type')?.value || _importType;
    const result = await layerImportService.processImportText(text, filename, forced);
    if (!result || result.cancelled || !result.layer) {
      $('status-stats').textContent = result?.statusText || `Import cancelled: ${filename}`;
      return;
    }

    const layer = result.layer;
    layers.push(layer);
    _ensureFixedBoundaryLayers();
    selectedId = layer.id;

    _renderLayerList();
    _showSettingsForLayer(selectedId);
    _render();
    _saveState();
    $('status-stats').textContent = result.statusText || `Imported: ${filename}`;
  }

  function _isLockedLayer(layer) {
    if (!layer) return false;
    return layer.type === LAYER_TYPES.BASEMAP || layer.type === LAYER_TYPES.FRAME;
  }

  async function _resetOrientation() {
    const base = layers.find(l => l.type === LAYER_TYPES.BASEMAP);
    if (!base) return;

    base.style.center = [0, 0];
    base.style.rotate = [0, 0, 0];

    if (mapInteractionController?.isSpaceHeld()) mapInteractionController.setSpaceHint();
    else $('status-stats').textContent = 'Map orientation reset';

    if (selectedId === base.id) _showSettingsForLayer(selectedId);
    await _render();
    _saveState();
  }

  createAppCommandController({
    documentRef: document,
    commands,
    openImportModal: _openImportModal,
    openExport: () => exporter.open(),
    onResetZoom: () => renderer.resetZoom(),
    onResetOrientation: () => { _resetOrientation(); },
    onZoomBack: () => {
      if (!mapViewport.canGoBack()) return;
      _applyHistoryTransform(mapViewport.currentIndex() - 1);
    },
    onZoomForward: () => {
      if (!mapViewport.canGoForward()) return;
      _applyHistoryTransform(mapViewport.currentIndex() + 1);
    },
    onToggleLayoutMode: () => layoutModeController.applyCurrentViewAsMap(),
    getTreeMapOverlay: () => treeMapOverlay,
    cancelTreeMapping: () => $('btn-tree-map-cancel')?.click(),
    getMapInteractionController: () => mapInteractionController,
    closeImportModal: _closeImportModal,
    closeUnpinnedPanels: () => panelController.closeUnpinnedPanels(),
    resetZoomButton: $('btn-reset-zoom'),
    zoomBackButton: $('btn-zoom-back'),
    zoomForwardButton: $('btn-zoom-forward'),
    resetOrientationButton: $('btn-reset-orientation'),
    layoutModeButton: $('btn-layout-mode'),
  });

  // Show welcome overlay on first load (no saved state)
  if (isFirstLoad) {
    _showWelcome();
  } else if (saved?.layoutMode) {
    // Restore layout mode if it was active on last save
    _enterLayoutMode();
  }

  // ── Graphics export ──────────────────────────────────────────────────
  const exporter = createGraphicsExporter({
    overlay:      $('export-graphic-overlay'),
    body:         $('export-graphic-body'),
    footer:       $('export-graphic-footer'),
    closeBtn:     $('export-graphic-close'),
    openBtn:      $('btn-export'),
    prefix:       'spread-x-gfx',
    defaultFilename: 'spread-x-export',
    getViewportDims: () => {
      const wr = $('canvas-wrapper');
      return { width: wr?.clientWidth || 800, height: wr?.clientHeight || 600 };
    },
    buildSvg: () => renderer.serializeSvg(),
    buildPngCanvas: ({ width, height }) => {
      // Render SVG to PNG via offscreen canvas
      const svgStr = renderer.serializeSvg();
      if (!svgStr) return null;
      const blob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
          const c = new OffscreenCanvas(width, height);
          const ctx = c.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);
          URL.revokeObjectURL(url);
          resolve(c);
        };
        img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
        img.src = url;
      });
    },
    hasContent: () => layers.length > 0,
  });

  // ── Toolbar height tracking ──────────────────────────────────────────
  initToolbarHeight(root);

  // ── Initial render ───────────────────────────────────────────────────
  _renderLayerList();
  _showSettingsForLayer(selectedId);
  await _render();
  if (!_layoutMode) {
    const t = renderer.getZoomTransform?.();
    if (t) mapViewport.setViewConstraintBase(t, _viewportSize());
  }
  _recordZoomTransform(renderer.getZoomTransform(), { immediate: true });
  _updateZoomNavButtons();

  // Open layer panel by default
  panelController.openLayer();
}

/* ── Helpers ───────────────────────────────────────────────────────── */

function _escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}
