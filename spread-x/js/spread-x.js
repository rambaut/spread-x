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
import { analyzeTreeAnnotations, parseTreeData } from '@artic-network/pearcore/tree-io.js';
import { createLayer, duplicateLayer, LAYER_TYPES, LAYER_ICONS, NE_STANDARD_LAYERS, MAP_OUTLINES } from './layers.js';
import {
  detectFileType,
  parseGeoData,
  parseCSV,
  pointFields,
} from './parsers.js';
import { createMapRenderer } from './map-renderer.js';
import { createCanvasMapRenderer, CANVAS_TO_SVG_THRESHOLD } from './canvas-map-renderer.js';

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
  let layers = [];
  let selectedId = null;
  let settings = {};
  let _layoutMode = false;
  let _preLayoutVisibilities = {};   // { layerId: bool } saved on layout entry

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
    };
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

  // Track which surface is active (canvas by default, SVG at high zoom).
  let _usingCanvas = true;

  function _switchToCanvas(transform) {
    if (_usingCanvas) return;
    _usingCanvas = true;
    svgEl.style.display    = 'none';
    canvasEl.style.display = 'block';
    if (transform) canvasRenderer.syncZoomTransform(transform);
  }

  function _switchToSvg(transform) {
    if (!_usingCanvas) return;
    _usingCanvas = false;
    canvasEl.style.display = 'none';
    svgEl.style.display    = 'block';
    if (transform) svgRenderer.syncZoomTransform(transform);
  }

  const canvasRenderer = createCanvasMapRenderer({
    canvasElement: canvasEl, d3, topojson,
    onZoomChange: (transform) => {
      if (transform.k >= CANVAS_TO_SVG_THRESHOLD) _switchToSvg(transform);
    },
  });

  const svgRenderer = createMapRenderer({
    svgElement: svgEl, d3, topojson,
    onZoomChange: (transform) => {
      if (transform.k < CANVAS_TO_SVG_THRESHOLD) _switchToCanvas(transform);
    },
  });

  // Unified renderer proxy — all existing code uses this unchanged.
  const renderer = {
    resize(w, h)    { canvasRenderer.resize(w, h); svgRenderer.resize(w, h); },
    setLayers(l)    { canvasRenderer.setLayers(l); svgRenderer.setLayers(l); },
    render()        {
      const active = _usingCanvas ? canvasRenderer : svgRenderer;
      active.setLayers(layers);
      return active.render();
    },
    resetZoom()     { canvasRenderer.resetZoom(); svgRenderer.resetZoom(); },
    getProjection() { return (_usingCanvas ? canvasRenderer : svgRenderer).getProjection(); },
    getPath()       { return (_usingCanvas ? canvasRenderer : svgRenderer).getPath(); },
    getGeoJSONRenderStats(id) {
      return (_usingCanvas ? canvasRenderer : svgRenderer).getGeoJSONRenderStats(id);
    },
    setLayerVisibility(id, v) {
      return (_usingCanvas ? canvasRenderer : svgRenderer).setLayerVisibility(id, v);
    },
    async serializeSvg() {
      // Render to the SVG renderer synced to current zoom, then serialize.
      const w = $('canvas-wrapper')?.clientWidth  || 800;
      const h = $('canvas-wrapper')?.clientHeight || 600;
      svgRenderer.resize(w, h);
      svgRenderer.setLayers(layers);
      const t = (_usingCanvas ? canvasRenderer : svgRenderer).getZoomTransform();
      svgRenderer.syncZoomTransform(t);
      await svgRenderer.render();
      return svgRenderer.serializeSvg();
    },
    setSpacePanActive(a) {
      canvasRenderer.setSpacePanActive(a);
      svgRenderer.setSpacePanActive(a);
    },
    panProjectionByPixels(dx, dy) {
      return (_usingCanvas ? canvasRenderer : svgRenderer).panProjectionByPixels(dx, dy);
    },
    panProjectionLongitudeByPixels(dx) {
      return (_usingCanvas ? canvasRenderer : svgRenderer).panProjectionLongitudeByPixels(dx);
    },
  };

  function _resize() {
    const wrapper = $('canvas-wrapper');
    if (!wrapper) return;
    renderer.resize(wrapper.clientWidth, wrapper.clientHeight);
  }
  let _renderQueued = false;
  function _queueRender() {
    if (_renderQueued) return;
    _renderQueued = true;
    requestAnimationFrame(() => {
      _renderQueued = false;
      _render();
    });
  }
  window.addEventListener('resize', () => { _resize(); _render(); });

  async function _render() {
    _resize();
    renderer.setLayers(layers);
    await renderer.render();
    _updateSelectedGeoJSONStatus();
  }

  // ── Create default base-map layer ────────────────────────────────────
  layers.push(createLayer(LAYER_TYPES.BASEMAP, 'Base Map'));
  layers.push(createLayer(LAYER_TYPES.FRAME, 'Map Frame'));
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
  _ensureFixedBoundaryLayers();

  // ── Layer panel (left) ───────────────────────────────────────────────
  const layerPanel  = $('layer-panel');
  const layerList   = $('layer-list');

  // Simple slide-out helpers
  function _openPanel(panel, bodyClass) {
    panel.classList.add('open');
    panel.inert = false;
  }
  function _closePanel(panel, bodyClass) {
    panel.classList.remove('open', 'pinned');
    panel.inert = true;
    document.body.classList.remove(bodyClass);
  }
  function _pinPanel(panel, bodyClass, pinBtn) {
    panel.classList.add('open', 'pinned');
    panel.inert = false;
    document.body.classList.add(bodyClass);
    if (pinBtn) { pinBtn.classList.add('active'); pinBtn.innerHTML = '<i class="bi bi-pin-angle-fill"></i>'; }
    window.dispatchEvent(new Event('resize'));
  }
  function _unpinPanel(panel, bodyClass, pinBtn) {
    panel.classList.remove('pinned');
    document.body.classList.remove(bodyClass);
    if (pinBtn) { pinBtn.classList.remove('active'); pinBtn.innerHTML = '<i class="bi bi-pin-angle"></i>'; }
    window.dispatchEvent(new Event('resize'));
  }

  // Layer panel open/close/pin
  const btnLayerPin = $('btn-layer-pin');
  let layerPinned = false;
  $('btn-layers')?.addEventListener('click', () => {
    layerPanel.classList.contains('open') ? _closePanel(layerPanel, 'layers-pinned') : _openPanel(layerPanel);
  });
  $('btn-layer-close')?.addEventListener('click', () => _closePanel(layerPanel, 'layers-pinned'));
  btnLayerPin?.addEventListener('click', () => {
    layerPinned = !layerPinned;
    layerPinned ? _pinPanel(layerPanel, 'layers-pinned', btnLayerPin) : _unpinPanel(layerPanel, 'layers-pinned', btnLayerPin);
  });

  // Settings panel open/close/pin (right)
  const settingsPanel = $('settings-panel');
  const settingsPanelBody = $('settings-panel-body');
  const btnSettingsPin = $('btn-settings-pin');
  let settingsPinned = false;
  $('btn-settings')?.addEventListener('click', () => {
    settingsPanel.classList.contains('open') ? _closePanel(settingsPanel, 'settings-pinned') : _openPanel(settingsPanel);
  });
  $('btn-settings-close')?.addEventListener('click', () => _closePanel(settingsPanel, 'settings-pinned'));
  btnSettingsPin?.addEventListener('click', () => {
    settingsPinned = !settingsPinned;
    settingsPinned ? _pinPanel(settingsPanel, 'settings-pinned', btnSettingsPin) : _unpinPanel(settingsPanel, 'settings-pinned', btnSettingsPin);
  });

  _upgradeSettingsColourPickers();
  _installSliderReadouts();

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
    // Render top-most first: higher stack index appears at top of the table.
    for (const layer of [...layers].reverse()) {
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
        <span class="sx-layer-name">${_escapeHtml(layer.name)}</span>`;
      layerList.appendChild(el);
    }
    _updateLayerButtons();
  }

  function _frameIndex() {
    return layers.findIndex(l => l.type === LAYER_TYPES.FRAME);
  }

  function _baseIndex() {
    return layers.findIndex(l => l.type === LAYER_TYPES.BASEMAP);
  }

  function _ensureBaseOnBottom() {
    const idx = _baseIndex();
    if (idx <= 0) return;
    const [base] = layers.splice(idx, 1);
    layers.unshift(base);
  }

  function _ensureFrameOnTop() {
    const idx = _frameIndex();
    if (idx < 0 || idx === layers.length - 1) return;
    const [frame] = layers.splice(idx, 1);
    layers.push(frame);
  }

  function _ensureFixedBoundaryLayers() {
    _ensureBaseOnBottom();
    _ensureFrameOnTop();
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
    const idx = layers.findIndex(l => l.id === selectedId);
    if (idx < 0 || _isLockedLayer(layers[idx])) return;
    layers.splice(idx, 1);
    _ensureFixedBoundaryLayers();
    selectedId = layers[Math.min(idx, layers.length - 1)]?.id || null;
    _renderLayerList(); _showSettingsForLayer(selectedId); _render(); _saveState();
  });

  $('btn-dup-layer')?.addEventListener('click', () => {
    const src = layers.find(l => l.id === selectedId);
    if (!src || src.type === LAYER_TYPES.FRAME) return;
    const dup = duplicateLayer(src);
    const idx = layers.indexOf(src);
    layers.splice(idx + 1, 0, dup);
    _ensureFixedBoundaryLayers();
    selectedId = dup.id;
    _renderLayerList(); _showSettingsForLayer(selectedId); _render(); _saveState();
  });

  $('btn-move-up')?.addEventListener('click', () => _moveLayer(1));
  $('btn-move-down')?.addEventListener('click', () => _moveLayer(-1));

  function _moveLayer(dir) {
    const idx = layers.findIndex(l => l.id === selectedId);
    if (idx < 0 || _isLockedLayer(layers[idx])) return;
    const minMovableIdx = Math.max(2, _baseIndex() + 2);
    const frameIdx = _frameIndex();
    const maxMovableIdx = Math.max(minMovableIdx, frameIdx - 1);
    const to = idx + dir;
    if (to < 0 || to >= layers.length) return;
    if (to < minMovableIdx || to > maxMovableIdx) return;
    if (dir > 0 && to >= frameIdx) return;
    [layers[idx], layers[to]] = [layers[to], layers[idx]];
    _ensureFixedBoundaryLayers();
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

    // Show type-specific section and populate
    const secId = 'settings-' + layer.type;
    const sec = $(secId);
    if (sec) sec.style.display = '';

    _populateSettings(layer);
  }

  function _populateSettings(layer) {
    const s = layer.style;
    switch (layer.type) {
      case LAYER_TYPES.BASEMAP:
        $('set-bm-projection').value        = s.projection;
        $('set-bm-bg').value                = s.backgroundFill || '#ffffff';
        $('set-bm-grat').checked            = s.showGraticule !== false;
        $('set-bm-grat-step').value         = s.graticuleStep ?? 10;
        $('set-bm-grat-stroke').value       = s.graticuleStroke || '#ffffff';
        $('set-bm-grat-opacity').value      = s.graticuleOpacity ?? 0.1;
        $('set-bm-proj-boundary').value     = s.projectionBoundaryStroke || '#4a8a5a';
        $('set-bm-proj-boundary-sw').value  = s.projectionBoundaryWidth ?? 1;
        $('set-bm-globe-on').checked        = s.showGlobe !== false;
        $('set-bm-water').value             = s.oceanFill || '#02292e';
        $('set-bm-land').value              = s.landFill || '#1a3a2a';
        $('set-bm-land-boundaries').checked = s.showLandBoundaries !== false;
        $('set-bm-country-boundaries').checked = s.showCountryBoundaries !== false;
        $('set-bm-globe-outline').value     = s.landBoundaryStroke || '#4a8a5a';
        $('set-bm-globe-outline-sw').value  = s.landBoundaryWidth ?? 0.5;
        _syncBasemapGlobeUI();
        break;
      case LAYER_TYPES.GEOJSON:
        $('set-gj-fill').value    = s.fill;
        $('set-gj-fill-op').value = s.fillOpacity;
        $('set-gj-stroke').value  = s.stroke;
        $('set-gj-sw').value      = s.strokeWidth;
        break;
      case LAYER_TYPES.FRAME:
        $('set-fr-aspect').value  = s.aspectPreset;
        $('set-fr-fill-on').checked = s.showFill !== false;
        $('set-fr-fill').value    = s.fill;
        $('set-fr-fill-op').value = s.fillOpacity;
        $('set-fr-stroke').value  = s.stroke;
        $('set-fr-sw').value      = s.strokeWidth;
        break;
      case LAYER_TYPES.POINTS:
        $('set-pt-radius').value  = s.radius;
        $('set-pt-fill').value    = s.fill;
        $('set-pt-fill-op').value = s.fillOpacity;
        $('set-pt-stroke').value  = s.stroke;
        $('set-pt-sw').value      = s.strokeWidth;
        $('set-pt-label-sz').value= s.labelSize;
        // Populate label field options
        const labelSel = $('set-pt-label');
        labelSel.innerHTML = '<option value="">None</option>';
        if (layer.data) {
          for (const f of pointFields(layer.data)) {
            const opt = document.createElement('option');
            opt.value = opt.textContent = f;
            if (f === s.labelField) opt.selected = true;
            labelSel.appendChild(opt);
          }
        }
        break;
      case LAYER_TYPES.TREE:
        $('set-tr-style').value      = s.branchStyle;
        $('set-tr-color').value      = s.branchColor;
        $('set-tr-width').value      = s.branchWidth;
        $('set-tr-op').value         = s.branchOpacity;
        $('set-tr-node-color').value = s.nodeColor;
        $('set-tr-node-r').value     = s.nodeRadius;
        $('set-tr-node-op').value    = s.nodeOpacity;
        break;
    }
  }

  function _readSettingsFromUI(layer) {
    if (!layer) return;
    layer.name    = $('setting-layer-name')?.value || layer.name;
    layer.opacity = +($('setting-layer-opacity')?.value ?? layer.opacity);
    const s = layer.style;
    switch (layer.type) {
      case LAYER_TYPES.BASEMAP:
        s.projection               = $('set-bm-projection')?.value;
        s.backgroundFill           = $('set-bm-bg')?.value;
        s.showGraticule            = $('set-bm-grat')?.checked;
        s.graticuleStep            = +$('set-bm-grat-step')?.value;
        s.graticuleStroke          = $('set-bm-grat-stroke')?.value;
        s.graticuleOpacity         = +$('set-bm-grat-opacity')?.value;
        s.projectionBoundaryStroke = $('set-bm-proj-boundary')?.value;
        s.projectionBoundaryWidth  = +$('set-bm-proj-boundary-sw')?.value;
        s.showGlobe                = $('set-bm-globe-on')?.checked;
        s.oceanFill                = $('set-bm-water')?.value;
        s.landFill                 = $('set-bm-land')?.value;
        s.showLandBoundaries       = $('set-bm-land-boundaries')?.checked;
        s.showCountryBoundaries    = $('set-bm-country-boundaries')?.checked;
        s.landBoundaryStroke       = $('set-bm-globe-outline')?.value;
        s.landBoundaryWidth        = +$('set-bm-globe-outline-sw')?.value;
        _syncBasemapGlobeUI();
        break;
      case LAYER_TYPES.GEOJSON:
        s.fill        = $('set-gj-fill')?.value;
        s.fillOpacity = +$('set-gj-fill-op')?.value;
        s.stroke      = $('set-gj-stroke')?.value;
        s.strokeWidth = +$('set-gj-sw')?.value;
        break;
      case LAYER_TYPES.FRAME:
        s.aspectPreset = $('set-fr-aspect')?.value;
        s.showFill     = $('set-fr-fill-on')?.checked;
        s.fill         = $('set-fr-fill')?.value;
        s.fillOpacity  = +$('set-fr-fill-op')?.value;
        s.stroke       = $('set-fr-stroke')?.value;
        s.strokeWidth  = +$('set-fr-sw')?.value;
        break;
      case LAYER_TYPES.POINTS:
        s.radius      = +$('set-pt-radius')?.value;
        s.fill        = $('set-pt-fill')?.value;
        s.fillOpacity = +$('set-pt-fill-op')?.value;
        s.stroke      = $('set-pt-stroke')?.value;
        s.strokeWidth = +$('set-pt-sw')?.value;
        s.labelField  = $('set-pt-label')?.value;
        s.labelSize   = +$('set-pt-label-sz')?.value;
        break;
      case LAYER_TYPES.TREE:
        s.branchStyle   = $('set-tr-style')?.value;
        s.branchColor   = $('set-tr-color')?.value;
        s.branchWidth   = +$('set-tr-width')?.value;
        s.branchOpacity = +$('set-tr-op')?.value;
        s.nodeColor     = $('set-tr-node-color')?.value;
        s.nodeRadius    = +$('set-tr-node-r')?.value;
        s.nodeOpacity   = +$('set-tr-node-op')?.value;
        break;
    }
  }

  function _syncBasemapGlobeUI() {
    const enabled = $('set-bm-globe-on')?.checked !== false;
    for (const id of ['set-bm-land', 'set-bm-land-boundaries', 'set-bm-country-boundaries']) {
      if ($(id)) $(id).disabled = !enabled;
    }
    const outlineEnabled = enabled && (($('set-bm-land-boundaries')?.checked !== false) || ($('set-bm-country-boundaries')?.checked !== false));
    if ($('set-bm-globe-outline')) $('set-bm-globe-outline').disabled = !outlineEnabled;
    if ($('set-bm-globe-outline-sw')) $('set-bm-globe-outline-sw').disabled = !outlineEnabled;
  }

  // Wire all settings inputs for live update.
  // 'input' fires on every slider tick/keystroke — debounce to avoid
  // thrashing the renderer while the user is still dragging.
  let _settingsInputTimer = null;
  settingsPanel?.addEventListener('input', () => {
    clearTimeout(_settingsInputTimer);
    _settingsInputTimer = setTimeout(() => {
      const layer = layers.find(l => l.id === selectedId);
      if (layer) { _readSettingsFromUI(layer); _renderLayerList(); _render(); _saveState(); }
    }, 150);
  });
  // 'change' fires when the user commits (mouseup, blur, etc.) — respond immediately.
  settingsPanel?.addEventListener('change', () => {
    clearTimeout(_settingsInputTimer);
    const layer = layers.find(l => l.id === selectedId);
    if (layer) { _readSettingsFromUI(layer); _renderLayerList(); _render(); _saveState(); }
  });

  // ── Import modal ─────────────────────────────────────────────────────
  const importOverlay = $('import-file-overlay');
  const treeMapOverlay = $('tree-map-overlay');
  let _importType = 'auto';

  // ── Layout mode ──────────────────────────────────────────────────────
  const welcomeOverlay = $('welcome-overlay');

  function _enterLayoutMode() {
    if (_layoutMode) return;
    _layoutMode = true;

    // Save and hide all non-basemap layers (frame stays visible for reference)
    _preLayoutVisibilities = {};
    for (const layer of layers) {
      if (layer.type !== LAYER_TYPES.BASEMAP && layer.type !== LAYER_TYPES.FRAME) {
        _preLayoutVisibilities[layer.id] = layer.visible;
        layer.visible = false;
      }
    }

    // Force-select the basemap layer and show its settings
    const basemap = layers.find(l => l.type === LAYER_TYPES.BASEMAP);
    if (basemap) {
      selectedId = basemap.id;
      _openPanel(settingsPanel, 'settings-pinned');
      _showSettingsForLayer(selectedId);
    }

    // Show the layer panel and standard layers section
    _openPanel(layerPanel);
    const stdLayersEl = $('layout-std-layers');
    if (stdLayersEl) {
      stdLayersEl.style.display = '';
      _populateStandardLayers();
    }

    document.body.classList.add('layout-mode');
    $('btn-layout-mode')?.classList.add('active');
    _renderLayerList();
    _render();
    _saveState();
  }

  function _exitLayoutMode() {
    if (!_layoutMode) return;
    _layoutMode = false;

    // Restore layer visibilities
    for (const layer of layers) {
      if (_preLayoutVisibilities[layer.id] !== undefined) {
        layer.visible = _preLayoutVisibilities[layer.id];
      }
    }
    _preLayoutVisibilities = {};

    // Hide the standard layers section
    const stdLayersEl = $('layout-std-layers');
    if (stdLayersEl) stdLayersEl.style.display = 'none';

    document.body.classList.remove('layout-mode');
    $('btn-layout-mode')?.classList.remove('active');

    _renderLayerList();
    _render();
    _saveState();
  }

  function _populateStandardLayers() {
    const list = $('std-layers-list');
    if (!list) return;
    list.innerHTML = '';
    for (const def of NE_STANDARD_LAYERS) {
      const btn = document.createElement('button');
      btn.className = 'sx-std-layer-btn';
      btn.dataset.neId = def.id;
      btn.innerHTML = `<i class="bi bi-plus-lg me-1"></i>${_escapeHtml(def.name)}`;
      btn.title = `Add ${def.name} as a GeoJSON layer`;
      list.appendChild(btn);
    }
  }

  $('std-layers-list')?.addEventListener('click', async e => {
    const btn = e.target.closest('[data-ne-id]');
    if (!btn) return;
    const def = NE_STANDARD_LAYERS.find(d => d.id === btn.dataset.neId);
    if (!def) return;

    btn.disabled = true;
    btn.innerHTML = '<i class="bi bi-hourglass-split me-1"></i>Loading…';

    try {
      // Determine which file to fetch
      const outlineId = def.landId || def.countriesId;
      const urlEntry = MAP_OUTLINES.find(o => o.id === outlineId);
      const url = urlEntry?.url;
      if (!url) throw new Error('No URL for ' + outlineId);

      const topo = await fetch(url).then(r => { if (!r.ok) throw new Error(r.statusText); return r.json(); });
      const key  = Object.keys(topo.objects)[0];
      const geoData = topojson.feature(topo, topo.objects[key]);

      const newLayer = createLayer(LAYER_TYPES.GEOJSON, def.name, geoData);
      // Insert above basemap, below frame
      const frameIdx = _frameIndex();
      layers.splice(frameIdx, 0, newLayer);
      _ensureFixedBoundaryLayers();
      _preLayoutVisibilities[newLayer.id] = true; // will be visible on exit

      _populateStandardLayers(); // re-render buttons
      _renderLayerList();
      _render();
      _saveState();
    } catch (err) {
      console.error('Failed to load standard layer:', err);
      btn.disabled = false;
      btn.innerHTML = `<i class="bi bi-exclamation-triangle me-1"></i>${_escapeHtml(def.name)}`;
    }
  });

  // Welcome overlay (shown on first load — no saved state)
  function _showWelcome() {
    if (!welcomeOverlay) return;
    welcomeOverlay.style.display = '';
    _render(); // render default map behind it
  }

  welcomeOverlay?.querySelectorAll('[data-bmsource]').forEach(card => {
    card.addEventListener('click', () => {
      const src = card.dataset.bmsource;
      const basemap = layers.find(l => l.type === LAYER_TYPES.BASEMAP);
      if (basemap) {
        basemap.style.basemapSource = src;
        // Natural Earth sources use Natural Earth's standard projection
        if (src !== 'd3') basemap.style.projection = 'geoNaturalEarth1';
      }
      welcomeOverlay.style.display = 'none';
      _enterLayoutMode();
    });
  });

  function _openImportModal(type) {
    _importType = type || 'auto';
    $('import-layer-type').value = _importType;
    importOverlay?.classList.add('open');
  }

  function _closeImportModal() { importOverlay?.classList.remove('open'); }

  $('btn-import-close')?.addEventListener('click', _closeImportModal);
  $('btn-import-auto')?.addEventListener('click', () => _openImportModal('auto'));
  $('btn-file-choose')?.addEventListener('click', () => $('file-input')?.click());
  $('file-input')?.addEventListener('change', e => {
    const file = e.target.files?.[0];
    if (file) { _importFile(file); _closeImportModal(); }
  });

  // Wire drop zone in modal
  const dropZone = $('file-drop-zone');
  if (dropZone) wireDropZone(dropZone, file => { if (file) { _importFile(file); _closeImportModal(); } });

  // Wire drop on map SVG
  const canvasWrapper = $('canvas-wrapper');
  if (canvasWrapper) wireDropZone(canvasWrapper, file => { if (file) _importFile(file); }, { checkContains: true });

  // Space + drag pans the projection center (lon/lat), not the zoom transform.
  let _spaceHeld = false;
  let _projectionDragging = false;
  let _lastDragX = 0;
  let _lastDragY = 0;
  let _statusBeforeSpaceHint = '';

  function _getBasemapCenter() {
    return layers.find(l => l.type === LAYER_TYPES.BASEMAP)?.style?.center || [0, 0];
  }

  function _formatCoord(v, posLabel, negLabel) {
    const abs = Math.abs(Number(v) || 0).toFixed(2);
    return `${abs}${v >= 0 ? posLabel : negLabel}`;
  }

  function _setSpaceHint(lonOnly = false) {
    if (!statusStats) return;
    const [lon, lat] = _getBasemapCenter();
    statusStats.textContent = `Space-drag${lonOnly ? ' (lon only)' : ''}: center ${_formatCoord(lat, 'N', 'S')} ${_formatCoord(lon, 'E', 'W')}`;
  }

  function _restoreStatusAfterSpaceHint() {
    if (!statusStats) return;
    statusStats.textContent = _statusBeforeSpaceHint || '';
    if (!statusStats.textContent) _updateSelectedGeoJSONStatus();
  }

  function _updateSelectedGeoJSONStatus() {
    if (!statusStats || _spaceHeld) return;
    const selected = layers.find(l => l.id === selectedId);
    if (!selected || selected.type !== LAYER_TYPES.GEOJSON) {
      if (statusStats.dataset.mode === 'geojson') {
        statusStats.textContent = '';
        delete statusStats.dataset.mode;
      }
      return;
    }

    const stats = renderer.getGeoJSONRenderStats(selected.id);
    if (!stats) return;

    if (stats.hiddenByZoom) {
      statusStats.textContent = `GeoJSON: 0/${stats.totalFeatures} visible (zoom ${stats.zoomScale.toFixed(2)} < ${stats.minZoom.toFixed(2)})`;
    } else {
      const capped = stats.capped ? `, capped at ${stats.maxVisibleFeatures}` : '';
      statusStats.textContent = `GeoJSON: ${stats.renderedFeatures}/${stats.totalFeatures} visible (${stats.inViewFeatures} in view${capped})`;
    }
    statusStats.dataset.mode = 'geojson';
  }

  function _isEditableTarget(el) {
    if (!el) return false;
    if (el.isContentEditable) return true;
    const tag = el.tagName?.toLowerCase();
    return tag === 'input' || tag === 'textarea' || tag === 'select';
  }

  window.addEventListener('keydown', e => {
    if (e.code !== 'Space') return;
    if (_isEditableTarget(e.target)) return;
    if (!_spaceHeld) {
      _statusBeforeSpaceHint = statusStats?.textContent || '';
    }
    e.preventDefault();
    _spaceHeld = true;
    renderer.setSpacePanActive(true);
    _setSpaceHint();
  });

  window.addEventListener('keyup', e => {
    if (e.code !== 'Space') return;
    _spaceHeld = false;
    _projectionDragging = false;
    renderer.setSpacePanActive(false);
    _restoreStatusAfterSpaceHint();
    _saveState();
  });

  canvasWrapper?.addEventListener('pointerdown', e => {
    if (!_spaceHeld) return;
    _projectionDragging = true;
    _lastDragX = e.clientX;
    _lastDragY = e.clientY;
    canvasWrapper.setPointerCapture?.(e.pointerId);
    e.preventDefault();
    e.stopPropagation();
  });

  canvasWrapper?.addEventListener('pointermove', e => {
    if (!_projectionDragging) return;
    const dx = e.clientX - _lastDragX;
    const dy = e.clientY - _lastDragY;
    _lastDragX = e.clientX;
    _lastDragY = e.clientY;

    const lonOnly = e.shiftKey;
    const moved = lonOnly
      ? renderer.panProjectionLongitudeByPixels(dx)
      : renderer.panProjectionByPixels(dx, dy);

    if (moved) {
      _setSpaceHint(lonOnly);
      _queueRender();
    }

    e.preventDefault();
    e.stopPropagation();
  });

  const _endProjectionDrag = e => {
    if (!_projectionDragging) return;
    _projectionDragging = false;
    _saveState();
    e?.preventDefault?.();
    e?.stopPropagation?.();
  };

  canvasWrapper?.addEventListener('pointerup', _endProjectionDrag);
  canvasWrapper?.addEventListener('pointercancel', _endProjectionDrag);
  canvasWrapper?.addEventListener('pointerleave', e => {
    if (_projectionDragging && !_spaceHeld) _endProjectionDrag(e);
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
    const detected = detectFileType(text, filename);
    let layerType, data;

    if (forced !== 'auto') {
      layerType = forced;
    } else {
      // Map detected type to layer type
      switch (detected.type) {
        case 'topojson':
        case 'geojson':
          layerType = LAYER_TYPES.GEOJSON;
          break;
        case 'points-json':
        case 'csv':
          layerType = LAYER_TYPES.POINTS;
          break;
        case 'newick':
          layerType = LAYER_TYPES.TREE;
          break;
        default:
          console.warn('Could not auto-detect type for', filename);
          layerType = LAYER_TYPES.GEOJSON; // fallback
      }
    }

    // Parse data
    switch (layerType) {
      case LAYER_TYPES.GEOJSON:
        data = parseGeoData(detected.data, topojson);
        break;
      case LAYER_TYPES.POINTS:
        data = detected.type === 'csv' ? parseCSV(detected.data) :
               Array.isArray(detected.data) ? detected.data : parseCSV(text);
        break;
      case LAYER_TYPES.TREE: {
        const analysis = analyzeTreeAnnotations(detected.data);
        let mapping = {
          longitudeKey: analysis.suggested.longitudeKey || '',
          latitudeKey: analysis.suggested.latitudeKey || '',
          hpdKey: analysis.suggested.hpdKey || '',
          locationKey: analysis.suggested.locationKey || '',
          posteriorKey: analysis.suggested.posteriorKey || '',
        };

        if (analysis.hasBeastAnnotations) {
          const chosen = await _openTreeMappingDialog(analysis);
          if (!chosen) {
            $('status-stats').textContent = `Import cancelled: ${filename}`;
            return;
          }
          mapping = chosen;
        }

        data = parseTreeData(detected.data, mapping);
        break;
      }
      default:
        data = detected.data;
    }

    const name = filename.replace(/\.[^.]+$/, '');
    const layer = createLayer(layerType, name, data);
    if (/^admin[ _]?1$/i.test(name) || /^admin[ _]?2$/i.test(name)) {
      layer.visible = false;
    }
    _applyNamedGeojsonPerformanceProfile(layer);
    layers.push(layer);
    _ensureFixedBoundaryLayers();
    selectedId = layer.id;

    _renderLayerList();
    _showSettingsForLayer(selectedId);
    _render();
    _saveState();

    if (layerType === LAYER_TYPES.TREE && data?.metadata) {
      $('status-stats').textContent = `Imported: ${filename} (${data.metadata.nodeCount} nodes, ${data.metadata.branchCount} branches)`;
    } else {
      $('status-stats').textContent = `Imported: ${filename}`;
    }
  }

  function _findAdmin1Index() {
    return layers.findIndex(l =>
      l.type === LAYER_TYPES.GEOJSON &&
      /^admin[ _]?1$/i.test((l.name || '').trim()));
  }

  function _normalizedLayerName(layer) {
    return (layer?.name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  function _isAlwaysOnGeoLayer(layer) {
    if (!layer || layer.type !== LAYER_TYPES.GEOJSON) return false;
    const n = _normalizedLayerName(layer);
    return n === 'admin0';
  }

  function _isLockedLayer(layer) {
    if (!layer) return false;
    return layer.type === LAYER_TYPES.BASEMAP || layer.type === LAYER_TYPES.FRAME;
  }

  function _applyNamedGeojsonPerformanceProfile(layer) {
    if (!layer || layer.type !== LAYER_TYPES.GEOJSON) return;
    const n = _normalizedLayerName(layer);

    if (n === 'oceanmask' || n === 'oceans') {
      layer.visible = true;
      layer.style.autoPerf = true;
      layer.style.simplify = 3;
      layer.style.oceanFill = layer.style.oceanFill || layer.style.fill || '#0a3340';
      layer.style.landFill = layer.style.landFill || '#1a3a2a';
      layer.style.landBoundaryStroke = layer.style.landBoundaryStroke || '#4a8a5a';
      layer.style.landBoundaryWidth = layer.style.landBoundaryWidth ?? 0.5;
      return;
    }

    if (n === 'admin0' || n === 'countries') {
      layer.visible = true;
      layer.style.autoPerf = true;
      layer.style.simplify = 2;
      return;
    }

    if (n === 'admin1') {
      layer.style.autoPerf = true;
      layer.style.simplify = 2;
      return;
    }

    if (n === 'admin2') {
      layer.style.autoPerf = true;
      layer.style.simplify = 3;
    }
  }

  let _worldBankTopologyPromise = null;

  async function _loadWorldBankTopology() {
    if (!_worldBankTopologyPromise) {
      _worldBankTopologyPromise = fetch('data/maps/WorldBank.json')
        .then(response => {
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          return response.json();
        });
    }
    return _worldBankTopologyPromise;
  }

  async function _loadDefaultOceansLayer() {
    if (layers.some(l => l.type === LAYER_TYPES.GEOJSON && _normalizedLayerName(l) === 'oceans')) return;
    try {
      const json = await _loadWorldBankTopology();
      const data = {
        _sxFormat: 'topojson-object',
        topology: json,
        objectName: 'Ocean_Mask',
      };
      const layer = createLayer(LAYER_TYPES.GEOJSON, 'Oceans', data);
      layer.style.fill = '#0a3340';
      layer.style.fillOpacity = 0.22;
      layer.style.stroke = '#0a3340';
      layer.style.strokeWidth = 0;
      layer.visible = true;
      _applyNamedGeojsonPerformanceProfile(layer);

      const frameIdx = _frameIndex();
      const insertAt = frameIdx > 0 ? frameIdx : layers.length;
      layers.splice(insertAt, 0, layer);
      _ensureFixedBoundaryLayers();
    } catch (err) {
      console.warn('Could not auto-load Oceans layer:', err);
    }
  }

  async function _loadDefaultCountriesLayer() {
    if (layers.some(l => l.type === LAYER_TYPES.GEOJSON && _normalizedLayerName(l) === 'countries')) return;
    try {
      const json = await _loadWorldBankTopology();
      const data = {
        _sxFormat: 'topojson-object',
        topology: json,
        objectName: 'Admin_0',
      };
      const layer = createLayer(LAYER_TYPES.GEOJSON, 'Countries', data);
      layer.style.fillOpacity = 0;
      layer.style.stroke = '#6a6a6a';
      layer.style.strokeWidth = 0.7;
      layer.visible = true;
      _applyNamedGeojsonPerformanceProfile(layer);

      const frameIdx = layers.findIndex(l => l.type === LAYER_TYPES.FRAME);
      const insertAt = frameIdx > 0 ? frameIdx : layers.length;
      layers.splice(insertAt, 0, layer);
      _ensureFixedBoundaryLayers();
    } catch (err) {
      console.warn('Could not auto-load Countries layer:', err);
    }
  }

  async function _loadDefaultAdminDetailLayers() {
    const items = [
      { objectName: 'Admin_1', name: 'Admin1' },
      { objectName: 'Admin_2', name: 'Admin2' },
    ];

    let topology = null;

    for (const item of items) {
      const exists = layers.some(l => l.type === LAYER_TYPES.GEOJSON && _normalizedLayerName(l) === item.name.toLowerCase().replace(/[^a-z0-9]/g, ''));
      if (exists) continue;
      try {
        topology = topology || await _loadWorldBankTopology();
        const data = {
          _sxFormat: 'topojson-object',
          topology,
          objectName: item.objectName,
        };
        const layer = createLayer(LAYER_TYPES.GEOJSON, item.name, data);
        layer.visible = false;
        layer.style.fillOpacity = 0;
        layer.style.stroke = item.name === 'Admin1' ? '#5d5d5d' : '#4d4d4d';
        layer.style.strokeWidth = item.name === 'Admin1' ? 0.45 : 0.35;
        _applyNamedGeojsonPerformanceProfile(layer);

        const frameIdx = _frameIndex();
        const insertAt = frameIdx > 0 ? frameIdx : layers.length;
        layers.splice(insertAt, 0, layer);
      } catch (err) {
        console.warn(`Could not auto-load ${item.name} layer:`, err);
      }
    }

    _ensureFixedBoundaryLayers();
  }

  async function _openTreeMappingDialog(analysis) {
    if (!treeMapOverlay) return null;

    const summary = $('tree-map-summary');
    const lonSel = $('tree-map-lon');
    const latSel = $('tree-map-lat');
    const hpdSel = $('tree-map-hpd');
    const locSel = $('tree-map-location');
    const postSel = $('tree-map-posterior');
    const btnClose = $('btn-tree-map-close');
    const btnCancel = $('btn-tree-map-cancel');
    const btnContinue = $('btn-tree-map-continue');

    if (!lonSel || !latSel || !hpdSel || !locSel || !postSel || !btnContinue) {
      return null;
    }

    const keys = analysis.annotationKeys || [];
    const options = [''].concat(keys);
    const defaultLat = keys.includes('location1')
      ? 'location1'
      : (analysis.suggested.latitudeKey || '');
    const defaultLon = keys.includes('location2')
      ? 'location2'
      : (analysis.suggested.longitudeKey || '');

    const fillSelect = (sel, selected, labelForNone = 'None') => {
      sel.innerHTML = '';
      for (const k of options) {
        const opt = document.createElement('option');
        opt.value = k;
        opt.textContent = k || labelForNone;
        if (k === selected) opt.selected = true;
        sel.appendChild(opt);
      }
    };

    fillSelect(latSel, defaultLat);
    fillSelect(lonSel, defaultLon);
    fillSelect(hpdSel, analysis.suggested.hpdKey || '');
    fillSelect(locSel, analysis.suggested.locationKey || '');
    fillSelect(postSel, analysis.suggested.posteriorKey || '');

    if (summary) {
      const mode = analysis.likelyContinuous && analysis.likelyDiscrete
        ? 'continuous + discrete'
        : analysis.likelyContinuous
          ? 'continuous'
          : analysis.likelyDiscrete
            ? 'discrete'
            : 'unknown';
      summary.textContent = `Detected ${keys.length} annotation fields (${mode} phylogeography likely).`;
    }

    treeMapOverlay.classList.add('open');

    return new Promise(resolve => {
      const finish = (result) => {
        treeMapOverlay.classList.remove('open');
        btnContinue.removeEventListener('click', onContinue);
        btnCancel?.removeEventListener('click', onCancel);
        btnClose?.removeEventListener('click', onCancel);
        resolve(result);
      };

      const onCancel = () => finish(null);
      const onContinue = () => {
        finish({
          longitudeKey: lonSel.value,
          latitudeKey: latSel.value,
          hpdKey: hpdSel.value,
          locationKey: locSel.value,
          posteriorKey: postSel.value,
        });
      };

      btnContinue.addEventListener('click', onContinue);
      btnCancel?.addEventListener('click', onCancel);
      btnClose?.addEventListener('click', onCancel);
    });
  }

  // ── Commands ─────────────────────────────────────────────────────────
  commands.get('import').exec = () => _openImportModal('auto');
  commands.get('export').exec = () => exporter.open();

  document.addEventListener('keydown', e => {
    for (const [, cmd] of commands.getAll()) {
      if (cmd.shortcut && commands.matchesShortcut(e, cmd.shortcut) && cmd.enabled) {
        e.preventDefault(); cmd.exec?.(); return;
      }
    }
    if (e.key === 'Escape') {
      if (treeMapOverlay?.classList.contains('open')) {
        $('btn-tree-map-cancel')?.click();
        return;
      }
      _projectionDragging = false;
      _spaceHeld = false;
      renderer.setSpacePanActive(false);
      _restoreStatusAfterSpaceHint();
      _closeImportModal();
      if (!layerPinned) _closePanel(layerPanel, 'layers-pinned');
      if (!settingsPinned) _closePanel(settingsPanel, 'settings-pinned');
    }
  });

  // Reset zoom button
  $('btn-reset-zoom')?.addEventListener('click', () => renderer.resetZoom());
  $('btn-reset-orientation')?.addEventListener('click', async () => {
    const base = layers.find(l => l.type === LAYER_TYPES.BASEMAP);
    if (!base) return;

    base.style.center = [0, 0];
    base.style.rotate = [0, 0, 0];

    if (_spaceHeld) _setSpaceHint();
    else $('status-stats').textContent = 'Map orientation reset';

    if (selectedId === base.id) _showSettingsForLayer(selectedId);
    await _render();
    _saveState();
  });

  // Layout mode toggle
  $('btn-layout-mode')?.addEventListener('click', () => {
    _layoutMode ? _exitLayoutMode() : _enterLayoutMode();
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
  await _loadDefaultOceansLayer();
  await _loadDefaultCountriesLayer();
  await _loadDefaultAdminDetailLayers();
  _renderLayerList();
  _showSettingsForLayer(selectedId);
  await _render();

  // Open layer panel by default
  _openPanel(layerPanel);
}

/* ── Helpers ───────────────────────────────────────────────────────── */

function _escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}
