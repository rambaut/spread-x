export function createMapInteractionController({
  windowRef,
  canvasWrapper,
  statusStats,
  d3,
  renderer,
  mapViewport,
  countryInteractionState,
  zoomBox,
  getBasemapCenter,
  isEditableTarget,
  isFeatureHoverEnabled,
  isFeatureSelectEnabled,
  isFeatureInteractionEnabled,
  hitTestCountryFromPointerEvent,
  zoomToFeatureIds,
  zoomToSelectedCountries,
  syncBasemapCountryInteractionRuntime,
  updateCountryStatusBar,
  queueRender,
  saveState,
  updateSelectedGeoJSONStatus,
  constrainViewModeTransform,
  recordZoomTransform,
  isGeographicRasterMode,
  findBasemapLayer,
} = {}) {
  let spaceHeld = false;
  let cmdZoomDragging = false;
  let projectionDragging = false;
  let projectionDragMode = null;
  let lastDragX = 0;
  let lastDragY = 0;
  let cmdZoomStartX = 0;
  let cmdZoomStartY = 0;
  let cmdZoomCurrentX = 0;
  let cmdZoomCurrentY = 0;
  let statusBeforeSpaceHint = '';
  let pointerInCanvasWrapper = false;

  function isAltZoomModifier(e) {
    return !!e.altKey;
  }

  function isCanvasInteractionTarget(target) {
    if (!canvasWrapper || !target) return false;
    return canvasWrapper.contains(target);
  }

  function isBrowserZoomHotkey(e) {
    if (!(e.metaKey || e.ctrlKey)) return false;
    if (e.altKey) return false;
    const key = String(e.key || '').toLowerCase();
    return key === '+' || key === '=' || key === '-' || key === '_';
  }

  function setAltZoomCursorState(ready, dragging = false) {
    if (!canvasWrapper) return;
    const on = !!ready && !spaceHeld;
    canvasWrapper.classList.toggle('sx-alt-zoom-ready', on);
    canvasWrapper.classList.toggle('sx-alt-zoom-dragging', on && !!dragging);
  }

  function setSpacePanCursorState(ready, dragging = false) {
    if (!canvasWrapper) return;
    const on = !!ready;
    canvasWrapper.classList.toggle('sx-space-pan-ready', on);
    canvasWrapper.classList.toggle('sx-space-pan-dragging', on && !!dragging);
  }

  function toLocalPoint(e) {
    const rect = canvasWrapper?.getBoundingClientRect();
    if (!rect) return null;
    const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
    const y = Math.max(0, Math.min(rect.height, e.clientY - rect.top));
    return { x, y, width: rect.width, height: rect.height };
  }

  function updateZoomBox() {
    if (!cmdZoomDragging || !zoomBox) return;
    const x = Math.min(cmdZoomStartX, cmdZoomCurrentX);
    const y = Math.min(cmdZoomStartY, cmdZoomCurrentY);
    const w = Math.abs(cmdZoomCurrentX - cmdZoomStartX);
    const h = Math.abs(cmdZoomCurrentY - cmdZoomStartY);
    zoomBox.style.display = '';
    zoomBox.style.left = `${x}px`;
    zoomBox.style.top = `${y}px`;
    zoomBox.style.width = `${w}px`;
    zoomBox.style.height = `${h}px`;
  }

  function hideZoomBox() {
    if (zoomBox) zoomBox.style.display = 'none';
  }

  function applyBoxZoom(x0, y0, x1, y1, viewportW, viewportH) {
    const left = Math.min(x0, x1);
    const right = Math.max(x0, x1);
    const top = Math.min(y0, y1);
    const bottom = Math.max(y0, y1);
    const boxW = right - left;
    const boxH = bottom - top;
    if (boxW < 6 || boxH < 6) return;

    const t = renderer.getZoomTransform();
    const scaleX = viewportW / boxW;
    const scaleY = viewportH / boxH;
    const nextK = Math.max(0.5, Math.min(200, t.k * Math.min(scaleX, scaleY)));

    const centerScreenX = (left + right) / 2;
    const centerScreenY = (top + bottom) / 2;
    const worldX = (centerScreenX - t.x) / t.k;
    const worldY = (centerScreenY - t.y) / t.k;
    const targetX = (viewportW / 2) - (worldX * nextK);
    const targetY = (viewportH / 2) - (worldY * nextK);

    const target = constrainViewModeTransform(d3.zoomIdentity.translate(targetX, targetY).scale(nextK));
    mapViewport.withSuppressedHistory(() => {
      renderer.syncZoomTransform(target);
    });
    recordZoomTransform(target, { immediate: true });
    updateSelectedGeoJSONStatus(target.k);
    queueRender();
  }

  function zoomInOnPointerEvent(e, factor = 2) {
    const p = toLocalPoint(e);
    if (!p) return;

    const t = renderer.getZoomTransform();
    const currentK = Number.isFinite(t?.k) && t.k > 0 ? t.k : 1;
    const nextK = Math.max(0.5, Math.min(200, currentK * factor));
    const worldX = (p.x - t.x) / currentK;
    const worldY = (p.y - t.y) / currentK;
    const targetX = (p.x) - (worldX * nextK);
    const targetY = (p.y) - (worldY * nextK);

    const target = constrainViewModeTransform(d3.zoomIdentity.translate(targetX, targetY).scale(nextK));
    mapViewport.withSuppressedHistory(() => {
      renderer.syncZoomTransform(target);
    });
    recordZoomTransform(target, { immediate: true });
    updateSelectedGeoJSONStatus(target.k);
    queueRender();
  }

  function formatCoord(v, posLabel, negLabel) {
    const abs = Math.abs(Number(v) || 0).toFixed(2);
    return `${abs}${v >= 0 ? posLabel : negLabel}`;
  }

  function setSpaceHint(lonOnly = false, mode = 'view') {
    if (!statusStats) return;
    if (mode !== 'projection') {
      statusStats.textContent = 'Space-drag: pan view | Shift+Space-drag: move projection';
      return;
    }
    const [lon, lat] = getBasemapCenter();
    statusStats.textContent = `Shift+Space-drag${lonOnly ? ' (lon only)' : ''}: center ${formatCoord(lat, 'N', 'S')} ${formatCoord(lon, 'E', 'W')}`;
  }

  function restoreStatusAfterSpaceHint() {
    if (!statusStats) return;
    statusStats.innerHTML = statusBeforeSpaceHint || '';
    if (!statusStats.textContent) updateSelectedGeoJSONStatus();
  }

  const onWindowKeyDownSpace = e => {
    if (e.code !== 'Space') return;
    if (isEditableTarget(e.target)) return;
    if (!spaceHeld) {
      statusBeforeSpaceHint = statusStats?.innerHTML || '';
    }
    e.preventDefault();
    spaceHeld = true;
    setAltZoomCursorState(false, false);
    setSpacePanCursorState(true, false);
    renderer.setSpacePanActive(true);
    setSpaceHint(false, 'view');
  };

  const onWindowKeyDownAlt = e => {
    if (isAltZoomModifier(e)) {
      setAltZoomCursorState(true, cmdZoomDragging);
    }
  };

  const onWindowKeyUpSpace = e => {
    if (e.code !== 'Space') return;
    if (projectionDragging && projectionDragMode === 'view') {
      const transform = renderer.getZoomTransform?.();
      if (transform) recordZoomTransform(transform, { immediate: true });
    }
    spaceHeld = false;
    projectionDragging = false;
    projectionDragMode = null;
    renderer.setSpacePanActive(false);
    restoreStatusAfterSpaceHint();
    setSpacePanCursorState(false, false);
    setAltZoomCursorState(false, false);
    saveState();
  };

  const onWindowKeyUpAlt = e => {
    if (!isAltZoomModifier(e)) {
      setAltZoomCursorState(false, false);
    }
  };

  const onPointerDown = e => {
    pointerInCanvasWrapper = true;
    if (isAltZoomModifier(e) && !spaceHeld) {
      const p = toLocalPoint(e);
      if (!p) return;
      cmdZoomDragging = true;
      setAltZoomCursorState(true, true);
      cmdZoomStartX = cmdZoomCurrentX = p.x;
      cmdZoomStartY = cmdZoomCurrentY = p.y;
      updateZoomBox();
      canvasWrapper.setPointerCapture?.(e.pointerId);
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (!spaceHeld) return;
    projectionDragging = true;
    projectionDragMode = e.shiftKey ? 'projection' : 'view';
    setSpacePanCursorState(true, true);
    lastDragX = e.clientX;
    lastDragY = e.clientY;
    canvasWrapper.setPointerCapture?.(e.pointerId);
    e.preventDefault();
    e.stopPropagation();
  };

  const onPointerMove = e => {
    setAltZoomCursorState(isAltZoomModifier(e), cmdZoomDragging);

    if (cmdZoomDragging) {
      const p = toLocalPoint(e);
      if (!p) return;
      cmdZoomCurrentX = p.x;
      cmdZoomCurrentY = p.y;
      updateZoomBox();
      e.preventDefault();
      e.stopPropagation();
      return;
    }

    if (!projectionDragging) return;
    const dx = e.clientX - lastDragX;
    const dy = e.clientY - lastDragY;
    lastDragX = e.clientX;
    lastDragY = e.clientY;

    if (projectionDragMode === 'projection') {
      const moved = renderer.panProjectionByPixels(dx, dy);
      if (moved) {
        setSpaceHint(false, 'projection');
        queueRender();
      }
    } else {
      const t = renderer.getZoomTransform?.() || d3.zoomIdentity;
      const target = constrainViewModeTransform(
        d3.zoomIdentity.translate((t.x || 0) + dx, (t.y || 0) + dy).scale(t.k || 1)
      );
      mapViewport.withSuppressedHistory(() => {
        renderer.syncZoomTransform(target);
      });
      updateSelectedGeoJSONStatus(target.k);
      queueRender();
    }

    e.preventDefault();
    e.stopPropagation();
  };

  const endProjectionDrag = e => {
    if (!projectionDragging) return;
    if (projectionDragMode === 'view') {
      const transform = renderer.getZoomTransform?.();
      if (transform) recordZoomTransform(transform, { immediate: true });
    }
    projectionDragging = false;
    projectionDragMode = null;
    setSpacePanCursorState(spaceHeld, false);
    saveState();
    e?.preventDefault?.();
    e?.stopPropagation?.();
  };

  const onPointerUpForZoom = e => {
    if (!cmdZoomDragging) return;
    const p = toLocalPoint(e) || {
      x: cmdZoomCurrentX,
      y: cmdZoomCurrentY,
      width: canvasWrapper.clientWidth,
      height: canvasWrapper.clientHeight,
    };
    cmdZoomCurrentX = p.x;
    cmdZoomCurrentY = p.y;
    applyBoxZoom(cmdZoomStartX, cmdZoomStartY, cmdZoomCurrentX, cmdZoomCurrentY, p.width, p.height);
    cmdZoomDragging = false;
    hideZoomBox();
    setAltZoomCursorState(isAltZoomModifier(e), false);
    e.preventDefault();
    e.stopPropagation();
  };

  const onPointerCancel = () => {
    cmdZoomDragging = false;
    hideZoomBox();
    setAltZoomCursorState(false, false);
  };

  const onPointerLeave = e => {
    pointerInCanvasWrapper = false;
    setAltZoomCursorState(false, false);
    setSpacePanCursorState(false, false);
    if (projectionDragging && !spaceHeld) endProjectionDrag(e);
    if (countryInteractionState.hasHover()) {
      countryInteractionState.setHover(null, '');
      syncBasemapCountryInteractionRuntime();
      queueRender();
      updateCountryStatusBar();
    }
  };

  const onPointerEnter = () => {
    pointerInCanvasWrapper = true;
    setSpacePanCursorState(spaceHeld, projectionDragging);
  };

  const onWheel = e => {
    if (e.ctrlKey || e.metaKey) e.preventDefault();
  };

  const preventBrowserGestureZoom = e => {
    if (pointerInCanvasWrapper || isCanvasInteractionTarget(e.target) || cmdZoomDragging || projectionDragging) {
      e.preventDefault();
    }
  };

  const onWindowZoomHotkey = e => {
    if (!isBrowserZoomHotkey(e)) return;
    if (pointerInCanvasWrapper || isCanvasInteractionTarget(e.target)) {
      e.preventDefault();
    }
  };

  const onPointerMoveCountryHover = async e => {
    if (projectionDragging || cmdZoomDragging || spaceHeld) return;
    if (!isFeatureHoverEnabled()) {
      if (countryInteractionState.hasHover()) {
        countryInteractionState.setHover(null, '');
        syncBasemapCountryInteractionRuntime();
        queueRender();
        updateCountryStatusBar();
      }
      return;
    }

    const hit = await hitTestCountryFromPointerEvent(e);
    const nextId = hit?.id || null;
    if (nextId === countryInteractionState.hoveredId()) return;
    countryInteractionState.setHover(nextId, hit?.name || '');
    syncBasemapCountryInteractionRuntime();
    queueRender();
    updateCountryStatusBar();
  };

  const onClickCountrySelect = async e => {
    if (!isFeatureSelectEnabled() || projectionDragging || cmdZoomDragging || spaceHeld) return;
    const hit = await hitTestCountryFromPointerEvent(e);
    if (!hit?.id) return;
    const toggle = e.metaKey || e.ctrlKey;

    if (toggle) {
      countryInteractionState.toggleSelected(hit.id);
    } else {
      countryInteractionState.setSelectedSingle(hit.id);
    }

    countryInteractionState.setHover(hit.id, hit.name);
    syncBasemapCountryInteractionRuntime();
    queueRender();
    updateCountryStatusBar();
    saveState();
  };

  const onDblClickSelectedCountries = async e => {
    if (projectionDragging || cmdZoomDragging || spaceHeld) return;

    if (e.shiftKey) {
      e.preventDefault();
      e.stopPropagation();
      zoomInOnPointerEvent(e, 0.5);
      return;
    }

    const hoverEnabled = !!isFeatureHoverEnabled?.();
    const selectEnabled = !!isFeatureSelectEnabled?.();
    const interactionEnabled = !!isFeatureInteractionEnabled?.();
    if (!interactionEnabled) {
      e.preventDefault();
      e.stopPropagation();
      zoomInOnPointerEvent(e, 2);
      return;
    }

    const selectedIds = Array.from(countryInteractionState.selectedIds?.() || []);
    const selectedCount = selectedIds.length;
    const hit = await hitTestCountryFromPointerEvent(e);
    const hitId = hit?.id || null;

    let zoomIds = [];
    if (selectEnabled && selectedCount > 0 && hitId && selectedIds.includes(hitId)) {
      zoomIds = selectedIds;
    } else if (hitId) {
      zoomIds = [hitId];
      if (selectEnabled) {
        countryInteractionState.setSelectedSingle(hitId);
      }
      if (hoverEnabled) {
        countryInteractionState.setHover(hitId, hit?.name || '');
      }
      syncBasemapCountryInteractionRuntime();
      updateCountryStatusBar();
      saveState();
    }

    if (!zoomIds.length) return;
    e.preventDefault();
    e.stopPropagation();
    if (zoomIds.length === selectedCount && selectedCount > 0) {
      await zoomToSelectedCountries();
      return;
    }
    await zoomToFeatureIds?.(zoomIds);
  };

  windowRef.addEventListener('keydown', onWindowKeyDownSpace);
  windowRef.addEventListener('keydown', onWindowKeyDownAlt);
  windowRef.addEventListener('keyup', onWindowKeyUpSpace);
  windowRef.addEventListener('keyup', onWindowKeyUpAlt);

  canvasWrapper?.addEventListener('pointerdown', onPointerDown);
  canvasWrapper?.addEventListener('pointermove', onPointerMove);
  canvasWrapper?.addEventListener('pointerup', endProjectionDrag);
  canvasWrapper?.addEventListener('pointerup', onPointerUpForZoom);
  canvasWrapper?.addEventListener('pointercancel', endProjectionDrag);
  canvasWrapper?.addEventListener('pointercancel', onPointerCancel);
  canvasWrapper?.addEventListener('pointerleave', onPointerLeave);
  canvasWrapper?.addEventListener('pointerenter', onPointerEnter);
  canvasWrapper?.addEventListener('wheel', onWheel, { passive: false });
  canvasWrapper?.addEventListener('pointermove', onPointerMoveCountryHover);
  canvasWrapper?.addEventListener('click', onClickCountrySelect, { capture: true });
  canvasWrapper?.addEventListener('dblclick', onDblClickSelectedCountries, { capture: true });

  windowRef.addEventListener('gesturestart', preventBrowserGestureZoom, { passive: false, capture: true });
  windowRef.addEventListener('gesturechange', preventBrowserGestureZoom, { passive: false, capture: true });
  windowRef.addEventListener('gestureend', preventBrowserGestureZoom, { passive: false, capture: true });
  windowRef.addEventListener('keydown', onWindowZoomHotkey, { capture: true });

  return {
    isSpaceHeld: () => spaceHeld,
    setSpaceHint,
    restoreStatusAfterSpaceHint,
    cancelActiveInteractions({ releaseSpace = false } = {}) {
      projectionDragging = false;
      projectionDragMode = null;
      cmdZoomDragging = false;
      hideZoomBox();
      setSpacePanCursorState(spaceHeld, false);
      setAltZoomCursorState(false, false);
      if (releaseSpace) {
        spaceHeld = false;
        renderer.setSpacePanActive(false);
        restoreStatusAfterSpaceHint();
        setSpacePanCursorState(false, false);
      }
    },
    cycleRasterTier({ shiftKey = false, displayedTier = '' } = {}) {
      if (!isGeographicRasterMode()) return;
      const basemap = findBasemapLayer?.();
      if (!basemap) return;
      const style = basemap.style || {};
      const current = String(style.geographicRasterForceTier || 'auto').toLowerCase();
      if (shiftKey) {
        style.geographicRasterForceTier = 'auto';
      } else if (current === 'hr') {
        style.geographicRasterForceTier = '50m';
      } else if (current === '50m') {
        style.geographicRasterForceTier = 'hr';
      } else {
        const shown = String(displayedTier).trim().toUpperCase();
        style.geographicRasterForceTier = shown === 'HR' ? '50m' : 'hr';
      }
      updateSelectedGeoJSONStatus();
      queueRender();
      saveState();
    },
  };
}
