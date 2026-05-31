export class LayerManager {
  constructor({ createLayer, duplicateLayer, layerTypes }) {
    this._createLayer = createLayer;
    this._duplicateLayer = duplicateLayer;
    this._types = layerTypes;
    this._layers = [];
  }

  get layers() {
    return this._layers;
  }

  initializeDefaults() {
    this._layers.push(this._createLayer(this._types.BASEMAP, 'Base Map'));
    this._layers.push(this._createLayer(this._types.FRAME, 'Map Frame'));
    this.ensureFixedBoundaryLayers();
  }

  baseIndex() {
    return this._layers.findIndex(l => l.type === this._types.BASEMAP);
  }

  frameIndex() {
    return this._layers.findIndex(l => l.type === this._types.FRAME);
  }

  ensureFixedBoundaryLayers() {
    const baseIdx = this.baseIndex();
    if (baseIdx > 0) {
      const [base] = this._layers.splice(baseIdx, 1);
      this._layers.unshift(base);
    }

    const frameIdx = this.frameIndex();
    if (frameIdx >= 0 && frameIdx !== this._layers.length - 1) {
      const [frame] = this._layers.splice(frameIdx, 1);
      this._layers.push(frame);
    }
  }

  captureAndHide(predicate) {
    const snapshot = {};
    for (const layer of this._layers) {
      if (!predicate(layer)) continue;
      snapshot[layer.id] = layer.visible;
      layer.visible = false;
    }
    return snapshot;
  }

  restoreVisibility(snapshot = {}) {
    for (const layer of this._layers) {
      if (snapshot[layer.id] !== undefined) {
        layer.visible = snapshot[layer.id];
      }
    }
  }

  findById(id) {
    return this._layers.find(l => l.id === id) || null;
  }

  insertBeforeFrame(layer) {
    const frameIdx = this.frameIndex();
    const insertAt = frameIdx >= 0 ? frameIdx : this._layers.length;
    this._layers.splice(insertAt, 0, layer);
    this.ensureFixedBoundaryLayers();
  }

  deleteById(layerId) {
    const idx = this._layers.findIndex(l => l.id === layerId);
    if (idx < 0) return null;
    const [removed] = this._layers.splice(idx, 1);
    this.ensureFixedBoundaryLayers();
    return { removed, index: idx };
  }

  duplicateById(layerId) {
    const src = this.findById(layerId);
    if (!src) return null;
    const dup = this._duplicateLayer(src);
    const idx = this._layers.indexOf(src);
    this._layers.splice(idx + 1, 0, dup);
    this.ensureFixedBoundaryLayers();
    return dup;
  }

  moveById(layerId, dir) {
    const idx = this._layers.findIndex(l => l.id === layerId);
    if (idx < 0) return false;

    const baseIdx = this.baseIndex();
    const frameIdx = this.frameIndex();
    const minMovableIdx = Math.max(2, baseIdx + 2);
    const maxMovableIdx = Math.max(minMovableIdx, frameIdx - 1);
    const to = idx + dir;

    if (to < minMovableIdx || to > maxMovableIdx) return false;
    if (to < 0 || to >= this._layers.length) return false;

    [this._layers[idx], this._layers[to]] = [this._layers[to], this._layers[idx]];
    this.ensureFixedBoundaryLayers();
    return true;
  }
}

export function createLayerManager(opts) {
  return new LayerManager(opts);
}
