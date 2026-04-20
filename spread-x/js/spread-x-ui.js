// spread-x-ui.js — App UI builder (classic script).
//
// Builds HTML strings using pearcore-ui.js global helpers, then
// auto-injects into the DOM.  Must be loaded after pearcore-ui.js.

// ── Layer panel (left) ────────────────────────────────────────────────────

function _buildLayerPanel() {
  return `
<div id="layer-panel" class="sx-side-panel sx-panel-left">
  <div class="sx-panel-header">
    <h2><i class="bi bi-layers me-1"></i>Layers</h2>
    <div class="sx-panel-btns">
      <button id="btn-layer-pin" title="Pin panel open"><i class="bi bi-pin-angle"></i></button>
      <button id="btn-layer-close" title="Close">&times;</button>
    </div>
  </div>
  <div class="sx-panel-body" style="display:flex;flex-direction:column">
    <div id="layer-list" class="sx-layer-list" style="flex:1;overflow-y:auto"></div>
    <div class="sx-layer-controls">
      <div class="btn-group btn-group-sm">
        <button id="btn-add-layer" class="btn btn-outline-secondary" title="Add layer">
          <i class="bi bi-plus-lg"></i>
        </button>
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

function _buildSettingsPanel() {
  return `
<div id="settings-panel" class="sx-side-panel sx-panel-right">
  <div class="sx-panel-header">
    <h2><i class="bi bi-gear me-1"></i>Layer Settings</h2>
    <div class="sx-panel-btns">
      <button id="btn-settings-pin" title="Pin panel open"><i class="bi bi-pin-angle"></i></button>
      <button id="btn-settings-close" title="Close">&times;</button>
    </div>
  </div>
  <div class="sx-panel-body" id="settings-panel-body" style="padding:0">

    <div id="settings-none" class="sx-settings-placeholder">
      <p class="text-muted">Select a layer to edit its settings</p>
    </div>

    <!-- ── Common (shown for every layer) ── -->
    <div id="settings-common" class="sx-settings-section" style="display:none">
      <div class="sx-setting-row">
        <label for="setting-layer-name">Name</label>
        <input type="text" id="setting-layer-name" class="form-control form-control-sm sx-setting-input" />
      </div>
      <div class="sx-setting-row">
        <label for="setting-layer-opacity">Opacity</label>
        <input type="range" id="setting-layer-opacity" class="form-range" min="0" max="1" step="0.05" value="1" />
      </div>
    </div>

    <!-- ── Base map ── -->
    <div id="settings-basemap" class="sx-settings-section" style="display:none">
      <h3><i class="bi bi-globe-americas"></i> Base Map</h3>

      <div class="sx-setting-row">
        <label for="set-bm-projection">Projection</label>
        <select id="set-bm-projection" class="form-select form-select-sm sx-setting-input">
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
        </select>
      </div>
      <div class="sx-setting-row">
        <label for="set-bm-outline">Outline</label>
        <select id="set-bm-outline" class="form-select form-select-sm sx-setting-input">
          <option value="countries-110m">Countries (110m)</option>
          <option value="countries-50m">Countries (50m)</option>
          <option value="land-110m">Land only (110m)</option>
          <option value="land-50m">Land only (50m)</option>
          <option value="none">None</option>
        </select>
      </div>
      <div class="sx-setting-row">
        <label for="set-bm-ocean">Ocean</label>
        <input type="color" id="set-bm-ocean" class="pt-palette-color" value="#02292e" />
      </div>
      <div class="sx-setting-row">
        <label for="set-bm-land">Land fill</label>
        <input type="color" id="set-bm-land" class="pt-palette-color" value="#1a3a2a" />
      </div>
      <div class="sx-setting-row">
        <label for="set-bm-land-stroke">Land stroke</label>
        <input type="color" id="set-bm-land-stroke" class="pt-palette-color" value="#4a8a5a" />
      </div>
      <div class="sx-setting-row">
        <label for="set-bm-land-sw">Stroke width</label>
        <input type="range" id="set-bm-land-sw" class="form-range" min="0" max="3" step="0.1" value="0.5" />
      </div>
      <div class="sx-setting-row">
        <label for="set-bm-border">Border stroke</label>
        <input type="color" id="set-bm-border" class="pt-palette-color" value="#3a6a4a" />
      </div>
      <div class="sx-setting-row">
        <label for="set-bm-border-sw">Border width</label>
        <input type="range" id="set-bm-border-sw" class="form-range" min="0" max="2" step="0.1" value="0.3" />
      </div>
      <div class="sx-setting-row">
        <label>
          <input type="checkbox" id="set-bm-grat" class="form-check-input" checked />
          Graticule
        </label>
      </div>
      <div class="sx-setting-row">
        <label for="set-bm-grat-step">Step (°)</label>
        <input type="range" id="set-bm-grat-step" class="form-range" min="5" max="30" step="5" value="10" />
      </div>
      <div class="sx-setting-row">
        <label for="set-bm-grat-stroke">Graticule colour</label>
        <input type="color" id="set-bm-grat-stroke" class="pt-palette-color" value="#ffffff" />
      </div>
      <div class="sx-setting-row">
        <label for="set-bm-grat-opacity">Graticule opacity</label>
        <input type="range" id="set-bm-grat-opacity" class="form-range" min="0" max="0.5" step="0.02" value="0.1" />
      </div>
      <div class="sx-setting-row">
        <label for="set-bm-outline-stroke">Globe outline</label>
        <input type="color" id="set-bm-outline-stroke" class="pt-palette-color" value="#4a8a5a" />
      </div>
      <div class="sx-setting-row">
        <label for="set-bm-outline-sw">Outline width</label>
        <input type="range" id="set-bm-outline-sw" class="form-range" min="0" max="3" step="0.1" value="1" />
      </div>
    </div>

    <!-- ── GeoJSON ── -->
    <div id="settings-geojson" class="sx-settings-section" style="display:none">
      <h3><i class="bi bi-hexagon"></i> GeoJSON</h3>
      <div class="sx-setting-row">
        <label for="set-gj-fill">Fill</label>
        <input type="color" id="set-gj-fill" class="pt-palette-color" value="#2aa198" />
      </div>
      <div class="sx-setting-row">
        <label for="set-gj-fill-op">Fill opacity</label>
        <input type="range" id="set-gj-fill-op" class="form-range" min="0" max="1" step="0.05" value="0.3" />
      </div>
      <div class="sx-setting-row">
        <label for="set-gj-stroke">Stroke</label>
        <input type="color" id="set-gj-stroke" class="pt-palette-color" value="#2aa198" />
      </div>
      <div class="sx-setting-row">
        <label for="set-gj-sw">Stroke width</label>
        <input type="range" id="set-gj-sw" class="form-range" min="0" max="5" step="0.25" value="1" />
      </div>
    </div>

    <!-- ── Points ── -->
    <div id="settings-points" class="sx-settings-section" style="display:none">
      <h3><i class="bi bi-geo-alt"></i> Points</h3>
      <div class="sx-setting-row">
        <label for="set-pt-radius">Radius</label>
        <input type="range" id="set-pt-radius" class="form-range" min="1" max="20" step="0.5" value="4" />
      </div>
      <div class="sx-setting-row">
        <label for="set-pt-fill">Fill</label>
        <input type="color" id="set-pt-fill" class="pt-palette-color" value="#b58900" />
      </div>
      <div class="sx-setting-row">
        <label for="set-pt-fill-op">Fill opacity</label>
        <input type="range" id="set-pt-fill-op" class="form-range" min="0" max="1" step="0.05" value="0.8" />
      </div>
      <div class="sx-setting-row">
        <label for="set-pt-stroke">Stroke</label>
        <input type="color" id="set-pt-stroke" class="pt-palette-color" value="#ffffff" />
      </div>
      <div class="sx-setting-row">
        <label for="set-pt-sw">Stroke width</label>
        <input type="range" id="set-pt-sw" class="form-range" min="0" max="4" step="0.25" value="1" />
      </div>
      <div class="sx-setting-row">
        <label for="set-pt-label">Label field</label>
        <select id="set-pt-label" class="form-select form-select-sm sx-setting-input">
          <option value="">None</option>
        </select>
      </div>
      <div class="sx-setting-row">
        <label for="set-pt-label-sz">Label size</label>
        <input type="range" id="set-pt-label-sz" class="form-range" min="6" max="24" step="1" value="10" />
      </div>
    </div>

    <!-- ── Tree ── -->
    <div id="settings-tree" class="sx-settings-section" style="display:none">
      <h3><i class="bi bi-diagram-3"></i> Tree</h3>
      <div class="sx-setting-row">
        <label for="set-tr-style">Branches</label>
        <select id="set-tr-style" class="form-select form-select-sm sx-setting-input">
          <option value="greatcircle">Great circle</option>
          <option value="straight">Straight line</option>
        </select>
      </div>
      <div class="sx-setting-row">
        <label for="set-tr-color">Branch colour</label>
        <input type="color" id="set-tr-color" class="pt-palette-color" value="#BF4B43" />
      </div>
      <div class="sx-setting-row">
        <label for="set-tr-width">Branch width</label>
        <input type="range" id="set-tr-width" class="form-range" min="0.5" max="5" step="0.25" value="1.5" />
      </div>
      <div class="sx-setting-row">
        <label for="set-tr-op">Branch opacity</label>
        <input type="range" id="set-tr-op" class="form-range" min="0" max="1" step="0.05" value="0.8" />
      </div>
      <div class="sx-setting-row">
        <label for="set-tr-node-color">Node colour</label>
        <input type="color" id="set-tr-node-color" class="pt-palette-color" value="#BF4B43" />
      </div>
      <div class="sx-setting-row">
        <label for="set-tr-node-r">Node radius</label>
        <input type="range" id="set-tr-node-r" class="form-range" min="1" max="10" step="0.5" value="3" />
      </div>
      <div class="sx-setting-row">
        <label for="set-tr-node-op">Node opacity</label>
        <input type="range" id="set-tr-node-op" class="form-range" min="0" max="1" step="0.05" value="0.8" />
      </div>
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
      <div class="sx-dropdown" id="add-layer-dropdown">
        <button id="btn-add-toolbar" class="btn btn-sm btn-outline-secondary" title="Add layer…">
          <i class="bi bi-plus-lg me-1"></i><i class="bi bi-caret-down-fill" style="font-size:0.55rem"></i>
        </button>
        <div class="sx-dropdown-menu" id="add-layer-menu">
          <button class="sx-dropdown-item" data-add-type="geojson">
            <i class="bi bi-hexagon"></i> GeoJSON / TopoJSON
          </button>
          <button class="sx-dropdown-item" data-add-type="points">
            <i class="bi bi-geo-alt"></i> Points (CSV / JSON)
          </button>
          <button class="sx-dropdown-item" data-add-type="tree">
            <i class="bi bi-diagram-3"></i> Phylogenetic Tree
          </button>
          <div class="sx-dropdown-sep"></div>
          <button class="sx-dropdown-item" id="btn-import-auto">
            <i class="bi bi-file-earmark-arrow-up"></i> Import File…
          </button>
        </div>
      </div>`,
    centerHTML: `
      <span id="toolbar-title" class="text-muted" style="font-size:0.85rem">SPREAD-X</span>`,
    rightHTML: `
      <button id="btn-reset-zoom" class="btn btn-sm btn-outline-secondary" title="Reset zoom">
        <i class="bi bi-fullscreen"></i>
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
    <svg id="map-svg"></svg>
  </div>
</div>`;
}

// ── Import file modal ─────────────────────────────────────────────────────

function _buildAppModals() {
  return buildModalHTML({
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
  return buildStatusBarHTML({
    brandHTML: `<span id="status-brand" style="opacity:0.6">
      <i class="bi bi-globe-americas me-1"></i>SPREAD-X</span>`,
  });
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
  ].join('\n');
}

// Auto-inject into <div id="app-html-host">
(function () {
  const host = document.getElementById('app-html-host');
  if (host) host.outerHTML = buildAppHTML();
})();
