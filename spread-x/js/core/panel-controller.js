import { createSidePanelController } from '@artic-network/pearcore/pearcore-app.js';

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
  const layerController = createSidePanelController({
    panel: layerPanel,
    pinButton: layerPinButton,
    bodyEl: documentRef?.body,
    windowRef,
    pinnedBodyClass: layerPinnedClass,
  });

  const settingsController = createSidePanelController({
    panel: settingsPanel,
    pinButton: settingsPinButton,
    bodyEl: documentRef?.body,
    windowRef,
    pinnedBodyClass: settingsPinnedClass,
  });

  function closeUnpinnedPanels() {
    if (!layerController.isPinned()) layerController.close();
    if (!settingsController.isPinned()) settingsController.close();
  }

  function bindUI({
    layerToggleButton,
    layerCloseButton,
    settingsToggleButton,
    settingsCloseButton,
  } = {}) {
    layerController.bindUI({
      toggleButton: layerToggleButton,
      closeButton: layerCloseButton,
      pinButton: layerPinButton,
    });

    settingsController.bindUI({
      toggleButton: settingsToggleButton,
      closeButton: settingsCloseButton,
      pinButton: settingsPinButton,
    });
  }

  return {
    bindUI,
    openLayer: () => layerController.open(),
    closeLayer: () => layerController.close(),
    openSettings: () => settingsController.open(),
    closeSettings: () => settingsController.close(),
    closeUnpinnedPanels,
    isLayerPinned: () => layerController.isPinned(),
    isSettingsPinned: () => settingsController.isPinned(),
  };
}
