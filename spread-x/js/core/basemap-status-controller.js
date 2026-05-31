export function createBasemapStatusController({
  getEl,
  getLayers,
  layerTypes,
  getZoomTransform,
  isGeographicRasterMode,
  normalizeScale,
} = {}) {
  function formatLatLon(lat, lon) {
    const latAbs = Math.abs(Number(lat) || 0).toFixed(2);
    const lonAbs = Math.abs(Number(lon) || 0).toFixed(2);
    return `${latAbs}${(lat || 0) >= 0 ? 'N' : 'S'}, ${lonAbs}${(lon || 0) >= 0 ? 'E' : 'W'}`;
  }

  function projectionLabel(projId) {
    if (!projId) return 'Natural Earth';
    const projectionSelect = getEl?.('set-bm-projection');
    const option = projectionSelect?.querySelector(`option[value="${projId}"]`);
    return option?.textContent?.trim() || projId.replace(/^geo/, '');
  }

  function activeZoomK() {
    const t = getZoomTransform?.();
    return t?.k || 1;
  }

  function currentBasemapDetailLabel(zoomK = null) {
    const base = (getLayers?.() || []).find(l => l.type === layerTypes.BASEMAP);
    if (!base) return 'n/a';
    const s = base.style || {};
    const mode = s.baseMode || 'globe';
    const source = s.geographicSourceType || 'raster';
    const k = Number.isFinite(zoomK) ? zoomK : activeZoomK();

    if (mode === 'geographic') {
      if (source === 'raster') {
        const setName = String(s.geographicRasterSet || 'NE1').toUpperCase().replace(/[^A-Z0-9_-]/g, '');
        const threshold = Number(s.geographicRasterSwitchZoom ?? 2.5);
        const forcedTier = String(s.geographicRasterForceTier || 'auto').toLowerCase();
        const tier = forcedTier === 'hr' ? 'HR' : forcedTier === '50m' ? '50M' : (k >= threshold ? 'HR' : '50M');
        const forced = forcedTier === 'auto' ? '' : ' forced';
        return `${setName} ${tier}${forced}`;
      }

      const landScale = normalizeScale(s.geographicVectorScale, '50m').toUpperCase();
      const countryScale = normalizeScale(s.geographicCountryScale, '50m').toUpperCase();
      const countryState = s.geographicShowCountries === false ? 'countries off' : `countries ${countryScale}`;
      return `land ${landScale}, ${countryState}`;
    }

    return `projection ${projectionLabel(s.projection || 'geoNaturalEarth1')}`;
  }

  function updateBasemapReadonlyPanel(zoomK = null) {
    const base = (getLayers?.() || []).find(l => l.type === layerTypes.BASEMAP);
    if (!base) return;
    const s = base.style || {};
    const mode = s.baseMode || 'globe';
    const source = s.geographicSourceType || 'raster';
    const k = Number.isFinite(zoomK) ? zoomK : activeZoomK();
    const centerLon = Number(s.center?.[0] || 0);
    const centerLat = Number(s.center?.[1] || 0);

    const modeChoices = getEl?.('bm-ro-mode-choices');
    const sourceChoices = getEl?.('bm-ro-source-choices');
    const modeEl = getEl?.('bm-ro-mode');
    const sourceEl = getEl?.('bm-ro-source');
    const zoomEl = getEl?.('bm-ro-zoom');
    const centerEl = getEl?.('bm-ro-center');
    const detailEl = getEl?.('bm-ro-detail');

    if (modeChoices) {
      modeChoices.innerHTML = `
        <span class="sx-choice-pills">
          <span class="sx-choice-pill ${mode === 'globe' ? 'active' : ''}">Globe</span>
          <span class="sx-choice-pill ${mode === 'geographic' ? 'active' : ''}">Natural Earth Geographic</span>
        </span>`;
    }
    if (sourceChoices) {
      sourceChoices.innerHTML = `
        <span class="sx-choice-pills">
          <span class="sx-choice-pill ${source === 'raster' ? 'active' : ''}">Raster</span>
          <span class="sx-choice-pill ${source === 'vector' ? 'active' : ''}">Vector</span>
        </span>`;
    }

    if (modeEl) modeEl.textContent = mode === 'geographic' ? 'Natural Earth Geographic (WGS84)' : `Globe (${projectionLabel(s.projection || 'geoNaturalEarth1')})`;
    if (sourceEl) sourceEl.textContent = mode === 'geographic' ? (source === 'vector' ? 'Natural Earth Vector' : 'Natural Earth Raster') : 'Projection Vector';
    if (zoomEl) zoomEl.textContent = k.toFixed(2);
    if (centerEl) centerEl.textContent = formatLatLon(centerLat, centerLon);
    if (detailEl) detailEl.textContent = currentBasemapDetailLabel(k);
  }

  function appendRasterTierStatus(baseText, zoomK, asHtml = false, detailPercent = null) {
    const prefix = baseText ? `${baseText} | ` : '';
    if (!isGeographicRasterMode?.()) return baseText || '';

    const bm = (getLayers?.() || []).find(l => l.type === layerTypes.BASEMAP)?.style || {};
    const setName = String(bm.geographicRasterSet || 'NE1').toUpperCase().replace(/[^A-Z0-9_-]/g, '');
    const threshold = Number(bm.geographicRasterSwitchZoom ?? 2.5);
    const k = Number.isFinite(zoomK) ? zoomK : activeZoomK();
    const forcedTier = String(bm.geographicRasterForceTier || 'auto').toLowerCase();
    const tier = forcedTier === 'hr' ? 'HR' : forcedTier === '50m' ? '50M' : (k >= threshold ? 'HR' : '50M');
    const forceNote = forcedTier === 'auto' ? '' : ' forced';
    const detail = Number.isFinite(+detailPercent)
      ? `${Math.max(1, Math.min(100, Math.round(+detailPercent)))}%`
      : null;
    const detailSuffix = detail ? ` / detail ${detail}` : '';

    if (!asHtml) {
      const text = `Raster ${setName}: ${tier}${forceNote} (zoom ${k.toFixed(2)}${detailSuffix})`;
      return `${prefix}${text}`;
    }

    const tierClass = tier === 'HR' ? 'sx-raster-tier--hr' : 'sx-raster-tier--50m';
    const forcedClass = forcedTier === 'auto' ? '' : ' sx-raster-tier--forced';
    const switchHint = Number.isFinite(threshold) ? ` (auto switch ${threshold.toFixed(2)})` : '';
    const text = `Raster ${setName}: <button type="button" class="sx-raster-tier ${tierClass}${forcedClass}" data-raster-tier-toggle="1" title="Click to force alternate raster tier (Shift-click for auto)">${tier}</button> <span class="sx-raster-zoom">${forceNote}(zoom ${k.toFixed(2)}${detailSuffix})${switchHint}</span>`;
    return `${prefix}${text}`;
  }

  return {
    updateBasemapReadonlyPanel,
    appendRasterTierStatus,
  };
}
