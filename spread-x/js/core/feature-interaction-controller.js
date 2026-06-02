export function createFeatureInteractionController({
  canvasWrapper,
  d3,
  renderer,
  mapViewport,
  interactionState,
  statusStats,
  computeFrameRect,
  getFrameStyle,
  getActiveFeatureScale,
  getFeatureCache,
  getFeatureId,
  getFeatureName,
  isFeatureHitTestEnabled,
  isFeatureHoverEnabled,
  constrainViewModeTransform,
  recordZoomTransform,
  queueRender,
  updateFallbackStatus,
  featureLabel = 'Feature',
} = {}) {
  function statusText() {
    if (!interactionState?.hoveredName?.()) return '';
    const selectedCount = interactionState.selectedCount?.() || 0;
    const selectedSuffix = selectedCount ? ` | selected ${selectedCount}` : '';
    return `${featureLabel}: ${interactionState.hoveredName()}${selectedSuffix}`;
  }

  function updateStatusBar() {
    if (!statusStats) return;
    const text = statusText();
    if (text) statusStats.textContent = text;
    else updateFallbackStatus?.();
  }

  function eventToProjectedPoint(e) {
    const rect = canvasWrapper?.getBoundingClientRect?.();
    if (!rect) return null;

    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;

    const t = renderer.getZoomTransform?.() || d3.zoomIdentity;
    const px = (x - t.x) / t.k;
    const py = (y - t.y) / t.k;
    return [px, py];
  }

  async function hitTestFeatureFromPointerEvent(e) {
    if (isFeatureHitTestEnabled && !isFeatureHitTestEnabled()) return null;

    const projected = eventToProjectedPoint(e);
    if (!projected) return null;

    const projection = renderer.getProjection?.();
    const lonLat = projection?.invert?.(projected);
    if (!lonLat) return null;

    const cache = await getFeatureCache?.(getActiveFeatureScale?.());
    if (!cache?.features?.length) return null;

    let best = null;
    let bestArea = Infinity;

    for (const [idx, feature] of cache.features.entries()) {
      try {
        const area = d3.geoArea(feature);
        // Exclude malformed/complement polygons that can cover most of the globe.
        if (!Number.isFinite(area) || area <= 0 || area > (Math.PI * 1.5)) continue;

        if (d3.geoContains(feature, lonLat) && area < bestArea) {
          const id = getFeatureId?.(feature, idx);
          if (!id) continue;
          bestArea = area;
          best = {
            id,
            name: cache.nameById?.get?.(id) || getFeatureName?.(feature, idx) || '',
          };
        }
      } catch {
        // Ignore malformed geometries.
      }
    }

    return best;
  }

  async function zoomToFeaturesById(featureIds = []) {
    const cache = await getFeatureCache?.(getActiveFeatureScale?.());
    if (!cache) return;

    const selectedFeatures = Array.from(featureIds || [])
      .map(id => cache.byId?.get?.(id))
      .filter(Boolean);
    if (!selectedFeatures.length) return;

    const path = renderer.getPath?.();
    if (!path || !canvasWrapper) return;

    const featureCollection = { type: 'FeatureCollection', features: selectedFeatures };
    let bounds;
    try {
      bounds = path.bounds(featureCollection);
    } catch {
      return;
    }
    if (!bounds) return;

    const minX = bounds[0]?.[0];
    const minY = bounds[0]?.[1];
    const maxX = bounds[1]?.[0];
    const maxY = bounds[1]?.[1];
    if (![minX, minY, maxX, maxY].every(Number.isFinite)) return;

    const frame = computeFrameRect(
      canvasWrapper.clientWidth,
      canvasWrapper.clientHeight,
      getFrameStyle?.()
    );
    const padding = Math.max(8, Math.min(frame.width, frame.height) * 0.06);
    const boxW = Math.max(1, maxX - minX);
    const boxH = Math.max(1, maxY - minY);
    const innerW = Math.max(1, frame.width - (2 * padding));
    const innerH = Math.max(1, frame.height - (2 * padding));
    const k = Math.max(0.5, Math.min(200, Math.min(innerW / boxW, innerH / boxH)));

    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const tx = (frame.x + frame.width / 2) - (cx * k);
    const ty = (frame.y + frame.height / 2) - (cy * k);
    const target = constrainViewModeTransform?.(d3.zoomIdentity.translate(tx, ty).scale(k));

    mapViewport.withSuppressedHistory?.(() => {
      renderer.syncZoomTransform?.(target);
    });
    recordZoomTransform?.(target, { immediate: true });
    queueRender?.();
    updateStatusBar();
  }

  async function zoomToSelectedFeatures() {
    if (!interactionState?.selectedCount?.()) return;
    await zoomToFeaturesById(Array.from(interactionState.selectedIds?.() || []));
  }

  return {
    statusText,
    updateStatusBar,
    eventToProjectedPoint,
    hitTestFeatureFromPointerEvent,
    zoomToFeaturesById,
    zoomToSelectedFeatures,
  };
}

