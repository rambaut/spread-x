export function makeProjection(d3, projId, width, height, center, rotate, frameRect) {
  const factory = d3[projId] || d3.geoNaturalEarth1;
  const proj = factory();
  // Keep frame fixed while panning map content by treating center as inverse rotation.
  const cx = Number(center?.[0] || 0);
  const cy = Number(center?.[1] || 0);
  const rx = Number(rotate?.[0] || 0);
  const ry = Number(rotate?.[1] || 0);
  const rz = Number(rotate?.[2] || 0);
  proj.rotate([rx - cx, ry - cy, rz]);
  const fitW = frameRect?.width || width;
  const fitH = frameRect?.height || height;
  proj.fitSize([fitW, fitH], { type: 'Sphere' });
  if (frameRect) {
    proj.translate([frameRect.x + frameRect.width / 2, frameRect.y + frameRect.height / 2]);
  }
  return proj;
}

export function basemapOutlineIds(source) {
  switch (source) {
    case 'ne110': return ['ne-land-110m', 'ne-countries-110m'];
    case 'ne50': return ['ne-land-50m', 'ne-countries-50m'];
    case 'ne10': return ['ne-land-10m', 'ne-countries-10m'];
    default: return ['land-110m', 'countries-110m'];
  }
}

export function normalizeNaturalEarthScale(scale, fallback = '50m') {
  return scale === '10m' || scale === '50m' || scale === '110m' ? scale : fallback;
}

export function chooseGeographicRasterPath(style = {}, zoomK = 1) {
  const setName = String(style.geographicRasterSet || 'NE1').toUpperCase();
  const switchZoom = Number(style.geographicRasterSwitchZoom ?? 2.5);
  const forcedTier = String(style.geographicRasterForceTier || 'auto').toLowerCase();
  const useHr = forcedTier === 'hr' ? true : forcedTier === '50m' ? false : zoomK >= switchZoom;
  const base = `data/maps/NaturalEarth/${setName}`;
  const low = `${base}/${setName}_50M_SR_W/${setName}_50M_SR_W.tif`;
  const hr = `${base}/${setName}_HR_LC_SR_W_DR/${setName}_HR_LC_SR_W_DR.tif`;
  return useHr ? hr : low;
}

export function computeGeographicImageRect(projection) {
  if (!projection) return null;
  const nw = projection([-180, 90]);
  const se = projection([180, -90]);
  if (!nw || !se) return null;
  const x = Math.min(nw[0], se[0]);
  const y = Math.min(nw[1], se[1]);
  const width = Math.abs(se[0] - nw[0]);
  const height = Math.abs(se[1] - nw[1]);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null;
  }
  return { x, y, width, height };
}

export function countryFeatureId(feature) {
  const p = feature?.properties || {};
  return String(
    p.ISO_A3_EH ||
    p.ADM0_A3 ||
    p.ISO_A3 ||
    p.iso_a3 ||
    p.SOV_A3 ||
    p.GU_A3 ||
    p.NAME_EN ||
    p.NAME ||
    p.ADMIN ||
    p.name ||
    feature?.id ||
    ''
  ).trim();
}

export function fillPathEvenOdd(ctx) {
  try {
    ctx.fill('evenodd');
  } catch {
    ctx.fill();
  }
}

export function isProjectionDiscontinuous(projId) {
  if (!projId) return false;
  return projId.startsWith('geoInterrupted') ||
    projId.startsWith('geoPolyhedral') ||
    projId === 'geoGringortenQuincuncial' ||
    projId === 'geoPeirceQuincuncial';
}

export function prepareForSeamClipping(geometry, { d3, projId } = {}) {
  const needsStitch = isProjectionDiscontinuous(projId) || projId === 'geoEquirectangular';
  if (!needsStitch) return geometry;
  if (!geometry || typeof d3?.geoStitch !== 'function') return geometry;

  // geoStitch is intended for polygon seam repair; applying it to line meshes
  // can create tiny discontinuities in boundary arcs.
  const geometryType = geometry?.type;
  const isPolygonal = geometryType === 'Polygon'
    || geometryType === 'MultiPolygon'
    || geometryType === 'Feature'
    || geometryType === 'FeatureCollection'
    || geometryType === 'GeometryCollection';
  if (!isPolygonal) return geometry;

  try {
    return d3.geoStitch(geometry);
  } catch {
    return geometry;
  }
}

export function wrapLongitude(lon) {
  if (!Number.isFinite(lon)) return 0;
  let x = ((lon + 180) % 360 + 360) % 360 - 180;
  if (x === -180) x = 180;
  return x;
}

export function clampLatitude(lat) {
  if (!Number.isFinite(lat)) return 0;
  return Math.max(-89.999, Math.min(89.999, lat));
}
