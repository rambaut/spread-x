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
import { createLayer, duplicateLayer, LAYER_TYPES, LAYER_ICONS } from './layers.js';
import { detectFileType, parseGeoData, parseCSV, pointFields } from './parsers.js';
import { createMapRenderer } from './map-renderer.js';

// ── Command definitions ──────────────────────────────────────────────────

const COMMAND_DEFS = [
  { id: 'import', label: 'Import…',        shortcut: 'CmdOrCtrl+O', buttonId: 'btn-import-auto' },
  { id: 'export', label: 'Export Image…',   shortcut: 'CmdOrCtrl+Shift+E', buttonId: 'btn-export' },
];

// ── Main app ─────────────────────────────────────────────────────────────

export async function app(opts = {}) {
  const root = document;
  const $ = id => root.querySelector('#' + id);

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

  // ── Map renderer ─────────────────────────────────────────────────────
  const svgEl = $('map-svg');
  const renderer = createMapRenderer({ svgElement: svgEl, d3, topojson });

  function _resize() {
    const wrapper = $('canvas-wrapper');
    if (!wrapper) return;
    renderer.resize(wrapper.clientWidth, wrapper.clientHeight);
  }
  window.addEventListener('resize', () => { _resize(); _render(); });

  async function _render() {
    _resize();
    renderer.setLayers(layers);
    await renderer.render();
  }

  // ── Create default base-map layer ────────────────────────────────────
  layers.push(createLayer(LAYER_TYPES.BASEMAP, 'Base Map'));
  selectedId = layers[0].id;

  // Restore saved state (layer styles only — data isn't persisted)
  const saved = loadSettings(storageKey);
  if (saved?.layers) {
    for (const sl of saved.layers) {
      const existing = layers.find(l => l.id === sl.id);
      if (existing) Object.assign(existing.style, sl.style);
    }
    if (saved.selectedId) selectedId = saved.selectedId;
  }

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

  // ── Layer list rendering ─────────────────────────────────────────────

  function _renderLayerList() {
    if (!layerList) return;
    layerList.innerHTML = '';
    for (const layer of layers) {
      const el = document.createElement('div');
      el.className = 'sx-layer-item' + (layer.id === selectedId ? ' selected' : '');
      el.dataset.layerId = layer.id;
      el.innerHTML = `
        <button class="sx-layer-vis ${layer.visible ? '' : 'off'}" data-vis="${layer.id}" title="Toggle visibility">
          <i class="bi ${layer.visible ? 'bi-eye' : 'bi-eye-slash'}"></i>
        </button>
        <i class="bi ${LAYER_ICONS[layer.type] || 'bi-square'} sx-layer-icon"></i>
        <span class="sx-layer-name">${_escapeHtml(layer.name)}</span>`;
      layerList.appendChild(el);
    }
    _updateLayerButtons();
  }

  layerList?.addEventListener('click', e => {
    // Visibility toggle
    const visBtn = e.target.closest('[data-vis]');
    if (visBtn) {
      const layer = layers.find(l => l.id === visBtn.dataset.vis);
      if (layer) { layer.visible = !layer.visible; _renderLayerList(); _render(); _saveState(); }
      return;
    }
    // Select
    const item = e.target.closest('.sx-layer-item');
    if (item) {
      selectedId = item.dataset.layerId;
      _renderLayerList();
      _showSettingsForLayer(selectedId);
    }
  });

  function _updateLayerButtons() {
    const sel = layers.find(l => l.id === selectedId);
    const isBase = sel?.type === LAYER_TYPES.BASEMAP;
    $('btn-delete-layer').disabled  = !sel || isBase;
    $('btn-dup-layer').disabled     = !sel;
    const idx = layers.findIndex(l => l.id === selectedId);
    $('btn-move-up').disabled   = idx <= 0;
    $('btn-move-down').disabled = idx < 0 || idx >= layers.length - 1;
  }

  // Layer CRUD buttons
  $('btn-delete-layer')?.addEventListener('click', () => {
    const idx = layers.findIndex(l => l.id === selectedId);
    if (idx < 0 || layers[idx].type === LAYER_TYPES.BASEMAP) return;
    layers.splice(idx, 1);
    selectedId = layers[Math.min(idx, layers.length - 1)]?.id || null;
    _renderLayerList(); _showSettingsForLayer(selectedId); _render(); _saveState();
  });

  $('btn-dup-layer')?.addEventListener('click', () => {
    const src = layers.find(l => l.id === selectedId);
    if (!src) return;
    const dup = duplicateLayer(src);
    const idx = layers.indexOf(src);
    layers.splice(idx + 1, 0, dup);
    selectedId = dup.id;
    _renderLayerList(); _showSettingsForLayer(selectedId); _render(); _saveState();
  });

  $('btn-move-up')?.addEventListener('click', () => _moveLayer(-1));
  $('btn-move-down')?.addEventListener('click', () => _moveLayer(1));

  function _moveLayer(dir) {
    const idx = layers.findIndex(l => l.id === selectedId);
    const to = idx + dir;
    if (idx < 0 || to < 0 || to >= layers.length) return;
    [layers[idx], layers[to]] = [layers[to], layers[idx]];
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

  const SETTINGS_SECTIONS = ['settings-basemap', 'settings-geojson', 'settings-points', 'settings-tree'];

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
        $('set-bm-projection').value      = s.projection;
        $('set-bm-outline').value         = s.outline;
        $('set-bm-ocean').value           = s.oceanFill;
        $('set-bm-land').value            = s.landFill;
        $('set-bm-land-stroke').value     = s.landStroke;
        $('set-bm-land-sw').value         = s.landStrokeWidth;
        $('set-bm-border').value          = s.borderStroke;
        $('set-bm-border-sw').value       = s.borderStrokeWidth;
        $('set-bm-grat').checked          = s.showGraticule;
        $('set-bm-grat-step').value       = s.graticuleStep;
        $('set-bm-grat-stroke').value     = s.graticuleStroke;
        $('set-bm-grat-opacity').value    = s.graticuleOpacity;
        $('set-bm-outline-stroke').value  = s.outlineStroke;
        $('set-bm-outline-sw').value      = s.outlineStrokeWidth;
        break;
      case LAYER_TYPES.GEOJSON:
        $('set-gj-fill').value    = s.fill;
        $('set-gj-fill-op').value = s.fillOpacity;
        $('set-gj-stroke').value  = s.stroke;
        $('set-gj-sw').value      = s.strokeWidth;
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
        s.projection       = $('set-bm-projection')?.value;
        s.outline          = $('set-bm-outline')?.value;
        s.oceanFill        = $('set-bm-ocean')?.value;
        s.landFill         = $('set-bm-land')?.value;
        s.landStroke       = $('set-bm-land-stroke')?.value;
        s.landStrokeWidth  = +$('set-bm-land-sw')?.value;
        s.borderStroke     = $('set-bm-border')?.value;
        s.borderStrokeWidth= +$('set-bm-border-sw')?.value;
        s.showGraticule    = $('set-bm-grat')?.checked;
        s.graticuleStep    = +$('set-bm-grat-step')?.value;
        s.graticuleStroke  = $('set-bm-grat-stroke')?.value;
        s.graticuleOpacity = +$('set-bm-grat-opacity')?.value;
        s.outlineStroke    = $('set-bm-outline-stroke')?.value;
        s.outlineStrokeWidth = +$('set-bm-outline-sw')?.value;
        break;
      case LAYER_TYPES.GEOJSON:
        s.fill        = $('set-gj-fill')?.value;
        s.fillOpacity = +$('set-gj-fill-op')?.value;
        s.stroke      = $('set-gj-stroke')?.value;
        s.strokeWidth = +$('set-gj-sw')?.value;
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

  // Wire all settings inputs for live update
  settingsPanel?.addEventListener('input', () => {
    const layer = layers.find(l => l.id === selectedId);
    if (layer) { _readSettingsFromUI(layer); _renderLayerList(); _render(); _saveState(); }
  });
  settingsPanel?.addEventListener('change', () => {
    const layer = layers.find(l => l.id === selectedId);
    if (layer) { _readSettingsFromUI(layer); _renderLayerList(); _render(); _saveState(); }
  });

  // ── Import modal ─────────────────────────────────────────────────────
  const importOverlay = $('import-file-overlay');
  let _importType = 'auto';

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

  // ── File import logic ────────────────────────────────────────────────

  function _importFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => _processImport(reader.result, file.name);
    reader.readAsText(file);
  }

  function _processImport(text, filename) {
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
      case LAYER_TYPES.TREE:
        data = detected.data; // raw text — tree parser TBD
        break;
      default:
        data = detected.data;
    }

    const name = filename.replace(/\.[^.]+$/, '');
    const layer = createLayer(layerType, name, data);
    layers.push(layer);
    selectedId = layer.id;

    _renderLayerList();
    _showSettingsForLayer(selectedId);
    _render();
    _saveState();

    $('status-stats').textContent = `Imported: ${filename}`;
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
      _closeImportModal();
      if (!layerPinned) _closePanel(layerPanel, 'layers-pinned');
      if (!settingsPinned) _closePanel(settingsPanel, 'settings-pinned');
    }
  });

  // Reset zoom button
  $('btn-reset-zoom')?.addEventListener('click', () => renderer.resetZoom());

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

  // Open layer panel by default
  _openPanel(layerPanel);
}

/* ── Helpers ───────────────────────────────────────────────────────── */

function _escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}
