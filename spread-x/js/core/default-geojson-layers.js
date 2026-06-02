import { GEOJSON_LIMITS } from '../config.js';

const PREFERRED_ADMIN_BOUNDARY_SOURCES = {
  Admin_0: {
    url: 'data/maps/GeoBoundaries/admin0.topo.json',
    objectName: 'admin0',
  },
  Admin_1: {
    url: 'data/maps/GeoBoundaries/admin1.topo.json',
    objectName: 'admin1',
  },
  Admin_2: {
    url: 'data/maps/GeoBoundaries/admin2.topo.json',
    objectName: 'admin2',
  },
};

const COMBINED_ADMIN_BOUNDARY_PYRAMID = {
  manifestUrl: 'data/maps/GeoBoundaries/manifest.json',
  basePath: 'data/maps/GeoBoundaries',
  fallbackObjectNames: {
    Admin_0: 'admin0',
    Admin_1: 'admin1',
    Admin_2: 'admin2',
    Land: 'land',
  },
};

export function normalizedLayerName(layer) {
  return (layer?.name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function normalizeKey(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function resolveBoundaryObjectName(boundaryKey, objectNames = {}, fallbackObjectNames = {}) {
  const direct = objectNames?.[boundaryKey];
  if (typeof direct === 'string' && direct) return direct;

  const normalizedBoundary = normalizeKey(boundaryKey);
  for (const [key, value] of Object.entries(objectNames || {})) {
    if (normalizeKey(key) === normalizedBoundary) return String(value || key);
    if (normalizeKey(value) === normalizedBoundary) return String(value || key);
  }

  return fallbackObjectNames?.[boundaryKey] || boundaryKey;
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
  let combinedAdminPyramidPromise = null;

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

  async function loadCombinedAdminBoundaryPyramid() {
    if (!combinedAdminPyramidPromise) {
      combinedAdminPyramidPromise = (async () => {
        const manifestResponse = await fetchFn(COMBINED_ADMIN_BOUNDARY_PYRAMID.manifestUrl);
        if (!manifestResponse.ok) return null;
        const manifest = await manifestResponse.json();
        const entries = Array.isArray(manifest?.levels) ? manifest.levels : [];
        if (!entries.length) return null;

        const byLevel = new Map();
        for (const entry of entries) {
          const level = Number(entry?.level);
          const file = String(entry?.file || '').trim();
          if (!Number.isFinite(level) || !file) continue;
          const url = `${COMBINED_ADMIN_BOUNDARY_PYRAMID.basePath}/${file}`;
          try {
            const res = await fetchFn(url);
            if (!res.ok) continue;
            const topology = await res.json();
            if (topology?.type === 'Topology') byLevel.set(level, topology);
          } catch {
            // Continue loading other levels if one file is unavailable.
          }
        }

        if (!byLevel.size) return null;

        return {
          byLevel,
          objectNames: manifest?.objects || {},
        };
      })().catch(() => null);
    }
    return combinedAdminPyramidPromise;
  }

  async function loadBoundarySource(boundaryKey) {
    const pyramid = await loadCombinedAdminBoundaryPyramid();
    if (pyramid) {
      return {
        _sxFormat: 'topojson-object-pyramid',
        topologiesByLevel: pyramid.byLevel,
        objectName: resolveBoundaryObjectName(
          boundaryKey,
          pyramid.objectNames,
          COMBINED_ADMIN_BOUNDARY_PYRAMID.fallbackObjectNames,
        ),
      };
    }

    const { topology, objectName } = await loadBoundaryTopology(boundaryKey);
    return {
      _sxFormat: 'topojson-object',
      topology,
      objectName,
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
      const data = await loadBoundarySource('Admin_0');
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

    for (const item of items) {
      const key = item.name.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (hasNamedGeojsonLayer(key)) continue;

      try {
        const data = await loadBoundarySource(item.objectName);
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
