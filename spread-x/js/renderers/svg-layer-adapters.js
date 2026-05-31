import { isProjectionDiscontinuous } from '../core/renderer-basemap-utils.js';

export function renderSvgPointsLayer({ g, layer, projection } = {}) {
  if (!g || !layer?.data?.length || !projection) return;
  const s = layer.style || {};

  const projected = layer.data.map(d => {
    const lon = d.longitude ?? d.lon ?? d.lng;
    const lat = d.latitude ?? d.lat;
    const xy = projection([+lon, +lat]);
    return { ...d, _x: xy?.[0], _y: xy?.[1] };
  }).filter(d => d._x != null);

  g.selectAll('circle').data(projected).join('circle')
    .attr('cx', d => d._x)
    .attr('cy', d => d._y)
    .attr('r', s.radius)
    .attr('fill', s.fill)
    .attr('fill-opacity', s.fillOpacity)
    .attr('stroke', s.stroke)
    .attr('vector-effect', 'non-scaling-stroke')
    .attr('stroke-width', s.strokeWidth);

  if (s.labelField) {
    g.selectAll('text').data(projected.filter(d => d[s.labelField]))
      .join('text')
      .attr('x', d => d._x + s.radius + 3)
      .attr('y', d => d._y + 3)
      .attr('font-size', s.labelSize)
      .attr('fill', 'currentColor')
      .text(d => d[s.labelField]);
  }
}

export function renderSvgTreeLayer({ g, layer, projection, path, projId } = {}) {
  if (!g || !layer?.data || !projection || !path) return;
  const s = layer.style || {};
  const { branches = [], nodes = [] } = layer.data;
  const discontinuousProjection = isProjectionDiscontinuous(projId);

  if (branches.length) {
    g.selectAll('path.branch').data(branches).join('path')
      .attr('class', 'branch')
      .attr('d', d => {
        if (s.branchStyle === 'greatcircle' || discontinuousProjection) {
          return path({
            type: 'LineString',
            coordinates: [[d.startLon, d.startLat], [d.endLon, d.endLat]],
          });
        }
        const a = projection([d.startLon, d.startLat]);
        const b = projection([d.endLon, d.endLat]);
        return a && b ? `M${a[0]},${a[1]}L${b[0]},${b[1]}` : null;
      })
      .attr('fill', 'none')
      .attr('stroke', s.branchColor)
      .attr('stroke-width', s.branchWidth)
      .attr('vector-effect', 'non-scaling-stroke')
      .attr('stroke-linejoin', 'round')
      .attr('stroke-linecap', 'round')
      .attr('opacity', s.branchOpacity);
  }

  if (nodes.length) {
    const projectedNodes = nodes.map(d => {
      const xy = projection([d.longitude ?? d.lon, d.latitude ?? d.lat]);
      return { ...d, _x: xy?.[0], _y: xy?.[1] };
    }).filter(d => d._x != null);

    g.selectAll('circle.node').data(projectedNodes).join('circle')
      .attr('class', 'node')
      .attr('cx', d => d._x)
      .attr('cy', d => d._y)
      .attr('r', s.nodeRadius)
      .attr('fill', s.nodeColor)
      .attr('opacity', s.nodeOpacity);
  }
}
