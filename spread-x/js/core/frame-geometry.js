import { FRAME_ASPECTS } from '../layers.js';

export function computeFrameRect(width, height, frameStyle) {
  const preset = frameStyle?.aspectPreset || 'slideWide';
  const ratio = FRAME_ASPECTS[preset]?.ratio || (16 / 9);
  const margin = Math.max(0, Number(frameStyle?.margin ?? 24));

  const availW = Math.max(1, width - (2 * margin));
  const availH = Math.max(1, height - (2 * margin));

  let w = availW;
  let h = w / ratio;
  if (h > availH) {
    h = availH;
    w = h * ratio;
  }

  return {
    x: (width - w) / 2,
    y: (height - h) / 2,
    width: w,
    height: h,
  };
}
