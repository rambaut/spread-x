export class CountryInteractionState {
  constructor() {
    this._hoveredCountryId = null;
    this._hoveredCountryName = '';
    this._selectedCountryIds = new Set();
  }

  hoveredId() {
    return this._hoveredCountryId;
  }

  hoveredName() {
    return this._hoveredCountryName;
  }

  hasHover() {
    return !!this._hoveredCountryId;
  }

  selectedIds() {
    return this._selectedCountryIds;
  }

  selectedCount() {
    return this._selectedCountryIds.size;
  }

  setHover(id, name = '') {
    this._hoveredCountryId = id || null;
    this._hoveredCountryName = this._hoveredCountryId ? (name || '') : '';
  }

  clear({ keepSelection = false } = {}) {
    this.setHover(null, '');
    if (!keepSelection) this._selectedCountryIds = new Set();
  }

  toggleSelected(id) {
    if (!id) return;
    if (this._selectedCountryIds.has(id)) this._selectedCountryIds.delete(id);
    else this._selectedCountryIds.add(id);
  }

  setSelectedSingle(id) {
    this._selectedCountryIds = id ? new Set([id]) : new Set();
  }
}

export function createCountryInteractionState() {
  return new CountryInteractionState();
}
