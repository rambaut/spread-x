import { FRAME_PADDING_UI } from '../config.js';

export function isOceansLayer(layer = {}) {
  if (!layer || layer.type !== 'geojson') return false;
  const name = String(layer.name || '').toLowerCase().trim().replace(/[^a-z0-9]/g, '');
  return name === 'oceans' || name === 'oceanmask';
}

export function syncOceanLayerUI({ getEl, layer } = {}) {
  const oceanSection = getEl?.('settings-geojson-ocean-extra');
  if (!oceanSection) return;
  oceanSection.style.display = isOceansLayer(layer) ? '' : 'none';
}

export function syncGeoJSONPerfUI({ getEl, layer, autoGeojsonPerfPolicy } = {}) {
  const autoPerf = getEl?.('set-gj-perf-auto')?.checked !== false;
  const adaptiveSimplify = getEl?.('set-gj-adaptive-simplify')?.checked !== false;
  const minZoom = getEl?.('set-gj-min-zoom');
  const maxVisible = getEl?.('set-gj-max-visible');
  const simplify = getEl?.('set-gj-simplify');
  const maxSimplify = getEl?.('set-gj-max-simplify');
  const detailZoom = getEl?.('set-gj-detail-zoom');

  if (autoPerf && typeof autoGeojsonPerfPolicy === 'function' && layer) {
    const policy = autoGeojsonPerfPolicy(layer);
    if (policy) {
      if (minZoom && Number.isFinite(+policy.minZoom)) minZoom.value = +policy.minZoom;
      if (maxVisible && Number.isFinite(+policy.maxVisibleFeatures)) maxVisible.value = +policy.maxVisibleFeatures;
    }
  }

  if (minZoom) minZoom.disabled = autoPerf;
  if (maxVisible) maxVisible.disabled = autoPerf;
  if (simplify) simplify.disabled = false;
  if (maxSimplify) maxSimplify.disabled = !adaptiveSimplify;
  if (detailZoom) detailZoom.disabled = !adaptiveSimplify;
}

export function syncBasemapModeUI({ getEl } = {}) {
  const mode = getEl?.('set-bm-mode')?.value || 'globe';
  const geographic = mode === 'geographic';
  if (getEl?.('settings-bm-globe-group')) getEl('settings-bm-globe-group').style.display = geographic ? 'none' : '';
  if (getEl?.('settings-bm-geographic-group')) getEl('settings-bm-geographic-group').style.display = geographic ? '' : 'none';

  const enabled = getEl?.('set-bm-globe-on')?.checked !== false;
  for (const id of ['set-bm-land', 'set-bm-land-boundaries', 'set-bm-country-boundaries']) {
    if (getEl?.(id)) getEl(id).disabled = !enabled;
  }

  const outlineEnabled = enabled && ((getEl?.('set-bm-land-boundaries')?.checked !== false) || (getEl?.('set-bm-country-boundaries')?.checked !== false));
  if (getEl?.('set-bm-globe-outline')) getEl('set-bm-globe-outline').disabled = !outlineEnabled;
  if (getEl?.('set-bm-globe-outline-sw')) getEl('set-bm-globe-outline-sw').disabled = !outlineEnabled;

  const geographicSource = getEl?.('set-bm-geographic-source')?.value || 'raster';
  if (getEl?.('settings-bm-geographic-raster-group')) getEl('settings-bm-geographic-raster-group').style.display = (geographic && geographicSource === 'raster') ? '' : 'none';
  if (getEl?.('settings-bm-geographic-vector-group')) getEl('settings-bm-geographic-vector-group').style.display = (geographic && geographicSource === 'vector') ? '' : 'none';

  const showCountries = getEl?.('set-bm-geographic-countries-on')?.checked !== false;
  for (const id of ['set-bm-geographic-country-scale', 'set-bm-geographic-country-stroke', 'set-bm-geographic-country-width', 'set-bm-geographic-country-opacity']) {
    if (getEl?.(id)) getEl(id).disabled = !showCountries;
  }
}

export function populateSettingsForLayer({
  layer,
  layerTypes,
  getEl,
  pointFields,
  normalizeScale,
  populateGeographicRasterSetOptions,
  getCanvasToSvgThreshold,
  autoGeojsonPerfPolicy,
} = {}) {
  if (!layer || !getEl) return;

  const s = layer.style || {};
  switch (layer.type) {
    case layerTypes.BASEMAP:
      getEl('set-bm-mode').value = s.baseMode || 'globe';
      getEl('set-bm-projection').value = s.projection;
      getEl('set-bm-bg').value = s.backgroundFill || '#ffffff';
      getEl('set-bm-grat').checked = s.showGraticule !== false;
      getEl('set-bm-grat-step').value = s.graticuleStep ?? 10;
      getEl('set-bm-grat-stroke').value = s.graticuleStroke || '#ffffff';
      getEl('set-bm-grat-opacity').value = s.graticuleOpacity ?? 0.1;
      getEl('set-bm-proj-boundary').value = s.projectionBoundaryStroke || '#4a8a5a';
      getEl('set-bm-proj-boundary-sw').value = s.projectionBoundaryWidth ?? 1;
      getEl('set-bm-globe-on').checked = s.showGlobe !== false;
      getEl('set-bm-water').value = s.oceanFill || '#02292e';
      getEl('set-bm-land').value = s.landFill || '#1a3a2a';
      getEl('set-bm-land-boundaries').checked = s.showLandBoundaries !== false;
      getEl('set-bm-country-boundaries').checked = s.showCountryBoundaries !== false;
      getEl('set-bm-globe-outline').value = s.landBoundaryStroke || '#4a8a5a';
      getEl('set-bm-globe-outline-sw').value = s.landBoundaryWidth ?? 0.5;
      getEl('set-bm-geographic-source').value = s.geographicSourceType || 'raster';
      populateGeographicRasterSetOptions?.(s.geographicRasterSet || 'NE1');
      getEl('set-bm-geographic-vector-scale').value = normalizeScale(s.geographicVectorScale, '50m');
      getEl('set-bm-geographic-ocean').value = s.geographicOceanFill || '#0d2f40';
      getEl('set-bm-geographic-land').value = s.geographicLandFill || '#9aa876';
      getEl('set-bm-geographic-countries-on').checked = s.geographicShowCountries !== false;
      getEl('set-bm-geographic-country-scale').value = normalizeScale(s.geographicCountryScale, '50m');
      getEl('set-bm-geographic-country-stroke').value = s.geographicCountryStroke || '#3e3e3e';
      getEl('set-bm-geographic-country-width').value = s.geographicCountryStrokeWidth ?? 0.45;
      getEl('set-bm-geographic-country-opacity').value = s.geographicCountryOpacity ?? 0.65;
      syncBasemapModeUI({ getEl });
      break;
    case layerTypes.GEOJSON:
      getEl('set-gj-fill').value = s.fill;
      getEl('set-gj-fill-op').value = s.fillOpacity;
      getEl('set-gj-stroke').value = s.stroke;
      getEl('set-gj-sw').value = s.strokeWidth;
      if (getEl('set-gj-perf-auto')) getEl('set-gj-perf-auto').checked = s.autoPerf !== false;
      if (getEl('set-gj-min-zoom')) getEl('set-gj-min-zoom').value = Number.isFinite(+s.minZoom) ? +s.minZoom : 2;
      if (getEl('set-gj-max-visible')) getEl('set-gj-max-visible').value = Number.isFinite(+s.maxVisible) ? +s.maxVisible : 2000;
      if (getEl('set-gj-simplify')) {
        const baseSimplify = Number.isFinite(+s.simplify)
          ? +s.simplify
          : (Number.isFinite(+s.minSimplify) ? +s.minSimplify : 0);
        getEl('set-gj-simplify').value = baseSimplify;
      }
      if (getEl('set-gj-adaptive-simplify')) getEl('set-gj-adaptive-simplify').checked = s.adaptiveSimplify !== false;
      if (getEl('set-gj-max-simplify')) getEl('set-gj-max-simplify').value = Number.isFinite(+s.maxSimplify) ? +s.maxSimplify : 4;
      if (getEl('set-gj-detail-zoom')) getEl('set-gj-detail-zoom').value = Number.isFinite(+s.detailZoom) ? +s.detailZoom : 8;
      if (getEl('set-render-svg-switch-zoom')) {
        const threshold = Number(getCanvasToSvgThreshold?.());
        getEl('set-render-svg-switch-zoom').value = Number.isFinite(threshold) ? threshold : 8;
      }
      syncOceanLayerUI({ getEl, layer });
      syncGeoJSONPerfUI({ getEl, layer, autoGeojsonPerfPolicy });
      break;
    case layerTypes.FRAME:
      getEl('set-fr-aspect').value = s.aspectPreset;
      getEl('set-fr-fill-on').checked = s.showFill !== false;
      getEl('set-fr-fill').value = s.fill;
      getEl('set-fr-fill-op').value = s.fillOpacity;
      getEl('set-fr-stroke').value = s.stroke;
      getEl('set-fr-sw').value = s.strokeWidth;
      if (getEl('set-fr-padding')) {
        const pad = Number(
          s.padding ?? s.margin ?? FRAME_PADDING_UI.defaultValue
        );
        getEl('set-fr-padding').value = Math.max(FRAME_PADDING_UI.min, Math.min(FRAME_PADDING_UI.max, pad));
      }
      break;
    case layerTypes.POINTS:
      getEl('set-pt-radius').value = s.radius;
      getEl('set-pt-fill').value = s.fill;
      getEl('set-pt-fill-op').value = s.fillOpacity;
      getEl('set-pt-stroke').value = s.stroke;
      getEl('set-pt-sw').value = s.strokeWidth;
      getEl('set-pt-label-sz').value = s.labelSize;
      {
        const labelSel = getEl('set-pt-label');
        labelSel.innerHTML = '<option value="">None</option>';
        if (layer.data) {
          for (const f of pointFields(layer.data)) {
            const opt = document.createElement('option');
            opt.value = opt.textContent = f;
            if (f === s.labelField) opt.selected = true;
            labelSel.appendChild(opt);
          }
        }
      }
      break;
    case layerTypes.TREE:
      getEl('set-tr-style').value = s.branchStyle;
      getEl('set-tr-color').value = s.branchColor;
      getEl('set-tr-width').value = s.branchWidth;
      getEl('set-tr-op').value = s.branchOpacity;
      getEl('set-tr-node-color').value = s.nodeColor;
      getEl('set-tr-node-r').value = s.nodeRadius;
      getEl('set-tr-node-op').value = s.nodeOpacity;
      break;
    default:
      break;
  }
}

export function readSettingsFromLayerUI({
  layer,
  layerTypes,
  getEl,
  normalizeScale,
  isLayoutMode,
  switchToCanvas,
  setCanvasToSvgThreshold,
  autoGeojsonPerfPolicy,
} = {}) {
  if (!layer || !getEl) return;

  layer.name = getEl('setting-layer-name')?.value || layer.name;
  layer.opacity = +(getEl('setting-layer-opacity')?.value ?? layer.opacity);
  const s = layer.style || {};

  switch (layer.type) {
    case layerTypes.BASEMAP:
      if (!isLayoutMode) return;
      s.baseMode = getEl('set-bm-mode')?.value || 'globe';
      s.projection = getEl('set-bm-projection')?.value;
      s.backgroundFill = getEl('set-bm-bg')?.value;
      s.showGraticule = getEl('set-bm-grat')?.checked;
      s.graticuleStep = +getEl('set-bm-grat-step')?.value;
      s.graticuleStroke = getEl('set-bm-grat-stroke')?.value;
      s.graticuleOpacity = +getEl('set-bm-grat-opacity')?.value;
      s.projectionBoundaryStroke = getEl('set-bm-proj-boundary')?.value;
      s.projectionBoundaryWidth = +getEl('set-bm-proj-boundary-sw')?.value;
      s.showGlobe = getEl('set-bm-globe-on')?.checked;
      s.oceanFill = getEl('set-bm-water')?.value;
      s.landFill = getEl('set-bm-land')?.value;
      s.showLandBoundaries = getEl('set-bm-land-boundaries')?.checked;
      s.showCountryBoundaries = getEl('set-bm-country-boundaries')?.checked;
      s.landBoundaryStroke = getEl('set-bm-globe-outline')?.value;
      s.landBoundaryWidth = +getEl('set-bm-globe-outline-sw')?.value;
      s.datum = 'WGS84';
      s.geographicSourceType = getEl('set-bm-geographic-source')?.value || 'raster';
      s.geographicRasterSet = getEl('set-bm-geographic-raster-set')?.value || 'NE1';
      s.geographicVectorScale = normalizeScale(getEl('set-bm-geographic-vector-scale')?.value, '50m');
      s.geographicOceanFill = getEl('set-bm-geographic-ocean')?.value || '#0d2f40';
      s.geographicLandFill = getEl('set-bm-geographic-land')?.value || '#9aa876';
      s.geographicShowCountries = getEl('set-bm-geographic-countries-on')?.checked;
      s.geographicCountryScale = normalizeScale(getEl('set-bm-geographic-country-scale')?.value, '50m');
      s.geographicCountryStroke = getEl('set-bm-geographic-country-stroke')?.value || '#3e3e3e';
      s.geographicCountryStrokeWidth = +getEl('set-bm-geographic-country-width')?.value;
      s.geographicCountryOpacity = +getEl('set-bm-geographic-country-opacity')?.value;
      if (s.baseMode === 'geographic') {
        s.projection = 'geoEquirectangular';
        s.basemapSource = `ne${s.geographicVectorScale.replace('m', '')}`;
        s.showGlobe = true;
        s.showLandBoundaries = false;
        s.showCountryBoundaries = false;
      }
      if (s.baseMode === 'geographic' && s.geographicSourceType === 'raster') {
        switchToCanvas?.();
      }
      syncBasemapModeUI({ getEl });
      break;
    case layerTypes.GEOJSON:
      s.fill = getEl('set-gj-fill')?.value;
      s.fillOpacity = +getEl('set-gj-fill-op')?.value;
      s.stroke = getEl('set-gj-stroke')?.value;
      s.strokeWidth = +getEl('set-gj-sw')?.value;
      if (getEl('set-gj-perf-auto')) s.autoPerf = getEl('set-gj-perf-auto')?.checked;
      if (getEl('set-gj-min-zoom')) s.minZoom = +getEl('set-gj-min-zoom')?.value;
      if (getEl('set-gj-max-visible')) s.maxVisible = +getEl('set-gj-max-visible')?.value;
      if (getEl('set-gj-simplify')) s.simplify = +getEl('set-gj-simplify')?.value;
      if (getEl('set-gj-adaptive-simplify')) s.adaptiveSimplify = getEl('set-gj-adaptive-simplify')?.checked;
      if (getEl('set-gj-max-simplify')) s.maxSimplify = +getEl('set-gj-max-simplify')?.value;
      if (getEl('set-gj-detail-zoom')) s.detailZoom = +getEl('set-gj-detail-zoom')?.value;
      s.minSimplify = Number.isFinite(+s.simplify) ? +s.simplify : 0;
      if (getEl('set-render-svg-switch-zoom')) {
        setCanvasToSvgThreshold?.(+getEl('set-render-svg-switch-zoom')?.value);
      }
      if (isOceansLayer(layer)) {
        if (getEl('set-oc-ocean')) s.oceanFill = getEl('set-oc-ocean')?.value;
        if (s.oceanFill) s.fill = s.oceanFill;
        if (getEl('set-oc-land')) s.landFill = getEl('set-oc-land')?.value;
        if (getEl('set-oc-boundary')) s.landBoundaryStroke = getEl('set-oc-boundary')?.value;
        if (getEl('set-oc-boundary-sw')) s.landBoundaryWidth = +getEl('set-oc-boundary-sw')?.value;
      }
      syncGeoJSONPerfUI({ getEl, layer, autoGeojsonPerfPolicy });
      break;
    case layerTypes.FRAME:
      s.aspectPreset = getEl('set-fr-aspect')?.value;
      s.showFill = getEl('set-fr-fill-on')?.checked;
      s.fill = getEl('set-fr-fill')?.value;
      s.fillOpacity = +getEl('set-fr-fill-op')?.value;
      s.stroke = getEl('set-fr-stroke')?.value;
      s.strokeWidth = +getEl('set-fr-sw')?.value;
      if (getEl('set-fr-padding')) {
        const pad = Number(getEl('set-fr-padding')?.value);
        s.padding = Math.max(FRAME_PADDING_UI.min, Math.min(FRAME_PADDING_UI.max, Number.isFinite(pad) ? pad : FRAME_PADDING_UI.defaultValue));
      }
      break;
    case layerTypes.POINTS:
      s.radius = +getEl('set-pt-radius')?.value;
      s.fill = getEl('set-pt-fill')?.value;
      s.fillOpacity = +getEl('set-pt-fill-op')?.value;
      s.stroke = getEl('set-pt-stroke')?.value;
      s.strokeWidth = +getEl('set-pt-sw')?.value;
      s.labelField = getEl('set-pt-label')?.value;
      s.labelSize = +getEl('set-pt-label-sz')?.value;
      break;
    case layerTypes.TREE:
      s.branchStyle = getEl('set-tr-style')?.value;
      s.branchColor = getEl('set-tr-color')?.value;
      s.branchWidth = +getEl('set-tr-width')?.value;
      s.branchOpacity = +getEl('set-tr-op')?.value;
      s.nodeColor = getEl('set-tr-node-color')?.value;
      s.nodeRadius = +getEl('set-tr-node-r')?.value;
      s.nodeOpacity = +getEl('set-tr-node-op')?.value;
      break;
    default:
      break;
  }
}

export function bindSettingsPanelHandlers({
  settingsPanel,
  getSelectedLayer,
  applyLayer,
  debounceMs = 150,
} = {}) {
  if (!settingsPanel) return () => {};

  let timer = null;
  const apply = () => {
    const layer = getSelectedLayer?.();
    if (layer) applyLayer?.(layer);
  };

  const onInput = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      apply();
    }, debounceMs);
  };

  const onChange = () => {
    clearTimeout(timer);
    apply();
  };

  settingsPanel.addEventListener('input', onInput);
  settingsPanel.addEventListener('change', onChange);

  return () => {
    clearTimeout(timer);
    settingsPanel.removeEventListener('input', onInput);
    settingsPanel.removeEventListener('change', onChange);
  };
}
