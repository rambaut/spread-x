export function createWelcomeOverlayController({
  overlay,
  getLayers,
  layerTypes,
  normalizeScale,
  enterLayoutMode,
  render,
} = {}) {
  function _activeBasemap() {
    const layers = getLayers?.() || [];
    return layers.find(l => l.type === layerTypes.BASEMAP) || null;
  }

  function _applyBasemapMode(mode) {
    const basemap = _activeBasemap();
    if (!basemap) return;

    basemap.style.baseMode = mode || 'globe';

    if (mode === 'geographic') {
      basemap.style.projection = 'geoEquirectangular';
      basemap.style.datum = 'WGS84';
      basemap.style.geographicSourceType = basemap.style.geographicSourceType || 'raster';
      basemap.style.geographicRasterSet = basemap.style.geographicRasterSet || 'NE1';
      basemap.style.basemapSource = `ne${normalizeScale?.(basemap.style.geographicVectorScale || '50m', '50m').replace('m', '')}`;
      return;
    }

    basemap.style.projection = basemap.style.projection || 'geoNaturalEarth1';
    basemap.style.basemapSource = basemap.style.basemapSource || 'd3';
  }

  function showWelcome() {
    if (!overlay) return;
    overlay.style.display = '';
    render?.();
  }

  function hideWelcome() {
    if (!overlay) return;
    overlay.style.display = 'none';
  }

  function bindModeCards() {
    overlay?.querySelectorAll?.('[data-bmmode]')?.forEach(card => {
      card.addEventListener('click', () => {
        const mode = card.dataset.bmmode;
        _applyBasemapMode(mode);
        hideWelcome();
        enterLayoutMode?.();
      });
    });
  }

  return {
    showWelcome,
    hideWelcome,
    bindModeCards,
  };
}
