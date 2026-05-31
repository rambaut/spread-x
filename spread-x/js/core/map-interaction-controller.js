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
  isCountryHoverEnabled,
  hitTestCountryFromPointerEvent,
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
    const nextK = Math.max(0.5, Math.min(30, t.k * Math.min(scaleX, scaleY)));

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

  function formatCoord(v, posLabel, negLabel) {
    const abs = Math.abs(Number(v) || 0).toFixed(2);
    return `${abs}${v >= 0 ? posLabel : negLabel}`;
  }

  function setSpaceHint(lonOnly = false) {
    if (!statusStats) return;
    const [lon, lat] = getBasemapCenter();
    statusStats.textContent = `Space-drag${lonOnly ? ' (lon only)' : ''}: center ${formatCoord(lat, 'N', 'S')} ${formatCoord(lon, 'E', 'W')}`;
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
    renderer.setSpacePanActive(true);
    setSpaceHint();
  };

  const onWindowKeyDownAlt = e => {
    if (isAltZoomModifier(e)) {
      setAltZoomCursorState(true, cmdZoomDragging);
    }
  };

  const onWindowKeyUpSpace = e => {
    if (e.code !== 'Space') return;
    spaceHeld = false;
    projectionDragging = false;
    renderer.setSpacePanActive(false);
    restoreStatusAfterSpaceHint();
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

    const lonOnly = e.shiftKey;
    const moved = lonOnly
      ? renderer.panProjectionLongitudeByPixels(dx)
      : renderer.panProjectionByPixels(dx, dy);

    if (moved) {
      setSpaceHint(lonOnly);
      queueRender();
    }

    e.preventDefault();
    e.stopPropagation();
  };

  const endProjectionDrag = e => {
    if (!projectionDragging) return;
    projectionDragging = false;
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
    if (!isCountryHoverEnabled()) {
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
    if (!isCountryHoverEnabled() || projectionDragging || cmdZoomDragging || spaceHeld) return;
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

  const onDblClickSelectedCountries = e => {
    if (!isCountryHoverEnabled() || !countryInteractionState.selectedCount()) return;
    e.preventDefault();
    e.stopPropagation();
    zoomToSelectedCountries();
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
      cmdZoomDragging = false;
      hideZoomBox();
      setAltZoomCursorState(false, false);
      if (releaseSpace) {
        spaceHeld = false;
        renderer.setSpacePanActive(false);
        restoreStatusAfterSpaceHint();
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
