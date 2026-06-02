import { FRAME_PADDING_UI, GEOJSON_LIMITS, RENDERER_MODE_LIMITS } from '../config.js';

function _clampSimplifyLevel(value) {
  return Math.max(
    GEOJSON_LIMITS.simplifyLevel.min,
    Math.min(GEOJSON_LIMITS.simplifyLevel.max, Math.round(Number(value) || 0))
  );
}

function _clampPercent(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return Math.max(0, Math.min(100, num));
}

function _opacityToPercent(opacityValue) {
  const opacity = Number(opacityValue);
  if (!Number.isFinite(opacity)) return 10;
  if (opacity > 1) return _clampPercent(opacity);
  return _clampPercent(opacity * 100);
}

function _percentToOpacity(percentValue) {
  return _clampPercent(percentValue) / 100;
}

function _clampDetailPercent(value) {
  return Math.max(
    GEOJSON_LIMITS.detailPercent.min,
    Math.min(GEOJSON_LIMITS.detailPercent.max, Math.round(Number(value) || GEOJSON_LIMITS.detailPercent.defaultValue))
  );
}

function _simplifyLevelToDetailPercent(simplifyLevel) {
  const level = _clampSimplifyLevel(simplifyLevel);
  const simplifySpan = GEOJSON_LIMITS.simplifyLevel.max - GEOJSON_LIMITS.simplifyLevel.min;
  const detailSpan = GEOJSON_LIMITS.detailPercent.max - GEOJSON_LIMITS.detailPercent.min;
  if (simplifySpan <= 0 || detailSpan <= 0) return GEOJSON_LIMITS.detailPercent.max;
  const normalized = (level - GEOJSON_LIMITS.simplifyLevel.min) / simplifySpan;
  const detail = GEOJSON_LIMITS.detailPercent.max - Math.round(normalized * detailSpan);
  return _clampDetailPercent(detail);
}

function _presetDetailPercentForIndex(index, total) {
  if (total <= 1) return 100;
  if (index >= total - 1) return 1;
  return Math.max(1, Math.round(100 - ((index * 100) / (total - 1))));
}

function _directLayerDetailOptions() {
  const detailPercents = [20, 40, 60, 80, 100];
  return detailPercents.map(percent => {
    const normalized = (100 - percent) / 100;
    const simplifyLevel = _clampSimplifyLevel(
      GEOJSON_LIMITS.simplifyLevel.min
      + Math.round((GEOJSON_LIMITS.simplifyLevel.max - GEOJSON_LIMITS.simplifyLevel.min) * normalized)
    );
    return {
      simplifyLevel,
      detailPercent: percent,
      label: `${percent}%`,
    };
  }).sort((a, b) => a.detailPercent - b.detailPercent || a.simplifyLevel - b.simplifyLevel);
}

function _presetDetailOptions(style = {}) {
  const levels = Array.isArray(style?.detailLevels)
    ? [...new Set(style.detailLevels
        .map(level => _clampSimplifyLevel(level?.level))
        .filter(Number.isFinite))]
        .sort((a, b) => a - b)
    : [];

  if (!levels.length) return [];

  return levels.map((level, index) => {
    const detailPercent = _presetDetailPercentForIndex(index, levels.length);
    return {
      simplifyLevel: level,
      detailPercent,
      label: `${detailPercent}%`,
    };
  }).sort((a, b) => a.detailPercent - b.detailPercent || a.simplifyLevel - b.simplifyLevel);
}

function _detailOptionsForStyle(style = {}, { presetLinked = false } = {}) {
  if (presetLinked) {
    const preset = _presetDetailOptions(style);
    if (preset.length) return preset;
  }
  return _directLayerDetailOptions();
}

function _updateGeojsonDetailReadout(readoutEl, option) {
  if (!readoutEl) return;
  readoutEl.textContent = option?.label || '';
}

function _selectedGeojsonDetailOption(sliderEl) {
  if (!sliderEl) return null;
  let options = [];
  try {
    options = JSON.parse(sliderEl.dataset.detailOptions || '[]');
  } catch {
    options = [];
  }
  if (!Array.isArray(options) || !options.length) return null;
  const min = Number(sliderEl.min) || 0;
  const max = Number(sliderEl.max) || (options.length - 1);
  const rawIndex = Math.round(Number(sliderEl.value) || 0);
  const index = Math.max(min, Math.min(max, rawIndex));
  return options[index - min] || options[0] || null;
}

function _populateGeojsonDetailControl(sliderEl, readoutEl, style = {}, currentSimplifyLevel = null, { presetLinked = false } = {}) {
  if (!sliderEl) return;
  const options = _detailOptionsForStyle(style, { presetLinked });
  if (!options.length) {
    sliderEl.min = '0';
    sliderEl.max = '0';
    sliderEl.step = '1';
    sliderEl.value = '0';
    sliderEl.dataset.detailOptions = JSON.stringify([{ simplifyLevel: 0, detailPercent: 100, label: '100%' }]);
    _updateGeojsonDetailReadout(readoutEl, { label: '100%' });
    return;
  }

  const requested = Number(currentSimplifyLevel);
  const resolvedLevel = Number.isFinite(requested)
    ? _clampSimplifyLevel(requested)
    : options[0].simplifyLevel;

  let nearestIndex = 0;
  for (let i = 1; i < options.length; i += 1) {
    if (Math.abs(options[i].simplifyLevel - resolvedLevel) < Math.abs(options[nearestIndex].simplifyLevel - resolvedLevel)) {
      nearestIndex = i;
    }
  }

  sliderEl.min = '0';
  sliderEl.max = String(options.length - 1);
  sliderEl.step = '1';
  sliderEl.value = String(nearestIndex);
  sliderEl.dataset.detailOptions = JSON.stringify(options);
  _updateGeojsonDetailReadout(readoutEl, options[nearestIndex]);
}

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
  const adaptiveSimplify = getEl?.('set-gj-adaptive-simplify')?.checked !== false;
  const minZoom = getEl?.('set-gj-min-zoom');
  const detail = getEl?.('set-gj-simplify');
  const adaptiveToggle = getEl?.('set-gj-adaptive-simplify');
  const adaptiveRow = adaptiveToggle?.closest('.sx-setting-row');
  const presetLinked = Array.isArray(layer?.style?.detailLevels) && layer.style.detailLevels.length > 0;

  if (minZoom) minZoom.disabled = false;
  if (adaptiveRow) adaptiveRow.style.display = presetLinked ? '' : 'none';
  if (adaptiveToggle) adaptiveToggle.disabled = !presetLinked;
  if (detail) detail.disabled = presetLinked && adaptiveSimplify;
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

  const showReticule = getEl?.('set-bm-grat')?.checked !== false;
  if (getEl?.('set-bm-proj-boundary')) getEl('set-bm-proj-boundary').disabled = !showReticule;
  if (getEl?.('set-bm-proj-boundary-sw')) getEl('set-bm-proj-boundary-sw').disabled = !showReticule;
  if (getEl?.('set-bm-grat-hide-zoom')) getEl('set-bm-grat-hide-zoom').disabled = !showReticule;

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
  getCurrentGeojsonSimplifyLevel,
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
      getEl('set-bm-grat-width').value = s.graticuleWidth ?? 0.5;
      getEl('set-bm-grat-opacity').value = _opacityToPercent(s.graticuleOpacity ?? 0.1);
      getEl('set-bm-grat-hide-zoom').value = Number.isFinite(+s.graticuleHideInViewZoom) ? +s.graticuleHideInViewZoom : 12;
      getEl('set-bm-proj-boundary').value = s.projectionBoundaryStroke || '#4a8a5a';
      getEl('set-bm-proj-boundary-sw').value = s.projectionBoundaryWidth ?? 1;
      getEl('set-bm-features-detail').value = s.basemapDetailLevel ?? 10;
      getEl('set-bm-features-hide-zoom').value = Number.isFinite(+s.featuresHideInViewZoom)
        ? +s.featuresHideInViewZoom
        : (s.featuresLayoutOnly === true ? 1 : 12);
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
      if (getEl('set-gj-hover-on')) getEl('set-gj-hover-on').checked = s.featureHoverEnabled !== false;
      if (getEl('set-gj-select-on')) getEl('set-gj-select-on').checked = s.featureSelectEnabled !== false;
      getEl('set-gj-fill').value = s.fill;
      getEl('set-gj-fill-op').value = s.fillOpacity;
      getEl('set-gj-stroke').value = s.stroke;
      getEl('set-gj-sw').value = s.strokeWidth;
      if (getEl('set-gj-min-zoom')) getEl('set-gj-min-zoom').value = Number.isFinite(+s.minZoom) ? +s.minZoom : GEOJSON_LIMITS.renderPolicy.minZoomDefault;
      {
        const detailControl = getEl('set-gj-simplify');
        const detailReadout = getEl('set-gj-simplify-readout');
        const presetLinked = Array.isArray(s.detailLevels) && s.detailLevels.length > 0;
        const adaptive = presetLinked ? (s.adaptiveSimplify !== false) : false;
        const liveSimplify = Number(getCurrentGeojsonSimplifyLevel?.(layer));
        let simplifyLevel = GEOJSON_LIMITS.simplifyLevel.defaultValue;

        if (presetLinked) {
          simplifyLevel = Number.isFinite(liveSimplify)
            ? liveSimplify
            : Number(s.detailLevels[0]?.level ?? GEOJSON_LIMITS.simplifyLevel.defaultValue);
        } else {
          simplifyLevel = Number.isFinite(+s.simplify)
            ? +s.simplify
            : (Number.isFinite(liveSimplify) ? liveSimplify : GEOJSON_LIMITS.simplifyLevel.defaultValue);
        }

        _populateGeojsonDetailControl(detailControl, detailReadout, s, simplifyLevel, { presetLinked });

        const adaptiveRow = getEl('set-gj-adaptive-simplify')?.closest('.sx-setting-row');
        if (adaptiveRow) adaptiveRow.style.display = presetLinked ? '' : 'none';
        if (!presetLinked) s.adaptiveSimplify = false;
      }
      if (getEl('set-gj-adaptive-simplify')) getEl('set-gj-adaptive-simplify').checked = s.adaptiveSimplify !== false;
      if (getEl('set-render-svg-switch-zoom')) {
        const threshold = Number(getCanvasToSvgThreshold?.());
        getEl('set-render-svg-switch-zoom').value = Number.isFinite(threshold) ? threshold : RENDERER_MODE_LIMITS.canvasToSvgSwitchDefault;
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
      s.graticuleWidth = +getEl('set-bm-grat-width')?.value;
      s.graticuleOpacity = _percentToOpacity(getEl('set-bm-grat-opacity')?.value);
      s.graticuleHideInViewZoom = +getEl('set-bm-grat-hide-zoom')?.value;
      s.projectionBoundaryStroke = getEl('set-bm-proj-boundary')?.value;
      s.projectionBoundaryWidth = +getEl('set-bm-proj-boundary-sw')?.value;
      s.basemapDetailLevel = Math.max(0, Math.min(10, Math.round(+getEl('set-bm-features-detail')?.value || 0)));
      s.featuresHideInViewZoom = +getEl('set-bm-features-hide-zoom')?.value;
      s.featuresLayoutOnly = Number.isFinite(s.featuresHideInViewZoom) && s.featuresHideInViewZoom <= 1;
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
      s.featureHoverEnabled = getEl('set-gj-hover-on')?.checked !== false;
      s.featureSelectEnabled = getEl('set-gj-select-on')?.checked !== false;
      s.fill = getEl('set-gj-fill')?.value;
      s.fillOpacity = +getEl('set-gj-fill-op')?.value;
      s.stroke = getEl('set-gj-stroke')?.value;
      s.strokeWidth = +getEl('set-gj-sw')?.value;
      s.autoPerf = false;
      if (getEl('set-gj-min-zoom')) s.minZoom = +getEl('set-gj-min-zoom')?.value;
      const presetLinked = Array.isArray(s.detailLevels) && s.detailLevels.length > 0;
      const detailOption = _selectedGeojsonDetailOption(getEl('set-gj-simplify'));
      if (presetLinked) {
        if (getEl('set-gj-adaptive-simplify')) s.adaptiveSimplify = getEl('set-gj-adaptive-simplify')?.checked;
        if (s.adaptiveSimplify === false && detailOption) {
          s.simplify = _clampSimplifyLevel(detailOption.simplifyLevel);
        }
      } else {
        const requestedSimplify = detailOption
          ? _clampSimplifyLevel(detailOption.simplifyLevel)
          : GEOJSON_LIMITS.simplifyLevel.defaultValue;
        s.adaptiveSimplify = false;
        s.simplify = requestedSimplify;
        s.minSimplify = 0;
        s.maxSimplify = requestedSimplify;
      }
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

  const onInput = e => {
    clearTimeout(timer);
    const target = e?.target;
    if (target?.id === 'set-gj-simplify') {
      const option = _selectedGeojsonDetailOption(target);
      _updateGeojsonDetailReadout(target.closest('.sx-setting-row')?.querySelector('#set-gj-simplify-readout'), option);
    }
    const delay = target?.id === 'set-gj-simplify' ? GEOJSON_LIMITS.adaptiveDetailDebounceMs : debounceMs;
    timer = setTimeout(() => {
      apply();
    }, delay);
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
