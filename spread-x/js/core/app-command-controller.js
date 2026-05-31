export function createAppCommandController({
  documentRef,
  commands,
  openImportModal,
  openExport,
  onResetZoom,
  onResetOrientation,
  onZoomBack,
  onZoomForward,
  onToggleLayoutMode,
  getTreeMapOverlay,
  cancelTreeMapping,
  getMapInteractionController,
  closeImportModal,
  closeUnpinnedPanels,
  resetZoomButton,
  zoomBackButton,
  zoomForwardButton,
  resetOrientationButton,
  layoutModeButton,
} = {}) {
  commands.get('import').exec = () => openImportModal?.('auto');
  commands.get('export').exec = () => openExport?.();

  documentRef?.addEventListener('keydown', e => {
    for (const [, cmd] of commands.getAll()) {
      if (cmd.shortcut && commands.matchesShortcut(e, cmd.shortcut) && cmd.enabled) {
        e.preventDefault();
        cmd.exec?.();
        return;
      }
    }

    const keyIsZero = e.key === '0' || e.code === 'Digit0';
    if ((e.metaKey || e.ctrlKey) && keyIsZero) {
      e.preventDefault();
      if (e.shiftKey) onResetOrientation?.();
      else onResetZoom?.();
      return;
    }

    if (e.key === 'Escape') {
      const treeMapOverlay = getTreeMapOverlay?.();
      if (treeMapOverlay?.classList.contains('open')) {
        cancelTreeMapping?.();
        return;
      }
      getMapInteractionController?.()?.cancelActiveInteractions?.({ releaseSpace: true });
      closeImportModal?.();
      closeUnpinnedPanels?.();
    }
  });

  resetZoomButton?.addEventListener('click', onResetZoom);
  zoomBackButton?.addEventListener('click', onZoomBack);
  zoomForwardButton?.addEventListener('click', onZoomForward);
  resetOrientationButton?.addEventListener('click', onResetOrientation);
  layoutModeButton?.addEventListener('click', onToggleLayoutMode);
}
