export function createLayoutModeController({
  documentRef,
  getEl,
  getLayoutMode,
  setLayoutMode,
  mapViewport,
  layerManager,
  getLayers,
  layerTypes,
  panelController,
  showSettingsForLayer,
  setSelectedId,
  getSelectedId,
  clearLayoutCountryInteraction,
  syncBasemapCountryInteractionRuntime,
  getCountryFeatureCache,
  activeCountryScale,
  renderLayerList,
  render,
  saveState,
  getZoomTransform,
  getViewportSize,
  standardLayerDefs,
  mapOutlines,
  fetchImpl,
  topojson,
  createLayer,
  escapeHtml,
} = {}) {
  let preLayoutVisibilities = {};
  let standardLayerClickBound = false;

  function _setLayoutButtonActive(active) {
    getEl?.('btn-layout-mode')?.classList.toggle('active', !!active);
  }

  function _showStandardLayers(visible) {
    const stdLayersEl = getEl?.('layout-std-layers');
    if (stdLayersEl) stdLayersEl.style.display = visible ? '' : 'none';
  }

  function populateStandardLayers() {
    const list = getEl?.('std-layers-list');
    if (!list) return;
    list.innerHTML = '';

    for (const def of standardLayerDefs || []) {
      const btn = documentRef?.createElement?.('button');
      if (!btn) continue;
      btn.className = 'sx-std-layer-btn';
      btn.dataset.neId = def.id;
      btn.innerHTML = `<i class="bi bi-plus-lg me-1"></i>${escapeHtml?.(def.name) || def.name}`;
      btn.title = `Add ${def.name} as a GeoJSON layer`;
      list.appendChild(btn);
    }
  }

  async function _addStandardLayer(def) {
    const outlineId = def.landId || def.countriesId;
    const urlEntry = (mapOutlines || []).find(o => o.id === outlineId);
    const url = urlEntry?.url;
    if (!url) throw new Error('No URL for ' + outlineId);

    const topo = await fetchImpl(url).then(r => {
      if (!r.ok) throw new Error(r.statusText);
      return r.json();
    });
    const key = Object.keys(topo.objects || {})[0];
    if (!key) throw new Error('No topology objects found');

    const geoData = topojson.feature(topo, topo.objects[key]);
    const newLayer = createLayer(layerTypes.GEOJSON, def.name, geoData);
    layerManager.insertBeforeFrame(newLayer);

    if (getLayoutMode?.()) {
      preLayoutVisibilities[newLayer.id] = true;
    }

    return newLayer;
  }

  function bindStandardLayerListClicks() {
    if (standardLayerClickBound) return;
    const list = getEl?.('std-layers-list');
    if (!list) return;

    list.addEventListener('click', async e => {
      const btn = e.target.closest?.('[data-ne-id]');
      if (!btn) return;

      const def = (standardLayerDefs || []).find(d => d.id === btn.dataset.neId);
      if (!def) return;

      btn.disabled = true;
      btn.innerHTML = '<i class="bi bi-hourglass-split me-1"></i>Loading...';

      try {
        await _addStandardLayer(def);
        populateStandardLayers();
        renderLayerList?.();
        render?.();
        saveState?.();
      } catch (err) {
        console.error('Failed to load standard layer:', err);
        btn.disabled = false;
        btn.innerHTML = `<i class="bi bi-exclamation-triangle me-1"></i>${escapeHtml?.(def.name) || def.name}`;
      }
    });

    standardLayerClickBound = true;
  }

  function enterLayoutMode() {
    if (getLayoutMode?.()) return;

    setLayoutMode?.(true);
    mapViewport?.clearViewConstraint?.();

    preLayoutVisibilities = layerManager?.captureAndHide?.(layer => layer.type !== layerTypes.BASEMAP) || {};

    const basemap = (getLayers?.() || []).find(l => l.type === layerTypes.BASEMAP);
    if (basemap) {
      setSelectedId?.(basemap.id);
      panelController?.openSettings?.();
      showSettingsForLayer?.(basemap.id);
    }

    panelController?.openLayer?.();
    _showStandardLayers(true);
    populateStandardLayers();

    documentRef?.body?.classList.add('layout-mode');
    _setLayoutButtonActive(true);

    clearLayoutCountryInteraction?.({ keepSelection: false });
    syncBasemapCountryInteractionRuntime?.();
    getCountryFeatureCache?.(activeCountryScale?.())?.catch?.(() => {});

    renderLayerList?.();
    render?.();
    saveState?.();
  }

  function exitLayoutMode() {
    if (!getLayoutMode?.()) return;

    setLayoutMode?.(false);

    layerManager?.restoreVisibility?.(preLayoutVisibilities);
    preLayoutVisibilities = {};

    _showStandardLayers(false);

    documentRef?.body?.classList.remove('layout-mode');
    _setLayoutButtonActive(false);
    clearLayoutCountryInteraction?.({ keepSelection: false });

    const t = getZoomTransform?.();
    if (t) mapViewport?.setViewConstraintBase?.(t, getViewportSize?.());

    renderLayerList?.();
    showSettingsForLayer?.(getSelectedId?.());
    render?.();
    saveState?.();
  }

  function toggleLayoutMode() {
    if (getLayoutMode?.()) exitLayoutMode();
    else enterLayoutMode();
  }

  return {
    enterLayoutMode,
    exitLayoutMode,
    toggleLayoutMode,
    populateStandardLayers,
    bindStandardLayerListClicks,
  };
}
