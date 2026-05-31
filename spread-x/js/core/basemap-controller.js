export class BasemapController {
  constructor({ getLayers, layerTypes, normalizeScale }) {
    this._getLayers = getLayers;
    this._types = layerTypes;
    this._normalizeScale = normalizeScale;
  }

  getBasemap() {
    const layers = this._getLayers?.() || [];
    return layers.find(l => l.type === this._types.BASEMAP) || null;
  }

  isGeographicRasterMode() {
    const base = this.getBasemap();
    return base?.style?.baseMode === 'geographic' && (base?.style?.geographicSourceType || 'raster') === 'raster';
  }

  activeCountryScale() {
    const base = this.getBasemap();
    const s = base?.style || {};
    return this._normalizeScale(s.geographicCountryScale || s.geographicVectorScale, '50m');
  }

  basemapCenter() {
    return this.getBasemap()?.style?.center || [0, 0];
  }
}

export function createBasemapController(opts) {
  return new BasemapController(opts);
}
