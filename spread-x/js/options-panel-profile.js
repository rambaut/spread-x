/**
 * Declarative options-panel profile for SPREAD-X.
 *
 * Mirrors the peartree options-panel-profile pattern: return rule/cascade
 * descriptors that are consumed by createDeclarativeOptionsController().
 */
export function createSpreadXOptionsPanelProfile({ root, getSelectedLayerType } = {}) {
  const bmGlobeSectionEl = root?.querySelector('#settings-basemap-globe') || null;
  const bmGeographicSectionEl = root?.querySelector('#settings-basemap-geographic') || null;
  const bmGeographicRasterGroupEl = root?.querySelector('#settings-bm-geographic-raster-group') || null;
  const bmGeographicVectorGroupEl = root?.querySelector('#settings-bm-geographic-vector-group') || null;

  const isBasemapSelected = () => getSelectedLayerType?.() === 'basemap';

  const cascades = [];

  const rules = [
    {
      control: 'set-bm-mode',
      when: () => isBasemapSelected(),
      notEquals: 'geographic',
      target: bmGlobeSectionEl,
      mode: 'auto',
    },
    {
      control: 'set-bm-mode',
      when: () => isBasemapSelected(),
      equals: 'geographic',
      target: bmGeographicSectionEl,
      mode: 'auto',
    },
    {
      control: 'set-bm-geographic-source',
      when: () => isBasemapSelected(),
      equals: 'raster',
      target: bmGeographicRasterGroupEl,
      mode: 'auto',
    },
    {
      control: 'set-bm-geographic-source',
      when: () => isBasemapSelected(),
      equals: 'vector',
      target: bmGeographicVectorGroupEl,
      mode: 'auto',
    },
  ];

  return { cascades, rules };
}
