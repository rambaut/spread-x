export async function openTreeMappingDialog({ overlay, getEl }, analysis) {
  if (!overlay || !getEl || !analysis) return null;

  const summary = getEl('tree-map-summary');
  const lonSel = getEl('tree-map-lon');
  const latSel = getEl('tree-map-lat');
  const hpdSel = getEl('tree-map-hpd');
  const locSel = getEl('tree-map-location');
  const postSel = getEl('tree-map-posterior');
  const btnClose = getEl('btn-tree-map-close');
  const btnCancel = getEl('btn-tree-map-cancel');
  const btnContinue = getEl('btn-tree-map-continue');

  if (!lonSel || !latSel || !hpdSel || !locSel || !postSel || !btnContinue) {
    return null;
  }

  const keys = analysis.annotationKeys || [];
  const options = [''].concat(keys);
  const defaultLat = keys.includes('location1')
    ? 'location1'
    : (analysis.suggested.latitudeKey || '');
  const defaultLon = keys.includes('location2')
    ? 'location2'
    : (analysis.suggested.longitudeKey || '');

  const fillSelect = (sel, selected, labelForNone = 'None') => {
    sel.innerHTML = '';
    for (const k of options) {
      const opt = document.createElement('option');
      opt.value = k;
      opt.textContent = k || labelForNone;
      if (k === selected) opt.selected = true;
      sel.appendChild(opt);
    }
  };

  fillSelect(latSel, defaultLat);
  fillSelect(lonSel, defaultLon);
  fillSelect(hpdSel, analysis.suggested.hpdKey || '');
  fillSelect(locSel, analysis.suggested.locationKey || '');
  fillSelect(postSel, analysis.suggested.posteriorKey || '');

  if (summary) {
    const mode = analysis.likelyContinuous && analysis.likelyDiscrete
      ? 'continuous + discrete'
      : analysis.likelyContinuous
        ? 'continuous'
        : analysis.likelyDiscrete
          ? 'discrete'
          : 'unknown';
    summary.textContent = `Detected ${keys.length} annotation fields (${mode} phylogeography likely).`;
  }

  overlay.classList.add('open');

  return new Promise(resolve => {
    const finish = result => {
      overlay.classList.remove('open');
      btnContinue.removeEventListener('click', onContinue);
      btnCancel?.removeEventListener('click', onCancel);
      btnClose?.removeEventListener('click', onCancel);
      resolve(result);
    };

    const onCancel = () => finish(null);
    const onContinue = () => {
      finish({
        longitudeKey: lonSel.value,
        latitudeKey: latSel.value,
        hpdKey: hpdSel.value,
        locationKey: locSel.value,
        posteriorKey: postSel.value,
      });
    };

    btnContinue.addEventListener('click', onContinue);
    btnCancel?.addEventListener('click', onCancel);
    btnClose?.addEventListener('click', onCancel);
  });
}
