export class MapViewport {
  constructor({ d3, onHistoryChange } = {}) {
    this._d3 = d3;
    this._onHistoryChange = onHistoryChange;
    this._history = [];
    this._historyIndex = -1;
    this._historyTimer = null;
    this._suppressHistory = false;
    this._viewConstraint = null;
  }

  _cloneTransform(transform) {
    if (!transform) return this._d3.zoomIdentity;
    return this._d3.zoomIdentity.translate(transform.x, transform.y).scale(transform.k);
  }

  _sameTransform(a, b) {
    if (!a || !b) return false;
    const eps = 1e-6;
    return Math.abs(a.k - b.k) < eps && Math.abs(a.x - b.x) < eps && Math.abs(a.y - b.y) < eps;
  }

  canGoBack() {
    return this._historyIndex > 0;
  }

  canGoForward() {
    return this._historyIndex >= 0 && this._historyIndex < this._history.length - 1;
  }

  currentIndex() {
    return this._historyIndex;
  }

  historyLength() {
    return this._history.length;
  }

  getAt(index) {
    return this._history[index] || null;
  }

  setIndex(index) {
    this._historyIndex = index;
    this._onHistoryChange?.();
  }

  withSuppressedHistory(fn) {
    this._suppressHistory = true;
    try {
      return fn();
    } finally {
      this._suppressHistory = false;
    }
  }

  setViewConstraintBase(transform, viewportSize) {
    if (!transform || !viewportSize) return;
    const width = Number(viewportSize.width || 0);
    const height = Number(viewportSize.height || 0);
    if (width <= 0 || height <= 0) return;

    const k = Number(transform.k || 1);
    const x = Number(transform.x || 0);
    const y = Number(transform.y || 0);

    const minX = (0 - x) / k;
    const maxX = (width - x) / k;
    const minY = (0 - y) / k;
    const maxY = (height - y) / k;

    this._viewConstraint = {
      minScale: k,
      worldBounds: { minX, maxX, minY, maxY },
    };
  }

  clearViewConstraint() {
    this._viewConstraint = null;
  }

  hasViewConstraint() {
    return !!this._viewConstraint;
  }

  clampToViewConstraint(transform, viewportSize) {
    if (!this._viewConstraint || !transform || !viewportSize) return transform;
    const width = Number(viewportSize.width || 0);
    const height = Number(viewportSize.height || 0);
    if (width <= 0 || height <= 0) return transform;

    const bounds = this._viewConstraint.worldBounds;
    const k = Math.max(Number(transform.k || 1), this._viewConstraint.minScale);

    const xMin = width - (k * bounds.maxX);
    const xMax = -(k * bounds.minX);
    const yMin = height - (k * bounds.maxY);
    const yMax = -(k * bounds.minY);

    const x = Math.min(xMax, Math.max(xMin, Number(transform.x || 0)));
    const y = Math.min(yMax, Math.max(yMin, Number(transform.y || 0)));

    return this._d3.zoomIdentity.translate(x, y).scale(k);
  }

  commit(transform) {
    if (!transform || this._suppressHistory) return;
    if (this._historyIndex >= 0 && this._sameTransform(this._history[this._historyIndex], transform)) {
      this._onHistoryChange?.();
      return;
    }

    if (this._historyIndex < this._history.length - 1) {
      this._history = this._history.slice(0, this._historyIndex + 1);
    }

    this._history.push(this._cloneTransform(transform));
    if (this._history.length > 200) this._history.shift();
    this._historyIndex = this._history.length - 1;
    this._onHistoryChange?.();
  }

  record(transform, { immediate = false } = {}) {
    if (!transform || this._suppressHistory) return;
    if (immediate) {
      clearTimeout(this._historyTimer);
      this._historyTimer = null;
      this.commit(transform);
      return;
    }

    clearTimeout(this._historyTimer);
    this._historyTimer = setTimeout(() => {
      this._historyTimer = null;
      this.commit(transform);
    }, 140);
  }
}

export function createMapViewport(opts) {
  return new MapViewport(opts);
}
