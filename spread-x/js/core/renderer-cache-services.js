export function createTopologyOutlineFetcher({ mapOutlines = [], fetchImpl } = {}) {
  const topoCache = {};
  const fetchFn = fetchImpl || fetch;

  function fetchOutline(outlineId) {
    if (topoCache[outlineId]) return topoCache[outlineId];
    const src = mapOutlines.find(o => o.id === outlineId);
    if (!src?.url) return Promise.resolve(null);
    topoCache[outlineId] = fetchFn(src.url)
      .then(r => {
        if (!r.ok) throw new Error(r.statusText);
        return r.json();
      });
    return topoCache[outlineId];
  }

  return {
    fetchOutline,
    clear() {
      for (const key of Object.keys(topoCache)) delete topoCache[key];
    },
  };
}

export function createRasterImageLoader({ imageFactory } = {}) {
  const rasterImageCache = new Map();
  const rasterImageFailures = new Set();
  const createImage = imageFactory || (() => new Image());

  function load(url) {
    if (!url || rasterImageFailures.has(url)) return Promise.resolve(null);
    if (rasterImageCache.has(url)) return rasterImageCache.get(url);

    const promise = new Promise(resolve => {
      const img = createImage();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = () => {
        rasterImageFailures.add(url);
        resolve(null);
      };
      img.src = url;
    });

    rasterImageCache.set(url, promise);
    return promise;
  }

  return {
    load,
    clear() {
      rasterImageCache.clear();
      rasterImageFailures.clear();
    },
  };
}

export function createMutableCacheState(initial = {}) {
  const state = { ...initial };
  return {
    get(key) {
      return state[key];
    },
    set(key, value) {
      state[key] = value;
    },
  };
}
