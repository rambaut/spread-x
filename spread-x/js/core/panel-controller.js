export function createPanelController({
  documentRef,
  windowRef,
  layerPanel,
  settingsPanel,
  layerPinButton,
  settingsPinButton,
  layerPinnedClass = 'layers-pinned',
  settingsPinnedClass = 'settings-pinned',
} = {}) {
  let layerPinned = false;
  let settingsPinned = false;

  function openPanel(panel) {
    if (!panel) return;
    panel.classList.add('open');
    panel.inert = false;
  }

  function closePanel(panel, bodyClass) {
    if (!panel) return;
    panel.classList.remove('open', 'pinned');
    panel.inert = true;
    documentRef?.body?.classList.remove(bodyClass);
  }

  function pinPanel(panel, bodyClass, pinBtn) {
    if (!panel) return;
    panel.classList.add('open', 'pinned');
    panel.inert = false;
    documentRef?.body?.classList.add(bodyClass);
    if (pinBtn) {
      pinBtn.classList.add('active');
      pinBtn.innerHTML = '<i class="bi bi-pin-angle-fill"></i>';
    }
    windowRef?.dispatchEvent?.(new Event('resize'));
  }

  function unpinPanel(panel, bodyClass, pinBtn) {
    if (!panel) return;
    panel.classList.remove('pinned');
    documentRef?.body?.classList.remove(bodyClass);
    if (pinBtn) {
      pinBtn.classList.remove('active');
      pinBtn.innerHTML = '<i class="bi bi-pin-angle"></i>';
    }
    windowRef?.dispatchEvent?.(new Event('resize'));
  }

  function openLayer() {
    openPanel(layerPanel);
  }

  function closeLayer() {
    closePanel(layerPanel, layerPinnedClass);
    layerPinned = false;
    unpinPanel(layerPanel, layerPinnedClass, layerPinButton);
  }

  function toggleLayer() {
    if (!layerPanel) return;
    if (layerPanel.classList.contains('open')) closeLayer();
    else openLayer();
  }

  function toggleLayerPin() {
    layerPinned = !layerPinned;
    if (layerPinned) pinPanel(layerPanel, layerPinnedClass, layerPinButton);
    else unpinPanel(layerPanel, layerPinnedClass, layerPinButton);
  }

  function openSettings() {
    openPanel(settingsPanel);
  }

  function closeSettings() {
    closePanel(settingsPanel, settingsPinnedClass);
    settingsPinned = false;
    unpinPanel(settingsPanel, settingsPinnedClass, settingsPinButton);
  }

  function toggleSettings() {
    if (!settingsPanel) return;
    if (settingsPanel.classList.contains('open')) closeSettings();
    else openSettings();
  }

  function toggleSettingsPin() {
    settingsPinned = !settingsPinned;
    if (settingsPinned) pinPanel(settingsPanel, settingsPinnedClass, settingsPinButton);
    else unpinPanel(settingsPanel, settingsPinnedClass, settingsPinButton);
  }

  function closeUnpinnedPanels() {
    if (!layerPinned) closeLayer();
    if (!settingsPinned) closeSettings();
  }

  function bindUI({
    layerToggleButton,
    layerCloseButton,
    settingsToggleButton,
    settingsCloseButton,
  } = {}) {
    layerToggleButton?.addEventListener('click', toggleLayer);
    layerCloseButton?.addEventListener('click', closeLayer);
    layerPinButton?.addEventListener('click', toggleLayerPin);

    settingsToggleButton?.addEventListener('click', toggleSettings);
    settingsCloseButton?.addEventListener('click', closeSettings);
    settingsPinButton?.addEventListener('click', toggleSettingsPin);
  }

  return {
    bindUI,
    openLayer,
    closeLayer,
    openSettings,
    closeSettings,
    closeUnpinnedPanels,
    isLayerPinned: () => layerPinned,
    isSettingsPinned: () => settingsPinned,
  };
}
