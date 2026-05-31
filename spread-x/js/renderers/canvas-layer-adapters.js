import { isProjectionDiscontinuous } from '../core/renderer-basemap-utils.js';

export function drawCanvasPointsLayer({ ctx, layer, projection, zoomK } = {}) {
  if (!ctx || !layer?.data?.length || !projection) return;
  const s = layer.style || {};
  const k = zoomK || 1;
  const radius = s.radius || 4;

  for (const d of layer.data) {
    const lon = d.longitude ?? d.lon ?? d.lng;
    const lat = d.latitude ?? d.lat;
    const xy = projection([+lon, +lat]);
    if (!xy) continue;

    ctx.save();
    ctx.beginPath();
    ctx.arc(xy[0], xy[1], radius / k, 0, 2 * Math.PI);
    if (s.fill && s.fill !== 'none') {
      ctx.fillStyle = s.fill;
      ctx.globalAlpha *= (s.fillOpacity ?? 1);
      ctx.fill();
    }
    if (s.stroke && s.strokeWidth > 0) {
      ctx.strokeStyle = s.stroke;
      ctx.lineWidth = s.strokeWidth / k;
      ctx.stroke();
    }
    ctx.restore();

    if (s.labelField && d[s.labelField]) {
      ctx.save();
      ctx.font = `${(s.labelSize || 12) / k}px sans-serif`;
      ctx.fillStyle = '#ffffff';
      ctx.globalAlpha *= 0.9;
      ctx.fillText(d[s.labelField], xy[0] + (radius + 3) / k, xy[1] + 3 / k);
      ctx.restore();
    }
  }
}

export function drawCanvasTreeLayer({ ctx, layer, projection, ctxPath, zoomK, projId } = {}) {
  if (!ctx || !layer?.data || !projection || !ctxPath) return;
  const s = layer.style || {};
  const k = zoomK || 1;
  const { branches = [], nodes = [] } = layer.data;
  const discontinuous = isProjectionDiscontinuous(projId);

  if (branches.length) {
    ctx.save();
    ctx.strokeStyle = s.branchColor;
    ctx.lineWidth = (s.branchWidth || 1) / k;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.globalAlpha *= (s.branchOpacity ?? 1);
    for (const d of branches) {
      ctx.beginPath();
      if (s.branchStyle === 'greatcircle' || discontinuous) {
        ctxPath({ type: 'LineString', coordinates: [[d.startLon, d.startLat], [d.endLon, d.endLat]] });
      } else {
        const a = projection([d.startLon, d.startLat]);
        const b = projection([d.endLon, d.endLat]);
        if (a && b) {
          ctx.moveTo(a[0], a[1]);
          ctx.lineTo(b[0], b[1]);
        }
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  if (nodes.length) {
    ctx.save();
    ctx.fillStyle = s.nodeColor;
    ctx.globalAlpha *= (s.nodeOpacity ?? 1);
    const nodeRadius = (s.nodeRadius || 3) / k;
    for (const d of nodes) {
      const xy = projection([d.longitude ?? d.lon, d.latitude ?? d.lat]);
      if (!xy) continue;
      ctx.beginPath();
      ctx.arc(xy[0], xy[1], nodeRadius, 0, 2 * Math.PI);
      ctx.fill();
    }
    ctx.restore();
  }
}
