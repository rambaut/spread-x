import { GEOJSON_LIMITS } from '../config.js';

const PREFERRED_ADMIN_BOUNDARY_SOURCES = {
  Admin_0: {
    url: 'data/maps/admin-boundaries/admin0.topo.json',
    objectName: 'admin0',
  },
  Admin_1: {
    url: 'data/maps/admin-boundaries/admin1.topo.json',
    objectName: 'admin1',
  },
  Admin_2: {
    url: 'data/maps/admin-boundaries/admin2.topo.json',
    objectName: 'admin2',
  },
};

export function normalizedLayerName(layer) {
  return (layer?.name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function applyNamedGeojsonPerformanceProfile(layer, layerTypes) {
  if (!layer || layer.type !== layerTypes?.GEOJSON) return;
  const n = normalizedLayerName(layer);

  if (n === 'oceanmask' || n === 'oceans') {
    layer.visible = true;
    layer.style.autoPerf = false;
    layer.style.adaptiveSimplify = true;
    layer.style.simplify = 0;
    layer.style.minSimplify = 0;
    layer.style.maxSimplify = GEOJSON_LIMITS.simplifyLevel.max;
    layer.style.detailZoom = GEOJSON_LIMITS.targetZoom.defaultValue;
    layer.style.oceanFill = layer.style.oceanFill || layer.style.fill || '#0a3340';
    layer.style.landFill = layer.style.landFill || '#1a3a2a';
    layer.style.landBoundaryStroke = layer.style.landBoundaryStroke || '#4a8a5a';
    layer.style.landBoundaryWidth = layer.style.landBoundaryWidth ?? 0.5;
    return;
  }

  if (n === 'admin0' || n === 'countries') {
    layer.visible = true;
    layer.style.autoPerf = false;
    layer.style.adaptiveSimplify = true;
    layer.style.simplify = 0;
    layer.style.minSimplify = 0;
    layer.style.maxSimplify = GEOJSON_LIMITS.simplifyLevel.max;
    layer.style.detailZoom = GEOJSON_LIMITS.targetZoom.defaultValue;
    return;
  }

  if (n === 'admin1') {
    layer.style.autoPerf = false;
    layer.style.adaptiveSimplify = true;
    layer.style.simplify = 0;
    layer.style.minSimplify = 0;
    layer.style.maxSimplify = GEOJSON_LIMITS.simplifyLevel.max;
    layer.style.detailZoom = GEOJSON_LIMITS.targetZoom.defaultValue;
    return;
  }

  if (n === 'admin2') {
    layer.style.autoPerf = false;
    layer.style.adaptiveSimplify = true;
    layer.style.simplify = 0;
    layer.style.minSimplify = 0;
    layer.style.maxSimplify = GEOJSON_LIMITS.simplifyLevel.max;
    layer.style.detailZoom = GEOJSON_LIMITS.targetZoom.defaultValue;
  }
}

export function createDefaultGeojsonLayerBootstrap({
  layers,
  createLayer,
  layerTypes,
  insertLayer,
  fetchImpl,
} = {}) {
  const fetchFn = fetchImpl || fetch;
  let worldBankTopologyPromise = null;
  const preferredBoundaryTopologyPromises = new Map();

  async function loadWorldBankTopology() {
    if (!worldBankTopologyPromise) {
      worldBankTopologyPromise = fetchFn('data/maps/WorldBank.json')
        .then(response => {
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          return response.json();
        });
    }
    return worldBankTopologyPromise;
  }

  async function loadPreferredBoundaryTopology(boundaryKey) {
    const source = PREFERRED_ADMIN_BOUNDARY_SOURCES[boundaryKey];
    if (!source?.url) return null;
    if (!preferredBoundaryTopologyPromises.has(boundaryKey)) {
      preferredBoundaryTopologyPromises.set(boundaryKey,
        fetchFn(source.url)
          .then(response => {
            if (!response.ok) return null;
            return response.json();
          })
          .catch(() => null)
      );
    }
    const topology = await preferredBoundaryTopologyPromises.get(boundaryKey);
    if (!topology || topology.type !== 'Topology') return null;
    return {
      topology,
      objectName: source.objectName,
    };
  }

  async function loadBoundaryTopology(boundaryKey) {
    const preferred = await loadPreferredBoundaryTopology(boundaryKey);
    if (preferred) return preferred;
    return {
      topology: await loadWorldBankTopology(),
      objectName: boundaryKey,
    };
  }

  function hasNamedGeojsonLayer(nameKey) {
    return layers.some(l => l.type === layerTypes.GEOJSON && normalizedLayerName(l) === nameKey);
  }

  async function loadDefaultOceansLayer() {
    if (hasNamedGeojsonLayer('oceans')) return;
    try {
      const json = await loadWorldBankTopology();
      const data = {
        _sxFormat: 'topojson-object',
        topology: json,
        objectName: 'Ocean_Mask',
      };
      const layer = createLayer(layerTypes.GEOJSON, 'Oceans', data);
      layer.style.fill = '#0a3340';
      layer.style.fillOpacity = 0.22;
      layer.style.stroke = '#0a3340';
      layer.style.strokeWidth = 0;
      layer.visible = true;
      applyNamedGeojsonPerformanceProfile(layer, layerTypes);
      insertLayer(layer);
    } catch (err) {
      console.warn('Could not auto-load Oceans layer:', err);
    }
  }

  async function loadDefaultCountriesLayer() {
    if (hasNamedGeojsonLayer('countries')) return;
    try {
      const { topology, objectName } = await loadBoundaryTopology('Admin_0');
      const data = {
        _sxFormat: 'topojson-object',
        topology,
        objectName,
      };
      const layer = createLayer(layerTypes.GEOJSON, 'Countries', data);
      layer.style.fillOpacity = 0;
      layer.style.stroke = '#6a6a6a';
      layer.style.strokeWidth = 0.7;
      layer.visible = true;
      applyNamedGeojsonPerformanceProfile(layer, layerTypes);
      insertLayer(layer);
    } catch (err) {
      console.warn('Could not auto-load Countries layer:', err);
    }
  }

  async function loadDefaultAdminDetailLayers() {
    const items = [
      { objectName: 'Admin_1', name: 'Admin1' },
      { objectName: 'Admin_2', name: 'Admin2' },
    ];

    let topology = null;

    for (const item of items) {
      const key = item.name.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (hasNamedGeojsonLayer(key)) continue;

      try {
        const loaded = await loadBoundaryTopology(item.objectName);
        topology = loaded.topology;
        const data = {
          _sxFormat: 'topojson-object',
          topology,
          objectName: loaded.objectName,
        };
        const layer = createLayer(layerTypes.GEOJSON, item.name, data);
        layer.visible = false;
        layer.style.fillOpacity = 0;
        layer.style.stroke = item.name === 'Admin1' ? '#5d5d5d' : '#4d4d4d';
        layer.style.strokeWidth = item.name === 'Admin1' ? 0.45 : 0.35;
        applyNamedGeojsonPerformanceProfile(layer, layerTypes);
        insertLayer(layer);
      } catch (err) {
        console.warn(`Could not auto-load ${item.name} layer:`, err);
      }
    }
  }

  return {
    loadDefaultOceansLayer,
    loadDefaultCountriesLayer,
    loadDefaultAdminDetailLayers,
  };
}
