#!/usr/bin/env bash
set -euo pipefail

# Build shared-edge TopoJSON layers for admin0/admin1/admin2.
#
# Expected input files (GeoJSON FeatureCollections):
#   spread-x/data/maps/admin-boundaries/src/admin0.geojson
#   spread-x/data/maps/admin-boundaries/src/admin1.geojson
#   spread-x/data/maps/admin-boundaries/src/admin2.geojson
#
# Output files:
#   spread-x/data/maps/admin-boundaries/admin0.topo.json
#   spread-x/data/maps/admin-boundaries/admin1.topo.json
#   spread-x/data/maps/admin-boundaries/admin2.topo.json
#
# Requires mapshaper:
#   npm i -g mapshaper

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SRC_DIR="$ROOT_DIR/spread-x/data/maps/admin-boundaries/src"
OUT_DIR="$ROOT_DIR/spread-x/data/maps/admin-boundaries"

if ! command -v mapshaper >/dev/null 2>&1; then
  echo "Error: mapshaper is not installed."
  echo "Install with: npm i -g mapshaper"
  exit 1
fi

mkdir -p "$OUT_DIR"

build_one() {
  local level="$1"
  local in_file="$SRC_DIR/${level}.geojson"
  local out_file="$OUT_DIR/${level}.topo.json"

  if [[ ! -f "$in_file" ]]; then
    echo "Skip: missing $in_file"
    return 0
  fi

  echo "Building $out_file from $in_file"

  # clean + snap reduces tiny cracks/slivers before topology construction
  mapshaper "$in_file" \
    -clean \
    -snap interval=1e-7 \
    -o format=topojson "$out_file"
}

build_one admin0
build_one admin1
build_one admin2

echo "Done."
