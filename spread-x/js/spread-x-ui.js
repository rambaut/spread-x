// spread-x-ui.js — App UI builder (classic script).
//
// Builds HTML strings using pearcore-ui.js global helpers, then
// auto-injects into the DOM.  Must be loaded after pearcore-ui.js.
// ── Welcome / base-map selection overlay ────────────────────────────────────

function _buildWelcomeOverlay() {
  return `
<div id="welcome-overlay" class="sx-welcome-overlay" style="display:none">
  <div class="sx-welcome-dialog">
    <div class="sx-welcome-header">
      <i class="bi bi-globe-americas"></i>
      <h1>SPREAD-X</h1>
      <p>Choose a base map to begin</p>
    </div>
    <div class="sx-welcome-cards">
      <button class="sx-bm-card" data-bmmode="globe">
        <i class="bi bi-globe"></i>
        <strong>Globe</strong>
        <span>Current globe rendering with D3 projections</span>
      </button>
      <button class="sx-bm-card" data-bmmode="geographic">
        <i class="bi bi-map"></i>
        <strong>Natural Earth Geographic</strong>
        <span>WGS84 geographic mode with raster or vector Natural Earth maps</span>
      </button>
    </div>
  </div>
</div>`;
}
// ── Layer panel (left) ────────────────────────────────────────────────────

function _buildLayerPanel() {
  return `
<div id="layer-panel" class="sx-side-panel sx-panel-left">
  ${buildSidePanelHeaderHTML({
    id: 'palette-panel-header-left',
    leftHTML: '<h2 class="pt-side-panel-title"><i class="bi bi-layers me-1"></i>Layers</h2>',
    side: 'left',
    buttonOrder: 'pin-close',
    pinButtonId: 'btn-palette-pin-left',
    closeButtonId: 'btn-palette-close-left',
  })}
  <div id="layer-panel-dragbar" class="sx-panel-dragbar sx-panel-dragbar-right" title="Resize layers panel"></div>
  <div id="palette-panel-body-left" class="sx-panel-body" style="display:flex;flex-direction:column">
    <div class="sx-layer-add-row">
      <button id="btn-add-toolbar" class="btn btn-sm btn-outline-primary" title="Add layer">
        <i class="bi bi-plus-lg me-1"></i>Add Layer
      </button>
      <button id="btn-add-layer" class="btn btn-sm btn-outline-primary" title="Add preset">
        <i class="bi bi-plus-lg me-1"></i>Add preset...
      </button>
    </div>
    <div id="layer-list" class="sx-layer-list" style="flex:1;overflow-y:auto"></div>
    <div class="sx-layer-controls">
      <div class="btn-group btn-group-sm">
        <button id="btn-delete-layer" class="btn btn-outline-secondary" title="Delete selected layer" disabled>
          <i class="bi bi-trash"></i>
        </button>
        <button id="btn-dup-layer" class="btn btn-outline-secondary" title="Duplicate selected layer" disabled>
          <i class="bi bi-copy"></i>
        </button>
      </div>
      <div class="btn-group btn-group-sm ms-auto">
        <button id="btn-move-up" class="btn btn-outline-secondary" title="Move layer up" disabled>
          <i class="bi bi-arrow-up"></i>
        </button>
        <button id="btn-move-down" class="btn btn-outline-secondary" title="Move layer down" disabled>
          <i class="bi bi-arrow-down"></i>
        </button>
      </div>
    </div>
  </div>
</div>`;
}

// ── Settings panel (right) ────────────────────────────────────────────────

function _sxCheckboxRow(opts = {}) {
  const {
    id,
    text,
    checked = true,
    title = '',
    rowId = '',
    rowStyle = '',
  } = opts;

  const checkedAttr = checked ? ' checked' : '';
  return {
    rowId,
    rowStyle,
    title,
    label: text,
    controlHTML: `<input type="checkbox" id="${id}" class="form-check-input" aria-label="${text}"${checkedAttr} />`,
  };
}

function _sxSettingsSection(def = {}) {
  const {
    id,
    secId = id,
    role = 'layer-type',
    layerType = '',
    className = 'sx-settings-section',
    title = '',
    icon = '',
    rows = [],
    items = [],
    style = 'display:none',
  } = def;

  const titleHTML = title
    ? `<h3>${icon ? `<i class="${icon}"></i> ` : ''}${title}</h3>`
    : '';
  const rowsHTML = rows.map(row => buildPaletteRowHTML(row)).join('');
  const itemsHTML = items.map(item => buildPaletteSectionItemHTML(item)).join('');

  return `<div id="${id}" class="${className}" data-sec-id="${secId}" data-palette-role="${role}" data-layer-type="${layerType}" style="${style}">${titleHTML}${rowsHTML}${itemsHTML}</div>`;
}

function _buildSettingsPanel() {
  const projectionOptionsHTML = `
          <optgroup label="Pseudocylindrical">
            <option value="geoNaturalEarth1" selected>Natural Earth</option>
            <option value="geoEqualEarth">Equal Earth</option>
            <option value="geoRobinson">Robinson</option>
            <option value="geoMollweide">Mollweide</option>
          </optgroup>
          <optgroup label="Cylindrical">
            <option value="geoEquirectangular">Equirectangular</option>
            <option value="geoMercator">Mercator</option>
          </optgroup>
          <optgroup label="Azimuthal">
            <option value="geoOrthographic">Orthographic</option>
            <option value="geoAzimuthalEqualArea">Azimuthal Equal Area</option>
            <option value="geoStereographic">Stereographic</option>
          </optgroup>
          <optgroup label="Interrupted">
            <option value="geoInterruptedMollweide">Interrupted Mollweide</option>
            <option value="geoInterruptedMollweideHemispheres">Interrupted Mollweide Hemispheres</option>
          </optgroup>
          <optgroup label="Polyhedral">
            <option value="geoPolyhedralButterfly">Polyhedral Butterfly</option>
            <option value="geoPolyhedralWaterman">Polyhedral Waterman</option>
          </optgroup>
          <optgroup label="Quincuncial">
            <option value="geoPeirceQuincuncial">Peirce Quincuncial</option>
          </optgroup>`;

  /*
   * Full projection list retained for quick restore.
   * Re-enable by swapping this constant back into projectionOptionsHTML.
   *
  const projectionOptionsHTML = `
          <optgroup label="Pseudocylindrical">
            <option value="geoNaturalEarth1" selected>Natural Earth</option>
            <option value="geoNaturalEarth2">Natural Earth II</option>
            <option value="geoEqualEarth">Equal Earth</option>
            <option value="geoRobinson">Robinson</option>
            <option value="geoKavrayskiy7">Kavrayskiy VII</option>
            <option value="geoWagner4">Wagner IV</option>
            <option value="geoWagner6">Wagner VI</option>
            <option value="geoWagner7">Wagner VII</option>
            <option value="geoEckert1">Eckert I</option>
            <option value="geoEckert2">Eckert II</option>
            <option value="geoEckert3">Eckert III</option>
            <option value="geoEckert4">Eckert IV</option>
            <option value="geoEckert5">Eckert V</option>
            <option value="geoEckert6">Eckert VI</option>
            <option value="geoMollweide">Mollweide</option>
            <option value="geoHomolosine">Goode Homolosine</option>
            <option value="geoSinusoidal">Sinusoidal</option>
            <option value="geoSinuMollweide">Sinu-Mollweide</option>
            <option value="geoBoggs">Boggs Eumorphic</option>
            <option value="geoCraster">Craster Parabolic</option>
            <option value="geoFahey">Fahey</option>
            <option value="geoMtFlatPolarParabolic">McBryde Flat-Polar Parabolic</option>
            <option value="geoMtFlatPolarQuartic">McBryde Flat-Polar Quartic</option>
            <option value="geoMtFlatPolarSinusoidal">McBryde Flat-Polar Sinusoidal</option>
            <option value="geoLoximuthal">Loximuthal</option>
            <option value="geoBromley">Bromley</option>
            <option value="geoCollignon">Collignon</option>
            <option value="geoNellHammer">Nell-Hammer</option>
            <option value="geoPatterson">Patterson</option>
            <option value="geoTimes">Times</option>
          </optgroup>
          <optgroup label="Cylindrical">
            <option value="geoEquirectangular">Equirectangular</option>
            <option value="geoMercator">Mercator</option>
            <option value="geoTransverseMercator">Transverse Mercator</option>
            <option value="geoMiller">Miller</option>
            <option value="geoCylindricalEqualArea">Cylindrical Equal-Area</option>
            <option value="geoCylindricalStereographic">Cylindrical Stereographic</option>
          </optgroup>
          <optgroup label="Azimuthal">
            <option value="geoOrthographic">Orthographic</option>
            <option value="geoStereographic">Stereographic</option>
            <option value="geoAzimuthalEqualArea">Azimuthal Equal Area</option>
            <option value="geoAzimuthalEquidistant">Azimuthal Equidistant</option>
            <option value="geoGnomonic">Gnomonic</option>
            <option value="geoAiry">Airy</option>
            <option value="geoSatellite">Satellite</option>
          </optgroup>
          <optgroup label="Conic">
            <option value="geoConicEqualArea">Conic Equal Area</option>
            <option value="geoConicEquidistant">Conic Equidistant</option>
            <option value="geoConicConformal">Conic Conformal</option>
            <option value="geoAlbers">Albers</option>
            <option value="geoBonne">Bonne</option>
            <option value="geoPolyconic">Polyconic</option>
            <option value="geoRectangularPolyconic">Rectangular Polyconic</option>
          </optgroup>
          <optgroup label="Compromise">
            <option value="geoAitoff">Aitoff</option>
            <option value="geoHammer">Hammer</option>
            <option value="geoWinkel3">Winkel Tripel</option>
            <option value="geoVanDerGrinten">Van der Grinten</option>
            <option value="geoVanDerGrinten2">Van der Grinten II</option>
            <option value="geoVanDerGrinten3">Van der Grinten III</option>
            <option value="geoVanDerGrinten4">Van der Grinten IV</option>
            <option value="geoLagrange">Lagrange</option>
            <option value="geoLarrivee">Larrivee</option>
            <option value="geoLaskowski">Laskowski</option>
            <option value="geoBertin1953">Bertin 1953</option>
            <option value="geoHill">Hill Eucyclic</option>
          </optgroup>
          <optgroup label="Other">
            <option value="geoArmadillo">Armadillo</option>
            <option value="geoAugust">August</option>
            <option value="geoBaker">Baker</option>
            <option value="geoBerghaus">Berghaus Star</option>
            <option value="geoBottomley">Bottomley</option>
            <option value="geoCraig">Craig Retroazimuthal</option>
            <option value="geoEisenlohr">Eisenlohr</option>
            <option value="geoFoucaut">Foucaut</option>
            <option value="geoFoucautSinusoidal">Foucaut Sinusoidal</option>
            <option value="geoGilbert">Gilbert</option>
            <option value="geoGingery">Gingery</option>
            <option value="geoGinzburg4">Ginzburg IV</option>
            <option value="geoGinzburg5">Ginzburg V</option>
            <option value="geoGinzburg6">Ginzburg VI</option>
            <option value="geoGinzburg8">Ginzburg VIII</option>
            <option value="geoGinzburg9">Ginzburg IX</option>
            <option value="geoGringorten">Gringorten</option>
            <option value="geoGuyou">Guyou</option>
            <option value="geoHammerRetroazimuthal">Hammer Retroazimuthal</option>
            <option value="geoHealpix">HEALPix</option>
            <option value="geoHufnagel">Hufnagel</option>
            <option value="geoHyperelliptical">Hyperelliptical</option>
            <option value="geoLittrow">Littrow</option>
            <option value="geoNicolosi">Nicolosi</option>
            <option value="geoWiechel">Wiechel</option>
          </optgroup>
          <optgroup label="Interrupted">
            <option value="geoInterruptedHomolosine">Interrupted Homolosine</option>
            <option value="geoInterruptedSinusoidal">Interrupted Sinusoidal</option>
            <option value="geoInterruptedMollweide">Interrupted Mollweide</option>
            <option value="geoInterruptedMollweideHemispheres">Interrupted Mollweide Hemispheres</option>
            <option value="geoInterruptedSinuMollweide">Interrupted Sinu-Mollweide</option>
            <option value="geoInterruptedBoggs">Interrupted Boggs</option>
          </optgroup>
          <optgroup label="Polyhedral">
            <option value="geoPolyhedralButterfly">Polyhedral Butterfly</option>
            <option value="geoPolyhedralCollignon">Polyhedral Collignon</option>
            <option value="geoPolyhedralWaterman">Polyhedral Waterman</option>
          </optgroup>
          <optgroup label="Quincuncial">
            <option value="geoGringortenQuincuncial">Gringorten Quincuncial</option>
            <option value="geoPeirceQuincuncial">Peirce Quincuncial</option>
          </optgroup>`;
  */

  const sections = [
    _sxSettingsSection({
      id: 'settings-common',
      secId: 'settings-common',
      role: 'shared',
      layerType: 'shared',
      title: '',
      rows: [
        {
          rowId: 'setting-layer-title-row',
          rowClass: 'pt-palette-row--span',
          hideLabel: true,
          controlHTML: '<div class="sx-layer-title-panel"><div class="sx-layer-title-main"><span id="setting-layer-title" class="sx-layer-title-text"></span><button id="btn-setting-layer-rename" type="button" class="btn btn-sm btn-outline-secondary" title="Rename layer" style="display:none"><i class="bi bi-pencil"></i></button></div><div id="setting-layer-secondary" class="sx-layer-secondary"></div><input type="text" id="setting-layer-name" class="form-control form-control-sm sx-setting-input" style="display:none" /><input type="range" id="setting-layer-opacity" class="form-range" min="0" max="1" step="0.05" value="1" style="display:none" /></div>',
        },
        {
          rowId: 'setting-layer-rich-row',
          rowClass: 'pt-palette-row--span',
          rowStyle: 'display:none',
          hideLabel: true,
          controlHTML: '<div id="setting-layer-rich" class="sx-layer-rich-box"><div id="settings-basemap-readonly" style="display:none"><div class="pt-palette-row"><span class="pt-palette-label">Mode choices</span><span id="bm-ro-mode-choices" class="sx-setting-value"></span></div><div class="pt-palette-row"><span class="pt-palette-label">Source choices</span><span id="bm-ro-source-choices" class="sx-setting-value"></span></div><hr /><div class="pt-palette-row"><span class="pt-palette-label">Current mode</span><span id="bm-ro-mode" class="sx-setting-value"></span></div><div class="pt-palette-row"><span class="pt-palette-label">Current source</span><span id="bm-ro-source" class="sx-setting-value"></span></div><div class="pt-palette-row"><span class="pt-palette-label">Zoom factor</span><span id="bm-ro-zoom" class="sx-setting-value"></span></div><div class="pt-palette-row"><span class="pt-palette-label">Viewport center</span><span id="bm-ro-center" class="sx-setting-value"></span></div><div class="pt-palette-row"><span class="pt-palette-label">Detail level</span><span id="bm-ro-detail" class="sx-setting-value"></span></div></div><div id="settings-frame-readonly" style="display:none"><div class="pt-palette-row"><span class="pt-palette-label">Aspect</span><span id="fr-ro-aspect" class="sx-setting-value"></span></div><div class="pt-palette-row"><span class="pt-palette-label">Padding</span><span id="fr-ro-padding" class="sx-setting-value"></span></div><div class="pt-palette-row"><span class="pt-palette-label">Fill</span><span id="fr-ro-fill" class="sx-setting-value"></span></div><div class="pt-palette-row"><span class="pt-palette-label">Stroke</span><span id="fr-ro-stroke" class="sx-setting-value"></span></div></div><div class="sx-layer-rich-actions"><button id="btn-setting-layer-configure" type="button" class="btn btn-sm btn-outline-primary" title="Configure layer in Layout mode" style="display:none"><i class="bi bi-sliders me-1"></i>Configure</button></div></div>',
        },
      ],
    }),

    _sxSettingsSection({
      id: 'settings-basemap',
      secId: 'settings-basemap',
      layerType: 'basemap',
      title: 'BASE MAP',
      icon: 'bi bi-globe-europe-africa',
      rows: [
        { kind: 'color', id: 'set-bm-bg', value: '#ffffff', label: 'Backgound' },
        {
          kind: 'select',
          id: 'set-bm-mode',
          label: 'Source',
          className: 'form-select form-select-sm sx-setting-input pt-palette-select',
          options: [
            { value: 'globe', label: 'Globe' },
            { value: 'geographic', label: 'Natural Earth (WGS84)' },
          ],
        },
      ],
    }),

    _sxSettingsSection({
      id: 'settings-basemap-globe',
      secId: 'settings-basemap-globe',
      layerType: 'basemap',
      title: 'Globe',
      icon: 'bi bi-globe2',
      items: [
        {
          type: 'group',
          id: 'settings-bm-globe-group',
          className: 'pt-palette-grid',
          items: [
            { kind: 'select', id: 'set-bm-projection', className: 'form-select form-select-sm sx-setting-input pt-palette-select', label: 'Projection', optionsHTML: projectionOptionsHTML },
            _sxCheckboxRow({ id: 'set-bm-grat', text: 'Reticule (graticule)' }),
            { kind: 'range', id: 'set-bm-grat-step', min: 5, max: 30, step: 5, value: 10, label: 'Reticule step (°)', title: 'Spacing between reticule lines in degrees of latitude and longitude' },
            { kind: 'color', id: 'set-bm-grat-stroke', value: '#ffffff', label: 'Reticule colour' },
            { kind: 'range', id: 'set-bm-grat-width', min: 0, max: 3, step: 0.05, value: 0.5, label: 'Reticule width', title: 'Reticule line width' },
            { kind: 'range', id: 'set-bm-grat-opacity', min: 0, max: 100, step: 1, value: 10, label: 'Reticule opacity', title: 'Reticule line opacity as percentage' },
            { kind: 'range', id: 'set-bm-grat-hide-zoom', min: 1, max: 12, step: 0.25, value: 12, label: 'Reticule zoom to', title: 'Zoom level at which reticule is hidden to improve performance' },
            { kind: 'color', id: 'set-bm-proj-boundary', value: '#4a8a5a', label: 'Boundary', title: 'Colour of globe boundary lines including land and country boundaries' },
            { kind: 'range', id: 'set-bm-proj-boundary-sw', min: 0, max: 5, step: 0.05, value: 1, label: 'Boundary width', title: 'Width of globe boundary lines including land and country boundaries' },
            { type: 'html', html: '<hr /><div class="pt-palette-subhead"><i class="bi bi-globe-americas me-1"></i>Features</div>' },
            { kind: 'range', id: 'set-bm-features-detail', min: 0, max: 10, step: 1, value: 0, label: 'Detail', title: 'Level of detail for globe features' },
            { kind: 'range', id: 'set-bm-features-hide-zoom', min: 1, max: 12, step: 0.25, value: 12, label: 'Features zoom to', title: 'Zoom level at which globe features are hidden to improve performance' },
            _sxCheckboxRow({ id: 'set-bm-globe-on', text: 'Show globe land' }),
            { kind: 'color', id: 'set-bm-water', value: '#02292e', label: 'Water' },
            { kind: 'color', id: 'set-bm-land', value: '#1a3a2a', label: 'Land' },
            _sxCheckboxRow({ id: 'set-bm-land-boundaries', text: 'Land boundaries' }),
            _sxCheckboxRow({ id: 'set-bm-country-boundaries', text: 'Country boundaries' }),
            { kind: 'color', id: 'set-bm-globe-outline', value: '#4a8a5a', label: 'Outlines' },
            { kind: 'range', id: 'set-bm-globe-outline-sw', min: 0, max: 5, step: 0.05, value: 0.5, label: 'Outline width' },
          ],
        },
      ],
    }),

    _sxSettingsSection({
      id: 'settings-basemap-geographic',
      secId: 'settings-basemap-geographic',
      layerType: 'basemap',
      title: 'Natural Earth',
      icon: 'bi bi-map',
      items: [
        {
          type: 'group',
          id: 'settings-bm-geographic-group',
          className: 'pt-palette-grid',
          style: 'display:none',
          items: [
            { label: 'Datum', title: 'Geographic coordinate reference system', controlHTML: '<input type="text" class="form-control form-control-sm sx-setting-input" value="WGS84" readonly />' },
            { kind: 'select', id: 'set-bm-geographic-source', title: 'Choose raster or vector Natural Earth data for geographic mode', className: 'form-select form-select-sm sx-setting-input pt-palette-select', label: 'Source', options: [{ value: 'raster', label: 'Natural Earth Raster' }, { value: 'vector', label: 'Natural Earth Vector' }] },
            {
              type: 'group',
              id: 'settings-bm-geographic-raster-group',
              className: 'pt-palette-grid',
              items: [
                { kind: 'select', id: 'set-bm-geographic-raster-set', title: 'Raster map set used while zooming geographic mode', className: 'form-select form-select-sm sx-setting-input pt-palette-select', label: 'Raster set', options: [{ value: 'NE1', label: 'NE1' }] },
                { type: 'row', rowClass: 'pt-palette-row--span', controlHTML: '<small class="text-muted">Automatically switches from 50M to HR raster as you zoom in.</small>' },
              ],
            },
            {
              type: 'group',
              id: 'settings-bm-geographic-vector-group',
              className: 'pt-palette-grid',
              style: 'display:none',
              items: [
                { kind: 'select', id: 'set-bm-geographic-vector-scale', title: 'Vector layer detail used in geographic mode', className: 'form-select form-select-sm sx-setting-input pt-palette-select', label: 'Vector land scale', options: [{ value: '110m', label: '110m' }, { value: '50m', label: '50m' }, { value: '10m', label: '10m' }] },
                { kind: 'color', id: 'set-bm-geographic-ocean', value: '#0d2f40', title: 'Ocean fill colour used in vector geographic mode', label: 'Ocean colour' },
                { kind: 'color', id: 'set-bm-geographic-land', value: '#9aa876', title: 'Land fill colour used in vector geographic mode', label: 'Land colour' },
              ],
            },
            { type: 'html', html: '<hr />' },
            _sxCheckboxRow({ id: 'set-bm-geographic-countries-on', text: 'Show country polygons', title: 'Show country polygons' }),
            { kind: 'select', id: 'set-bm-geographic-country-scale', title: 'Country boundary detail scale', className: 'form-select form-select-sm sx-setting-input pt-palette-select', label: 'Country scale', options: [{ value: '110m', label: '110m' }, { value: '50m', label: '50m' }, { value: '10m', label: '10m' }] },
            { kind: 'color', id: 'set-bm-geographic-country-stroke', value: '#3e3e3e', title: 'Country boundary stroke colour', label: 'Country colour' },
            { kind: 'range', id: 'set-bm-geographic-country-width', min: 0, max: 5, step: 0.05, value: 0.45, title: 'Country boundary stroke width', label: 'Country stroke width' },
            { kind: 'range', id: 'set-bm-geographic-country-opacity', min: 0, max: 1, step: 0.05, value: 0.65, title: 'Country boundary opacity', label: 'Country opacity' },
          ],
        },
      ],
    }),

    _sxSettingsSection({
      id: 'settings-frame',
      secId: 'settings-frame',
      layerType: 'frame',
      title: 'Map Frame',
      icon: 'bi bi-bounding-box-circles',
      rows: [
        { type: 'row', rowId: 'settings-frame-view-note', rowStyle: 'display:none', rowClass: 'pt-palette-row--span', controlHTML: '<small class="text-muted"><i class="bi bi-lock me-1"></i>Map frame options are only editable in Layout mode.</small>' },
        { kind: 'select', id: 'set-fr-aspect', className: 'form-select form-select-sm sx-setting-input pt-palette-select', label: 'Aspect ratio', options: [{ value: 'square', label: '1:1 (Square)' }, { value: 'a4Portrait', label: 'A4 Portrait (210:297)' }, { value: 'a4Landscape', label: 'A4 Landscape (297:210)' }, { value: 'slideStandard', label: 'Slide Standard (4:3)' }, { value: 'slideWide', label: 'Slide Wide (16:9)' }] },
        _sxCheckboxRow({ id: 'set-fr-fill-on', text: 'Background fill' }),
        { kind: 'color', id: 'set-fr-fill', value: '#ffffff', label: 'Fill colour' },
        { kind: 'range', id: 'set-fr-fill-op', min: 0, max: 1, step: 0.05, value: 1, label: 'Fill opacity' },
        { kind: 'color', id: 'set-fr-stroke', value: '#d8d8d8', label: 'Boundary stroke' },
        { kind: 'range', id: 'set-fr-sw', min: 0.2, max: 5, step: 0.05, value: 1.5, label: 'Boundary width' },
        { kind: 'range', id: 'set-fr-padding', min: 0, max: 48, step: 1, value: 8, label: 'Frame padding' },
      ],
    }),

    _sxSettingsSection({
      id: 'settings-geojson',
      secId: 'settings-geojson',
      layerType: 'geojson',
      title: 'Style',
      icon: 'bi bi-hexagon',
      rows: [
        _sxCheckboxRow({ id: 'set-gj-hover-on', text: 'Hover features' }),
        _sxCheckboxRow({ id: 'set-gj-select-on', text: 'Select features' }),
        { kind: 'color', id: 'set-gj-fill', value: '#2aa198', label: 'Fill' },
        { kind: 'range', id: 'set-gj-fill-op', min: 0, max: 1, step: 0.05, value: 0.3, label: 'Fill opacity' },
        { kind: 'color', id: 'set-gj-stroke', value: '#2aa198', label: 'Stroke' },
        { kind: 'range', id: 'set-gj-sw', min: 0, max: 5, step: 0.05, value: 1, label: 'Stroke width' },
      ],
      items: [
        { type: 'html', html: '<hr /><h3><i class="bi bi-speedometer2"></i> Performance</h3>' },
        { type: 'row', kind: 'range', id: 'set-gj-min-zoom', min: 1, max: 12, step: 0.25, value: 2, label: 'Min zoom to render' },
        { type: 'row', label: 'Detail', controlHTML: '<input type="range" id="set-gj-simplify" class="form-range" min="0" max="4" step="1" value="4" /><span id="set-gj-simplify-readout" class="sx-range-value">100%</span>' },
        { type: 'row', ..._sxCheckboxRow({ id: 'set-gj-adaptive-simplify', text: 'Adaptive' }) },
      ],
    }),

    _sxSettingsSection({
      id: 'settings-points',
      secId: 'settings-points',
      layerType: 'points',
      title: 'Points',
      icon: 'bi bi-geo-alt',
      rows: [
        { kind: 'range', id: 'set-pt-radius', min: 1, max: 20, step: 0.5, value: 4, label: 'Radius' },
        { kind: 'color', id: 'set-pt-fill', value: '#b58900', label: 'Fill' },
        { kind: 'range', id: 'set-pt-fill-op', min: 0, max: 1, step: 0.05, value: 0.8, label: 'Fill opacity' },
        { kind: 'color', id: 'set-pt-stroke', value: '#ffffff', label: 'Stroke' },
        { kind: 'range', id: 'set-pt-sw', min: 0, max: 5, step: 0.05, value: 1, label: 'Stroke width' },
        { kind: 'select', id: 'set-pt-label', className: 'form-select form-select-sm sx-setting-input pt-palette-select', label: 'Label field', options: [{ value: '', label: 'None' }] },
        { kind: 'range', id: 'set-pt-label-sz', min: 6, max: 24, step: 1, value: 10, label: 'Label size' },
      ],
    }),

    _sxSettingsSection({
      id: 'settings-tree',
      secId: 'settings-tree',
      layerType: 'tree',
      title: 'Tree',
      icon: 'bi bi-diagram-3',
      rows: [
        { kind: 'select', id: 'set-tr-style', className: 'form-select form-select-sm sx-setting-input pt-palette-select', label: 'Branches', options: [{ value: 'greatcircle', label: 'Great circle' }, { value: 'straight', label: 'Straight line' }] },
        { kind: 'color', id: 'set-tr-color', value: '#BF4B43', label: 'Branch colour' },
        { kind: 'range', id: 'set-tr-width', min: 0.2, max: 5, step: 0.05, value: 1.5, label: 'Branch width' },
        { kind: 'range', id: 'set-tr-op', min: 0, max: 1, step: 0.05, value: 0.8, label: 'Branch opacity' },
        { kind: 'color', id: 'set-tr-node-color', value: '#BF4B43', label: 'Node colour' },
        { kind: 'range', id: 'set-tr-node-r', min: 1, max: 10, step: 0.5, value: 3, label: 'Node radius' },
        { kind: 'range', id: 'set-tr-node-op', min: 0, max: 1, step: 0.05, value: 0.8, label: 'Node opacity' },
      ],
    }),
  ];

  const topSectionHTML = sections[0] || '';
  const scrollingSectionsHTML = sections.slice(1).join('\n');

  return `
<div id="settings-panel" class="sx-side-panel sx-panel-right">
  ${buildSidePanelHeaderHTML({
    id: 'palette-panel-header',
    leftHTML: '<h2 class="pt-side-panel-title"><i class="bi bi-gear me-1"></i>Layer Settings</h2>',
    side: 'right',
    buttonOrder: 'close-pin',
    pinButtonId: 'btn-palette-pin',
    closeButtonId: 'btn-palette-close',
  })}
  <div class="sx-panel-body" id="palette-panel-body">
    <div id="settings-none" class="sx-settings-placeholder" data-palette-role="empty">
      <p class="text-muted">Select a layer to edit its settings</p>
    </div>
    ${topSectionHTML}
    <div id="settings-detail-scroll" class="sx-settings-detail-scroll">
      ${scrollingSectionsHTML}
    </div>
  </div>
</div>`;
}

// ── Toolbar ───────────────────────────────────────────────────────────────

function _buildAppToolbar() {
  return buildToolbarShellHTML({
    leftHTML: `
      <button id="btn-layers" class="btn btn-sm btn-outline-secondary" title="Layers panel">
        <i class="bi bi-layers"></i><i class="bi bi-caret-right ms-1"></i>
      </button>
      <div class="pt-toolbar-sep"></div>
      `,
    centerHTML: `
      <span id="toolbar-title" class="text-muted" style="font-size:0.85rem">SPREAD-X</span>`,
    rightHTML: `
      <button id="btn-layout-mode" class="btn btn-sm btn-outline-info" title="Set current view as Map">
        <i class="bi bi-aspect-ratio me-1"></i>Set Map
      </button>
      <div class="pt-toolbar-sep"></div>
      <button id="btn-zoom-back" class="btn btn-sm btn-outline-secondary" title="Previous zoom" disabled>
        <i class="bi bi-arrow-left-circle"></i>
      </button>
      <button id="btn-zoom-forward" class="btn btn-sm btn-outline-secondary" title="Next zoom" disabled>
        <i class="bi bi-arrow-right-circle"></i>
      </button>
      <button id="btn-reset-zoom" class="btn btn-sm btn-outline-secondary" title="Reset zoom">
        <i class="bi bi-fullscreen"></i>
      </button>
      <button id="btn-reset-orientation" class="btn btn-sm btn-outline-secondary" title="Reset map orientation">
        <i class="bi bi-compass"></i>
      </button>
      <div class="pt-toolbar-sep"></div>
      <button id="btn-settings" class="btn btn-sm btn-outline-secondary" title="Layer settings panel">
        <i class="bi bi-caret-left me-1"></i><i class="bi bi-gear"></i>
      </button>
      <div class="pt-toolbar-sep"></div>
      <button id="btn-export" class="btn btn-sm btn-outline-warning" title="Export graphic">
        <i class="bi bi-image"></i>
      </button>`,
  });
}

// ── Map container ─────────────────────────────────────────────────────────

function _buildMapContainer() {
  return `
<div id="canvas-container">
  <div id="canvas-wrapper">
    <canvas id="map-canvas" style="display:block;position:absolute;top:0;left:0;"></canvas>
    <svg id="map-svg" style="display:none;position:absolute;top:0;left:0;"></svg>
  </div>
</div>`;
}

// ── Import file modal ─────────────────────────────────────────────────────

function _buildAppModals() {
  return buildModalHTML({
    overlayId: 'preset-layer-overlay',
    title: 'Add Layer Preset',
    icon: 'stack',
    closeId: 'btn-preset-layer-close',
    bodyId: 'preset-layer-body',
    body: `
      <div id="preset-browser-section">
        <p class="text-muted" style="font-size:0.84rem;margin-bottom:0.75rem">
          Choose a dataset preset, then configure which feature layers and detail levels to add.
        </p>
        <div class="preset-browser-scroll">
          <div id="preset-browser-list" class="preset-browser-list"></div>
        </div>
        <div class="mt-3 d-flex justify-content-end">
          <button type="button" class="btn btn-sm btn-outline-secondary" id="btn-preset-import">
            <i class="bi bi-file-earmark-arrow-up me-1"></i>Import File…
          </button>
        </div>
      </div>
      <div id="preset-config-section" style="display:none">
        <div class="sx-setting-row">
          <label for="preset-instance-name">Layer name</label>
          <input id="preset-instance-name" class="form-control form-control-sm sx-setting-input" type="text" />
        </div>
        <div class="sx-setting-row">
          <label>Preset</label>
          <span id="preset-instance-label" class="sx-setting-value"></span>
        </div>
        <div class="sx-setting-row">
          <label>Folder</label>
          <span id="preset-instance-folder" class="sx-setting-value"></span>
        </div>
        <div class="sx-setting-row">
          <label>License</label>
          <span id="preset-instance-license" class="sx-setting-value"></span>
        </div>
        <div class="sx-setting-row preset-description-row">
          <label>Description</label>
          <span id="preset-instance-description" class="sx-setting-value"></span>
        </div>
        <hr class="my-2" />
        <div class="d-flex align-items-center justify-content-between mb-1">
          <h3 class="sx-modal-subheading mb-0">Feature layers</h3>
          <div class="btn-group btn-group-sm" role="group" aria-label="Feature selection controls">
            <button type="button" class="btn btn-outline-secondary" id="btn-preset-features-all-on">All on</button>
            <button type="button" class="btn btn-outline-secondary" id="btn-preset-features-all-off">All off</button>
          </div>
        </div>
        <div class="preset-feature-scroll">
          <div id="preset-feature-list" class="preset-feature-list"></div>
        </div>
        <hr class="my-2" />
        <div class="d-flex align-items-center justify-content-between mb-1">
          <h3 class="sx-modal-subheading mb-0">Detail levels</h3>
          <div class="btn-group btn-group-sm" role="group" aria-label="Detail level selection controls">
            <button type="button" class="btn btn-outline-secondary" id="btn-preset-details-all-on">All on</button>
            <button type="button" class="btn btn-outline-secondary" id="btn-preset-details-all-off">All off</button>
          </div>
        </div>
        <div class="table-responsive preset-detail-scroll">
          <table class="table table-sm sx-preset-detail-table align-middle mb-0">
            <thead>
              <tr>
                <th style="width:12%">Use</th>
                <th style="width:16%">Level</th>
                <th style="width:26%">Switch zoom</th>
                <th>Label</th>
              </tr>
            </thead>
            <tbody id="preset-detail-list"></tbody>
          </table>
        </div>
      </div>
      <div id="preset-progress-section" style="display:none">
        <div class="preset-progress-box">
          <div class="pt-spinner"></div>
          <p id="preset-progress-message" class="preset-progress-message">Working…</p>
          <button class="btn btn-sm btn-outline-secondary" id="btn-preset-progress-cancel">Cancel</button>
        </div>
      </div>`,
    footerId: 'preset-layer-footer',
    footer: `
      <button class="btn btn-sm btn-outline-secondary" id="btn-preset-cancel">Cancel</button>
      <button class="btn btn-sm btn-outline-secondary" id="btn-preset-reset">Reset</button>
      <button class="btn btn-sm btn-primary" id="btn-preset-apply">Apply</button>
      <button class="btn btn-sm btn-outline-secondary" id="btn-preset-config-cancel" style="display:none">Cancel</button>
      <button class="btn btn-sm btn-primary" id="btn-preset-add" style="display:none">Add</button>`,
  }) + '\n' + buildModalHTML({
    overlayId: 'import-file-overlay',
    title: 'Import Layer Data',
    icon: 'file-earmark-arrow-up',
    closeId: 'btn-import-close',
    bodyId: 'import-file-body',
    body: `
      <div class="mb-3">
        <label class="form-label" style="font-size:0.8rem">Import as</label>
        <select id="import-layer-type" class="form-select form-select-sm">
          <option value="auto">Auto-detect</option>
          <option value="geojson">GeoJSON / TopoJSON</option>
          <option value="points">Points (CSV / JSON)</option>
          <option value="tree">Phylogenetic Tree</option>
        </select>
      </div>
      <div id="file-drop-zone" class="pt-drop-zone">
        <div class="pt-drop-icon"><i class="bi bi-file-earmark-arrow-down"></i></div>
        <p>Drag and drop a file here</p>
        <input type="file" id="file-input"
               accept=".json,.geojson,.topojson,.csv,.tsv,.nwk,.newick,.tre,.tree,.nex,.nexus"
               style="position:absolute;width:0;height:0;overflow:hidden;opacity:0;pointer-events:none">
        <button class="btn btn-sm btn-outline-primary" id="btn-file-choose">
          <i class="bi bi-folder2-open me-1"></i>Choose File
        </button>
      </div>
      <div class="pt-modal-loading" id="modal-loading" style="display:none">
        <div class="pt-spinner"></div>Loading…
      </div>
      <div class="pt-modal-error" id="modal-error" style="display:none"></div>`,
  }) + '\n' + buildStandardDialogsHTML() + '\n' +
  buildModalHTML({
    overlayId: 'tree-map-overlay',
    title: 'Tree Annotation Mapping',
    icon: 'diagram-3',
    closeId: 'btn-tree-map-close',
    bodyId: 'tree-map-body',
    body: `
      <p id="tree-map-summary" class="text-muted" style="font-size:0.85rem;margin-bottom:0.75rem"></p>
      <div class="sx-setting-row">
        <label for="tree-map-lat">Latitude field</label>
        <select id="tree-map-lat" class="form-select form-select-sm"></select>
      </div>
      <div class="sx-setting-row">
        <label for="tree-map-lon">Longitude field</label>
        <select id="tree-map-lon" class="form-select form-select-sm"></select>
      </div>
      <div class="sx-setting-row">
        <label for="tree-map-hpd">95% HPD / shape field</label>
        <select id="tree-map-hpd" class="form-select form-select-sm"></select>
      </div>
      <hr style="opacity:0.2">
      <div class="sx-setting-row">
        <label for="tree-map-location">Reconstructed location field</label>
        <select id="tree-map-location" class="form-select form-select-sm"></select>
      </div>
      <div class="sx-setting-row">
        <label for="tree-map-posterior">Posterior density vector field</label>
        <select id="tree-map-posterior" class="form-select form-select-sm"></select>
      </div>
      <p class="text-secondary" style="font-size:0.8rem;margin:0.6rem 0 0">
        Tip: choose "None" for fields not present in your tree annotations.
      </p>`,
    footerId: 'tree-map-footer',
    footer: `
      <button class="btn btn-sm btn-outline-secondary" id="btn-tree-map-cancel">Cancel</button>
      <button class="btn btn-sm btn-primary" id="btn-tree-map-continue">Continue Import</button>`,
  }) + '\n' +
  buildModalHTML({
    overlayId: 'export-graphic-overlay',
    title: 'Export Graphic',
    icon: 'image',
    closeId: 'export-graphic-close',
    bodyId: 'export-graphic-body',
    footerId: 'export-graphic-footer',
  });
}

// ── Help / About ──────────────────────────────────────────────────────────

function _buildAppHelpAbout() {
  return buildHelpAboutHTML({
    helpTitle: 'SPREAD-X Help',
    aboutTitle: 'About SPREAD-X',
    aboutLogo: '<i class="bi bi-globe-americas me-2"></i>',
  });
}

// ── Status bar ────────────────────────────────────────────────────────────

function _buildAppStatusBar() {
  const html = buildStatusBarHTML({
    brandHTML: `<span id="status-brand" style="opacity:0.6">
      <i class="bi bi-globe-americas me-1"></i>SPREAD-X</span>`,
  });
  return html.replace(
    '</div>',
    '<button id="btn-debug-perf-status" class="d-none" title="Toggle debug perf status" aria-label="Toggle debug perf status" aria-pressed="false"><i class="bi bi-bug"></i></button></div>'
  );
}

// ── Full HTML assembly ────────────────────────────────────────────────────

function buildAppHTML() {
  return [
    _buildAppToolbar(),
    _buildLayerPanel(),
    _buildMapContainer(),
    _buildSettingsPanel(),
    _buildAppStatusBar(),
    _buildAppModals(),
    _buildAppHelpAbout(),
    _buildWelcomeOverlay(),
  ].join('\n');
}

// Auto-inject into <div id="app-html-host">
(function () {
  const host = document.getElementById('app-html-host');
  if (host) host.outerHTML = buildAppHTML();
})();
