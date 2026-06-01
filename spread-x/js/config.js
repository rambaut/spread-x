export const FRAME_PADDING_UI = {
  defaultValue: 8,
  min: 0,
  max: 48,
  step: 1,
};

export const RENDER_ZOOM_LIMITS = {
  min: 0.5,
  max: 1024,
};

export const RENDERER_MODE_LIMITS = {
  canvasToSvgSwitchDefault: 8,
  canvasToSvgSwitchMin: 2,
  canvasToSvgSwitchMax: 1024,
};

export const GEOJSON_LIMITS = {
  simplifyLevel: {
    min: 0,
    max: 10,
    defaultValue: 0,
  },
  detailPercent: {
    min: 0,
    max: 100,
    defaultValue: 100,
  },
  targetZoom: {
    min: 2,
    max: 1024,
    defaultValue: 256,
  },
  renderPolicy: {
    minZoomMin: 1,
    minZoomMax: 12,
    minZoomDefault: 1,
  },
  adaptiveDetailDebounceMs: 1000,
};
