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
  // To keep the frame fixed while panning the map content, treat center
  // as an additional inverse rotation of the globe.
  const cx = Number(center?.[0] || 0);
  const cy = Number(center?.[1] || 0);
  const rx = Number(rotate?.[0] || 0);
  const ry = Number(rotate?.[1] || 0);
  const rz = Number(rotate?.[2] || 0);
  proj.rotate([rx - cx, ry - cy, rz]);
  proj.fitSize([width, height], { type: 'Sphere' });
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
  let _projId     = 'geoNaturalEarth1';
  let _spacePanActive = false;

  // Cached TopoJSON fetches (url → Promise<topo>)
  const _topoCache = {};

  const svg  = d3.select(svgElement);
  const gMap = svg.append('g').attr('class', 'map-root');
  const clipId = `${(svgElement.id || 'sx-map').replace(/[^A-Za-z0-9_-]/g, '')}-clip`;
  const defs = svg.select('defs').empty() ? svg.append('defs') : svg.select('defs');
  const clipPath = defs.select(`#${clipId}`).empty()
    ? defs.append('clipPath').attr('id', clipId).attr('clipPathUnits', 'userSpaceOnUse')
    : defs.select(`#${clipId}`);
  const clipShape = clipPath.select('path').empty()
    ? clipPath.append('path').attr('clip-rule', 'evenodd')
    : clipPath.select('path').attr('clip-rule', 'evenodd');

  // Zoom behaviour
  const zoom = d3.zoom()
    .filter(event => {
      // While using space-drag to move projection center, disable zoom drag pan.
      if (_spacePanActive && (event.type === 'mousedown' || event.type === 'touchstart')) return false;
      return (!event.ctrlKey || event.type === 'wheel') && !event.button;
    })
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
    _projId = projId;
    _projection = _makeProjection(d3, projId, _width, _height, center, rotate);
    _path = d3.geoPath(_projection);

    // Explicitly clip all rendered layers to the projected sphere boundary.
    // This prevents segments from visually crossing interruption voids.
    const spherePath = _path({ type: 'Sphere' });
    if (spherePath) {
      clipShape.attr('d', spherePath);
      gMap.attr('clip-path', `url(#${clipId})`);
    } else {
      gMap.attr('clip-path', null);
    }

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

  function setSpacePanActive(active) {
    _spacePanActive = !!active;
  }

  /**
   * Pan the active basemap projection by a screen-space delta.
   * This updates basemap.style.center in lon/lat, constrained to valid bounds.
   */
  function panProjectionByPixels(dx, dy) {
    const base = _layers.find(l => l.type === LAYER_TYPES.BASEMAP);
    if (!base || !_projection || typeof _projection.invert !== 'function') return false;

    const zoomT = d3.zoomTransform(svg.node());
    const k = zoomT?.k || 1;
    const ndx = dx / k;
    const ndy = dy / k;

    const centerPx = [_width / 2, _height / 2];
    const geoA = _projection.invert(centerPx);
    const geoB = _projection.invert([centerPx[0] - ndx, centerPx[1] - ndy]);
    if (!geoA || !geoB) return false;

    const curCenter = base.style.center || [0, 0];
    const newLon = _wrapLongitude((curCenter[0] || 0) + (geoB[0] - geoA[0]));
    const newLat = _clampLatitude((curCenter[1] || 0) + (geoB[1] - geoA[1]));
    base.style.center = [newLon, newLat];
    return true;
  }

  /**
   * Pan longitude only (keep latitude fixed), used for Shift+Space dragging.
   */
  function panProjectionLongitudeByPixels(dx) {
    const base = _layers.find(l => l.type === LAYER_TYPES.BASEMAP);
    if (!base || !_projection || typeof _projection.invert !== 'function') return false;

    const zoomT = d3.zoomTransform(svg.node());
    const k = zoomT?.k || 1;
    const ndx = dx / k;

    const centerPx = [_width / 2, _height / 2];
    const geoA = _projection.invert(centerPx);
    const geoB = _projection.invert([centerPx[0] - ndx, centerPx[1]]);
    if (!geoA || !geoB) return false;

    const curCenter = base.style.center || [0, 0];
    const newLon = _wrapLongitude((curCenter[0] || 0) + (geoB[0] - geoA[0]));
    const keepLat = _clampLatitude(curCenter[1] || 0);
    base.style.center = [newLon, keepLat];
    return true;
  }

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
          const rawFc = topojson.feature(topo, topo.objects[keys[0]]);
          const fc = _prepareForSeamClipping(rawFc);
          const features = fc.features || [fc];

          g.append('g').attr('class', 'land')
            .selectAll('path').data(features).join('path')
            .attr('d', _path)
            .attr('fill', s.landFill)
            .attr('stroke', s.landStroke)
            .attr('stroke-width', s.landStrokeWidth);

          // Country borders (mesh)
          if (topo.objects.countries) {
            const rawMesh = topojson.mesh(topo, topo.objects.countries, (a, b) => a !== b);
            const mesh = _prepareForSeamClipping(rawMesh);
            g.append('path').attr('class', 'borders')
              .datum(mesh)
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
    const prepared = _prepareForSeamClipping(layer.data);
    const features = prepared.type === 'FeatureCollection'
      ? prepared.features : [prepared];

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
    const discontinuousProjection = _isProjectionDiscontinuous(_projId);

    if (branches.length) {
      g.selectAll('path.branch').data(branches).join('path')
        .attr('class', 'branch')
        .attr('d', d => {
          if (s.branchStyle === 'greatcircle' || discontinuousProjection) {
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

  function _prepareForSeamClipping(geometry) {
    if (!geometry || typeof d3.geoStitch !== 'function') return geometry;
    try {
      return d3.geoStitch(geometry);
    } catch {
      return geometry;
    }
  }

  /* ── return public interface ─────────────────────────────────────── */

  return {
    resize,
    setLayers,
    render,
    resetZoom,
    getProjection,
    getPath,
    serializeSvg,
    setSpacePanActive,
    panProjectionByPixels,
    panProjectionLongitudeByPixels,
  };
}

function _wrapLongitude(lon) {
  if (!Number.isFinite(lon)) return 0;
  let x = ((lon + 180) % 360 + 360) % 360 - 180;
  if (x === -180) x = 180;
  return x;
}

function _clampLatitude(lat) {
  if (!Number.isFinite(lat)) return 0;
  return Math.max(-89.999, Math.min(89.999, lat));
}

function _isProjectionDiscontinuous(projId) {
  if (!projId) return false;
  return projId.startsWith('geoInterrupted') ||
    projId.startsWith('geoPolyhedral') ||
    projId === 'geoGringortenQuincuncial' ||
    projId === 'geoPeirceQuincuncial';
}
