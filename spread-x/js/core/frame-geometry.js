import { FRAME_ASPECTS } from '../layers.js';
import { FRAME_PADDING_UI } from '../config.js';

export function computeFrameRect(width, height, frameStyle) {
  const preset = frameStyle?.aspectPreset || 'slideWide';
  const ratio = FRAME_ASPECTS[preset]?.ratio || (16 / 9);
  const configuredPadding = Number(
    frameStyle?.padding ?? frameStyle?.margin ?? FRAME_PADDING_UI.defaultValue
  );
  const padding = Math.max(0, configuredPadding);

  const availW = Math.max(1, width - (2 * padding));
  const availH = Math.max(1, height - (2 * padding));
  const availRatio = availW / availH;

  let w;
  let h;
  if (ratio < availRatio) {
    // Narrower than available space: fill vertical dimension.
    h = availH;
    w = h * ratio;
  } else {
    // Wider than available space: fill horizontal dimension.
    w = availW;
    h = w / ratio;
  }

  return {
    x: (width - w) / 2,
    y: (height - h) / 2,
    width: w,
    height: h,
  };
}
