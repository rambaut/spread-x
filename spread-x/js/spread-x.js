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
import { createLayer, duplicateLayer, LAYER_TYPES, LAYER_ICONS, NE_STANDARD_LAYERS, MAP_OUTLINES } from './layers.js';
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
import { createGeojsonFeatureInteractionController } from './core/geojson-feature-interaction-controller.js';
import { computeFrameRect } from './core/frame-geometry.js';
import { pickTopoObjectKey } from './core/topology-utils.js';
import { createLayerManager } from './core/layer-manager.js';
import { FRAME_PADDING_UI } from './config.js';
import { CANVAS_TO_SVG_THRESHOLD } from './canvas-map-renderer.js';
import {
  autoGeojsonRenderPolicy,
  countGeoJSONFeatures,
  resolveLayerGeoJSON,
} from './core/geojson-layer-utils.js';

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

    const features = _extractGeojsonFeatures(layer.data);
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
      base.runtime.showBasemapCountryPolygons = _layoutMode;
      delete base.runtime.hoveredFeatureId;
      delete base.runtime.selectedFeatureIds;
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
    const clamped = Math.max(2, Math.min(50, Number.isFinite(num) ? num : CANVAS_TO_SVG_THRESHOLD));
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
    shouldForceCanvas: () => false,
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
    const corrected = _constrainViewModeTransform(candidate);

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
    const listLayers = reversed.filter(layer => layer.type !== LAYER_TYPES.FRAME);
    if (frameFromList) listLayers.push(frameFromList);

    // Render top-most first, but keep the frame row at the bottom.
    for (const layer of listLayers) {
      const visLocked = layer.type === LAYER_TYPES.BASEMAP || layer.type === LAYER_TYPES.FRAME;
      const layoutLocked = _layoutMode && layer.type !== LAYER_TYPES.BASEMAP;
      const el = document.createElement('div');
      el.className = 'sx-layer-item'
        + (layer.id === selectedId ? ' selected' : '')
        + (layoutLocked ? ' layout-locked' : '');
      el.dataset.layerId = layer.id;
      el.innerHTML = `
        <button class="sx-layer-vis ${layer.visible ? '' : 'off'} ${visLocked || layoutLocked ? 'disabled' : ''}" data-vis="${layer.id}" title="${visLocked ? 'Visibility locked' : layoutLocked ? 'Hidden in Layout Mode' : 'Toggle visibility'}" ${visLocked || layoutLocked ? 'disabled' : ''}>
          <i class="bi ${layer.visible ? 'bi-eye' : 'bi-eye-slash'}"></i>
        </button>
        <i class="bi ${LAYER_ICONS[layer.type] || 'bi-square'} sx-layer-icon"></i>
        <span class="sx-render-mode-indicator ${modeClass}" title="Rendered via ${modeLabel}" aria-label="Rendered via ${modeLabel}"></span>
        <span class="sx-layer-name">${_escapeHtml(layer.name)}</span>`;
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

  layerList?.addEventListener('click', e => {
    // Visibility toggle
    const visBtn = e.target.closest('[data-vis]');
    if (visBtn) {
      const layer = layers.find(l => l.id === visBtn.dataset.vis);
      if (layer) {
        const visLocked = layer.type === LAYER_TYPES.BASEMAP || layer.type === LAYER_TYPES.FRAME;
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
    $('btn-add-toolbar')?.toggleAttribute('disabled', _layoutMode);
    $('btn-add-layer')?.toggleAttribute('disabled', _layoutMode);
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

  // ── Add layer dropdown ───────────────────────────────────────────────
  const addMenu = $('add-layer-menu');
  $('btn-add-toolbar')?.addEventListener('click', e => {
    e.stopPropagation();
    addMenu?.classList.toggle('show');
  });
  $('btn-add-layer')?.addEventListener('click', e => {
    e.stopPropagation();
    addMenu?.classList.toggle('show');
  });
  document.addEventListener('click', () => addMenu?.classList.remove('show'));

  addMenu?.querySelectorAll('[data-add-type]').forEach(btn => {
    btn.addEventListener('click', () => {
      addMenu.classList.remove('show');
      _openImportModal(btn.dataset.addType);
    });
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
    if ($('set-gj-max-visible')) $('set-gj-max-visible').value = String(policy.maxVisibleFeatures);

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
    standardLayerDefs: NE_STANDARD_LAYERS,
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

  let mapInteractionController = null;
  const geojsonFeatureInteraction = createGeojsonFeatureInteractionController({
    canvasWrapper,
    d3,
    renderer,
    mapViewport,
    interactionState: countryInteractionState,
    statusStats,
    computeFrameRect,
    getFrameStyle: () => layers.find(l => l.type === LAYER_TYPES.FRAME)?.style,
    getActiveFeatureScale: () => selectedId,
    getFeatureCache: () => _getSelectedGeojsonFeatureCache(),
    getFeatureId: (feature, index) => _geojsonFeatureId(feature, index),
    getFeatureName: (feature, index) => _geojsonFeatureName(feature, index),
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

  function _appendRasterTierStatus(baseText, zoomK, asHtml = false) {
    return basemapStatusController.appendRasterTierStatus(baseText, zoomK, asHtml);
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
      capped: !!stats?.capped,
      hiddenByZoom: !!stats?.hiddenByZoom,
      maxVisibleFeatures: Number.isFinite(+stats?.maxVisibleFeatures) ? +stats.maxVisibleFeatures : null,
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
      emittedAt: new Date(now).toISOString(),
    };
    _emitPerfDebug('stats', payload);
  }

  function _updateSelectedGeoJSONStatus(zoomK = null) {
    _updateBasemapReadonlyPanel(zoomK);
    if (countryInteractionState.hoveredName() && !mapInteractionController?.isSpaceHeld() && _isCountryHoverEnabled()) {
      _updateCountryStatusBar();
      return;
    }
    if (!statusStats || mapInteractionController?.isSpaceHeld()) return;
    const selected = layers.find(l => l.id === selectedId);
    if (!selected || selected.type !== LAYER_TYPES.GEOJSON) {
      if (_isGeographicRasterMode()) {
        statusStats.innerHTML = _appendRasterTierStatus('', zoomK, true);
        statusStats.dataset.mode = 'raster';
      } else if (statusStats.dataset.mode === 'geojson' || statusStats.dataset.mode === 'raster' || statusStats.dataset.mode === 'geojson+raster') {
        statusStats.innerHTML = '';
        delete statusStats.dataset.mode;
      }
      return;
    }

    const stats = renderer.getGeoJSONRenderStats(selected.id);
    if (!stats) return;
    const debugPerf = selected?.style?.debugPerfStatus === true;
    const renderMode = renderer.isUsingCanvas() ? 'canvas' : 'svg';
    const debugLogMarker = debugPerf && _geojsonPerfEmitCount > 0
      ? ` log#${_geojsonPerfEmitCount}@${_geojsonPerfLastEmitAt.slice(11, 19)}`
      : '';

    if (stats.hiddenByZoom) {
      const debugText = debugPerf
        ? ` | dbg mode=${renderMode} simp=${Number.isFinite(+stats.simplifyLevel) ? +stats.simplifyLevel : 0} max=${stats.maxVisibleFeatures}${debugLogMarker}`
        : '';
      const text = _appendRasterTierStatus(
        `GeoJSON: 0/${stats.totalFeatures} visible (zoom ${stats.zoomScale.toFixed(2)} < ${stats.minZoom.toFixed(2)})${debugText}`,
        zoomK,
        _isGeographicRasterMode()
      );
      if (_isGeographicRasterMode()) statusStats.innerHTML = text;
      else statusStats.textContent = text;
    } else {
      const capped = stats.capped ? `, capped at ${stats.maxVisibleFeatures}` : '';
      const debugText = debugPerf
        ? ` | dbg mode=${renderMode} simp=${Number.isFinite(+stats.simplifyLevel) ? +stats.simplifyLevel : 0}${debugLogMarker}`
        : '';
      const text = _appendRasterTierStatus(
        `GeoJSON: ${stats.renderedFeatures}/${stats.totalFeatures} visible (${stats.inViewFeatures} in view${capped})${debugText}`,
        zoomK,
        _isGeographicRasterMode()
      );
      if (_isGeographicRasterMode()) statusStats.innerHTML = text;
      else statusStats.textContent = text;
    }
    statusStats.dataset.mode = _isGeographicRasterMode() ? 'geojson+raster' : 'geojson';
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
    onToggleLayoutMode: () => layoutModeController.toggleLayoutMode(),
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
  await defaultGeojsonBootstrap.loadDefaultOceansLayer();
  await defaultGeojsonBootstrap.loadDefaultCountriesLayer();
  await defaultGeojsonBootstrap.loadDefaultAdminDetailLayers();
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
