#!/usr/bin/env bash
set -euo pipefail

# Build a shared-edge combined TopoJSON pyramid for admin0/admin1/admin2 + land.
#
# Expected input files (GeoJSON FeatureCollections):
#   maps/GeoBoundaries/src/admin0.geojson
#   maps/GeoBoundaries/src/admin1.geojson
#   maps/GeoBoundaries/src/admin2.geojson
#
# Output files:
#   spread-x/data/maps/GeoBoundaries/admin0.topo.json
#   spread-x/data/maps/GeoBoundaries/admin1.topo.json
#   spread-x/data/maps/GeoBoundaries/admin2.topo.json
#   spread-x/data/maps/GeoBoundaries/combined.level0.topo.json
#   ...
#   spread-x/data/maps/GeoBoundaries/combined.level10.topo.json
#   spread-x/data/maps/GeoBoundaries/combined-pyramid-index.json
#
# Requires mapshaper:
#   npm i -g mapshaper

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SRC_DIR="$ROOT_DIR/maps/GeoBoundaries/src"
OUT_DIR="$ROOT_DIR/spread-x/data/maps/GeoBoundaries"
TMP_DIR="$OUT_DIR/.tmp"

MAX_LEVEL=10

# Keep percentage for each simplify level (0..10).
# Level 0 == full detail (100%). Higher levels keep fewer vertices.
KEEP_PCTS=(100 85 72 60 50 42 35 29 24 20 17)

if ! command -v mapshaper >/dev/null 2>&1; then
  echo "Error: mapshaper is not installed."
  echo "Install with: npm i -g mapshaper"
  exit 1
fi

mkdir -p "$OUT_DIR"
mkdir -p "$TMP_DIR"

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

if [[ ! -f "$SRC_DIR/admin0.geojson" || ! -f "$SRC_DIR/admin1.geojson" || ! -f "$SRC_DIR/admin2.geojson" ]]; then
  echo "Combined pyramid requires admin0/admin1/admin2 source files."
  echo "Done with per-level outputs only."
  exit 0
fi

LAND_GEOJSON="$TMP_DIR/land.geojson"
COMBINED_BASE="$OUT_DIR/combined.level0.topo.json"

echo "Building land polygons from admin0 arcs"
mapshaper "$SRC_DIR/admin0.geojson" \
  -clean \
  -dissolve2 \
  -o format=geojson "$LAND_GEOJSON"

echo "Building shared combined topology (admin0/admin1/admin2/land)"
mapshaper \
  combine-files \
  "$SRC_DIR/admin0.geojson" name=admin0 \
  "$SRC_DIR/admin1.geojson" name=admin1 \
  "$SRC_DIR/admin2.geojson" name=admin2 \
  "$LAND_GEOJSON" name=land \
  -clean \
  -snap interval=1e-7 \
  -rename-layers admin0,admin1,admin2,land \
  -o format=topojson "$COMBINED_BASE"

LEVEL_ENTRIES=()

for level in $(seq 0 "$MAX_LEVEL"); do
  out_file="$OUT_DIR/combined.level${level}.topo.json"
  keep_pct="${KEEP_PCTS[$level]}%"

  if [[ "$level" -eq 0 ]]; then
    if [[ "$COMBINED_BASE" != "$out_file" ]]; then
      cp "$COMBINED_BASE" "$out_file"
    fi
  else
    echo "Building simplify level $level (keep $keep_pct)"
    mapshaper "$COMBINED_BASE" \
      -simplify visvalingam weighted "$keep_pct" keep-shapes \
      -o format=topojson "$out_file"
  fi

  LEVEL_ENTRIES+=("{\"level\":$level,\"file\":\"combined.level${level}.topo.json\"}")
done

INDEX_FILE="$OUT_DIR/combined-pyramid-index.json"
{
  echo "{"
  echo "  \"version\": 1,"
  echo "  \"objects\": [\"admin0\", \"admin1\", \"admin2\", \"land\"],"
  echo "  \"levels\": ["
  for i in "${!LEVEL_ENTRIES[@]}"; do
    sep=","; [[ "$i" -eq $((${#LEVEL_ENTRIES[@]} - 1)) ]] && sep=""
    echo "    ${LEVEL_ENTRIES[$i]}$sep"
  done
  echo "  ]"
  echo "}"
} > "$INDEX_FILE"

rm -rf "$TMP_DIR"

echo "Done."
