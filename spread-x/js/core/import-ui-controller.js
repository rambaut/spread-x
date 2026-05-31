export function createImportUiController({
  getEl,
  importOverlay,
  wireDropZone,
  onImportFile,
  setImportType,
} = {}) {
  function openImportModal(type) {
    const nextType = type || 'auto';
    setImportType?.(nextType);

    const typeSelect = getEl?.('import-layer-type');
    if (typeSelect) typeSelect.value = nextType;

    importOverlay?.classList.add('open');
  }

  function closeImportModal() {
    importOverlay?.classList.remove('open');
  }

  function bindImportUi() {
    getEl?.('btn-import-close')?.addEventListener('click', closeImportModal);
    getEl?.('btn-import-auto')?.addEventListener('click', () => openImportModal('auto'));
    getEl?.('btn-file-choose')?.addEventListener('click', () => getEl?.('file-input')?.click());

    getEl?.('file-input')?.addEventListener('change', e => {
      const file = e.target?.files?.[0];
      if (!file) return;
      onImportFile?.(file);
      closeImportModal();
    });

    const dropZone = getEl?.('file-drop-zone');
    if (dropZone) {
      wireDropZone?.(dropZone, file => {
        if (!file) return;
        onImportFile?.(file);
        closeImportModal();
      });
    }
  }

  function bindCanvasDrop(canvasWrapper) {
    if (!canvasWrapper) return;
    wireDropZone?.(canvasWrapper, file => {
      if (!file) return;
      onImportFile?.(file);
    }, { checkContains: true });
  }

  return {
    openImportModal,
    closeImportModal,
    bindImportUi,
    bindCanvasDrop,
  };
}
