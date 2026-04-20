/**
 * map-renderer.js — D3-based SVG map renderer for SPREAD-X.
 *
 * Creates and manages a zoomable SVG map that renders an ordered stack
 * of geographic layers (basemap, GeoJSON overlays, points, trees).
 */

import { LAYER_TYPES, MAP_OUTLINES } from './layers.js';

/* ── Projection factory ────────────────────────────────────────────── */

/**
 * Instantiate a D3 geo projection by function name and fit it to the
 * given viewport.  Falls back to geoNaturalEarth1 if `projId` is not
 * found on the d3 namespace.
 */
function _makeProjection(d3, projId, width, height, center, rotate) {
  const factory = d3[projId] || d3.geoNaturalEarth1;
  const proj = factory();
  if (rotate) proj.rotate(rotate);
  proj.fitSize([width, height], { type: 'Sphere' });
  if (center && (center[0] !== 0 || center[1] !== 0)) proj.center(center);
  return proj;
}

/* ── Renderer ──────────────────────────────────────────────────────── */

/**
 * @param {object} opts
 * @param {SVGElement} opts.svgElement
 * @param {object} opts.d3        — the d3 module
 * @param {object} opts.topojson  — the topojson-client module
 */
export function createMapRenderer({ svgElement, d3, topojson }) {
  let _projection = null;
  let _path       = null;
  let _layers     = [];
  let _width      = 800;
  let _height     = 600;

  // Cached TopoJSON fetches (url → Promise<topo>)
  const _topoCache = {};

  const svg  = d3.select(svgElement);
  const gMap = svg.append('g').attr('class', 'map-root');

  // Zoom behaviour
  const zoom = d3.zoom()
    .scaleExtent([0.5, 30])
    .on('zoom', ({ transform }) => gMap.attr('transform', transform));
  svg.call(zoom);

  /* ── public API ──────────────────────────────────────────────────── */

  function resize(w, h) {
    _width = w; _height = h;
    svg.attr('viewBox', `0 0 ${w} ${h}`);
  }

  function setLayers(layers) { _layers = layers; }

  async function render() {
    gMap.selectAll('*').remove();

    // Resolve projection from base-map layer (or fallback)
    const base = _layers.find(l => l.type === LAYER_TYPES.BASEMAP);
    const projId = base?.style.projection || 'geoNaturalEarth1';
    const center = base?.style.center  || [0, 0];
    const rotate = base?.style.rotate  || [0, 0, 0];
    _projection = _makeProjection(d3, projId, _width, _height, center, rotate);
    _path = d3.geoPath(_projection);

    for (const layer of _layers) {
      if (!layer.visible) continue;
      const g = gMap.append('g')
        .attr('class', `layer layer-${layer.type}`)
        .attr('data-layer-id', layer.id)
        .attr('opacity', layer.opacity);

      switch (layer.type) {
        case LAYER_TYPES.BASEMAP: await _renderBasemap(g, layer);  break;
        case LAYER_TYPES.GEOJSON:       _renderGeoJSON(g, layer);  break;
        case LAYER_TYPES.POINTS:        _renderPoints(g, layer);   break;
        case LAYER_TYPES.TREE:          _renderTree(g, layer);     break;
      }
    }
  }

  function resetZoom() {
    svg.transition().duration(400).call(zoom.transform, d3.zoomIdentity);
  }

  function getProjection() { return _projection; }
  function getPath()       { return _path; }

  /** Serialise current SVG content for export. */
  function serializeSvg() {
    const clone = svgElement.cloneNode(true);
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    clone.setAttribute('width', _width);
    clone.setAttribute('height', _height);
    return new XMLSerializer().serializeToString(clone);
  }

  /* ── layer renderers ─────────────────────────────────────────────── */

  async function _renderBasemap(g, layer) {
    const s = layer.style;

    // Sphere (ocean)
    g.append('path')
      .datum({ type: 'Sphere' })
      .attr('d', _path)
      .attr('fill', s.oceanFill)
      .attr('stroke', s.outlineStroke)
      .attr('stroke-width', s.outlineStrokeWidth);

    // Graticule
    if (s.showGraticule) {
      const step = s.graticuleStep || 10;
      g.append('path')
        .datum(d3.geoGraticule().step([step, step])())
        .attr('d', _path)
        .attr('fill', 'none')
        .attr('stroke', s.graticuleStroke)
        .attr('stroke-width', 0.5)
        .attr('opacity', s.graticuleOpacity);
    }

    // Land / countries
    if (s.outline && s.outline !== 'none') {
      try {
        const topo = await _fetchOutline(s.outline);
        if (topo) {
          const keys = Object.keys(topo.objects);
          const fc   = topojson.feature(topo, topo.objects[keys[0]]);
          const features = fc.features || [fc];

          g.append('g').attr('class', 'land')
            .selectAll('path').data(features).join('path')
            .attr('d', _path)
            .attr('fill', s.landFill)
            .attr('stroke', s.landStroke)
            .attr('stroke-width', s.landStrokeWidth);

          // Country borders (mesh)
          if (topo.objects.countries) {
            g.append('path').attr('class', 'borders')
              .datum(topojson.mesh(topo, topo.objects.countries, (a, b) => a !== b))
              .attr('d', _path)
              .attr('fill', 'none')
              .attr('stroke', s.borderStroke)
              .attr('stroke-width', s.borderStrokeWidth);
          }
        }
      } catch (err) {
        console.warn('Failed to load map outline:', err);
      }
    }
  }

  function _renderGeoJSON(g, layer) {
    if (!layer.data) return;
    const s = layer.style;
    const features = layer.data.type === 'FeatureCollection'
      ? layer.data.features : [layer.data];

    g.selectAll('path').data(features).join('path')
      .attr('d', _path)
      .attr('fill', s.fill)
      .attr('fill-opacity', s.fillOpacity)
      .attr('stroke', s.stroke)
      .attr('stroke-width', s.strokeWidth);
  }

  function _renderPoints(g, layer) {
    if (!layer.data?.length) return;
    const s = layer.style;

    const projected = layer.data.map(d => {
      const lon = d.longitude ?? d.lon ?? d.lng;
      const lat = d.latitude  ?? d.lat;
      const xy  = _projection([+lon, +lat]);
      return { ...d, _x: xy?.[0], _y: xy?.[1] };
    }).filter(d => d._x != null);

    g.selectAll('circle').data(projected).join('circle')
      .attr('cx', d => d._x)
      .attr('cy', d => d._y)
      .attr('r', s.radius)
      .attr('fill', s.fill)
      .attr('fill-opacity', s.fillOpacity)
      .attr('stroke', s.stroke)
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

  function _renderTree(g, layer) {
    if (!layer.data) return;
    const s = layer.style;
    const { branches = [], nodes = [] } = layer.data;

    if (branches.length) {
      g.selectAll('path.branch').data(branches).join('path')
        .attr('class', 'branch')
        .attr('d', d => {
          if (s.branchStyle === 'greatcircle') {
            return _path({
              type: 'LineString',
              coordinates: [[d.startLon, d.startLat], [d.endLon, d.endLat]],
            });
          }
          const a = _projection([d.startLon, d.startLat]);
          const b = _projection([d.endLon, d.endLat]);
          return a && b ? `M${a[0]},${a[1]}L${b[0]},${b[1]}` : null;
        })
        .attr('fill', 'none')
        .attr('stroke', s.branchColor)
        .attr('stroke-width', s.branchWidth)
        .attr('opacity', s.branchOpacity);
    }

    if (nodes.length) {
      const proj = nodes.map(d => {
        const xy = _projection([d.longitude ?? d.lon, d.latitude ?? d.lat]);
        return { ...d, _x: xy?.[0], _y: xy?.[1] };
      }).filter(d => d._x != null);

      g.selectAll('circle.node').data(proj).join('circle')
        .attr('class', 'node')
        .attr('cx', d => d._x).attr('cy', d => d._y)
        .attr('r', s.nodeRadius)
        .attr('fill', s.nodeColor)
        .attr('opacity', s.nodeOpacity);
    }
  }

  /* ── outline fetch with cache ────────────────────────────────────── */

  function _fetchOutline(outlineId) {
    if (_topoCache[outlineId]) return _topoCache[outlineId];
    const src = MAP_OUTLINES.find(o => o.id === outlineId);
    if (!src?.url) return Promise.resolve(null);
    _topoCache[outlineId] = fetch(src.url)
      .then(r => { if (!r.ok) throw new Error(r.statusText); return r.json(); });
    return _topoCache[outlineId];
  }

  /* ── return public interface ─────────────────────────────────────── */

  return { resize, setLayers, render, resetZoom, getProjection, getPath, serializeSvg };
}
