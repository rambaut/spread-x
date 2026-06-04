#!/usr/bin/env python3
"""Build Natural Earth physical TopoJSON preset artifacts from shapefiles.

This script mirrors the role of scripts/createPresetMaps.py for the
Natural Earth physical vector bundles. For each selected resolution folder
(`10m_physical`, `50m_physical`, `110m_physical`) it combines all `.shp`
layers into a single TopoJSON so the resulting objects can share arcs where
topology permits.
"""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
from pathlib import Path

ALL_RESOLUTIONS = ("10m", "50m", "110m")
DEFAULT_SWITCH_ZOOM = 1
FEATURE_COLORS = (
    "#2aa198",
    "#b58900",
    "#4e79a7",
    "#f28e2b",
    "#e15759",
    "#76b7b2",
    "#59a14f",
    "#edc949",
    "#af7aa1",
    "#ff9da7",
)
SUPPORT_FILES = ("README.md", "VERSION", "CHANGELOG")
MAPSHAPER_CMD: list[str] | None = None


def parse_csv_list(value: str) -> list[str]:
    if not value:
        return []
    return [part.strip() for part in value.split(",") if part.strip()]


def parse_resolutions(value: str) -> list[str]:
    raw = parse_csv_list(value)
    if not raw:
        return list(ALL_RESOLUTIONS)

    seen: set[str] = set()
    selected: list[str] = []
    for item in raw:
        key = item.lower().replace("_physical", "")
        if key not in ALL_RESOLUTIONS:
            raise argparse.ArgumentTypeError(
                f"Invalid resolution '{item}'. Allowed values: {', '.join(ALL_RESOLUTIONS)}"
            )
        if key not in seen:
            selected.append(key)
            seen.add(key)
    return selected


def run_command(args: list[str]) -> None:
    result = subprocess.run(args, capture_output=True, text=True)
    if result.returncode != 0:
        if result.stdout:
            print(result.stdout.rstrip(), file=sys.stderr)
        if result.stderr:
            print(result.stderr.rstrip(), file=sys.stderr)
        raise RuntimeError(f"Command failed (exit {result.returncode}): {' '.join(args)}")


def ensure_mapshaper_available() -> None:
    global MAPSHAPER_CMD
    if MAPSHAPER_CMD is not None:
        return
    if shutil.which("mapshaper"):
        MAPSHAPER_CMD = ["mapshaper"]
        return
    if shutil.which("npx"):
        MAPSHAPER_CMD = ["npx", "--yes", "mapshaper"]
        return
    raise RuntimeError("mapshaper is not installed. Install with: npm i -g mapshaper, or ensure npx is available")


def mapshaper_args(*args: str) -> list[str]:
    ensure_mapshaper_available()
    return [*(MAPSHAPER_CMD or ["mapshaper"]), *args]


def resolution_folder_name(resolution: str) -> str:
    return f"{resolution}_physical"


def layer_key_from_stem(stem: str, resolution: str) -> str:
    prefix = f"ne_{resolution}_"
    if stem.startswith(prefix):
        return stem[len(prefix):]
    return stem


def humanize_key(key: str) -> str:
    return " ".join(part.upper() if part.isdigit() else part.capitalize() for part in key.split("_"))


def list_shapefiles(src_dir: Path) -> list[Path]:
    return sorted(
        path for path in src_dir.iterdir()
        if path.is_file() and path.suffix.lower() == ".shp"
    )


def build_layer_entries(src_dir: Path, resolution: str, include_layers: set[str] | None = None) -> list[tuple[str, Path]]:
    entries: list[tuple[str, Path]] = []
    seen_keys: set[str] = set()

    for shp_path in list_shapefiles(src_dir):
        stem = shp_path.stem
        key = layer_key_from_stem(stem, resolution)
        key_lower = key.lower()
        stem_lower = stem.lower()

        if include_layers and key_lower not in include_layers and stem_lower not in include_layers:
            continue

        if key in seen_keys:
            raise RuntimeError(f"Duplicate output object key '{key}' in {src_dir}")
        seen_keys.add(key)
        entries.append((key, shp_path))

    return entries


def build_combined_topology(src_dir: Path, out_dir: Path, resolution: str, include_layers: set[str] | None = None) -> list[str]:
    layer_entries = build_layer_entries(src_dir, resolution, include_layers)
    if not layer_entries:
        raise RuntimeError(f"No source shapefiles selected in {src_dir}")

    out_file = out_dir / "combined.level0.topo.json"
    combine_args: list[str] = mapshaper_args("combine-files")
    layer_names: list[str] = []

    for layer_name, shp_path in layer_entries:
        combine_args.extend([str(shp_path), f"name={layer_name}"])
        layer_names.append(layer_name)

    combine_args.extend(
        [
            "-clean",
            "-snap",
            "interval=1e-7",
            "-rename-layers",
            ",".join(layer_names),
            "-o",
            "format=topojson",
            str(out_file),
        ]
    )

    print(f"Building {out_file} from {src_dir.name} ({len(layer_names)} layers)")
    run_command(combine_args)
    return layer_names


def write_manifest_file(out_dir: Path, resolution: str, layer_names: list[str]) -> None:
    folder_path = f"{out_dir.parent.name}/{out_dir.name}"
    objects = {name: name for name in layer_names}
    features = []
    for index, name in enumerate(layer_names):
        features.append(
            {
                "key": name,
                "label": humanize_key(name),
                "objectName": name,
                "color": FEATURE_COLORS[index % len(FEATURE_COLORS)],
                "description": f"Natural Earth physical layer: {humanize_key(name)}",
            }
        )

    manifest = {
        "version": 1,
        "name": f"Natural Earth {resolution}",
        "folder": folder_path,
        "title": f"Natural Earth {resolution} Physical",
        "description": (
            f"Combined Natural Earth 1:{resolution} physical vector layers in a single shared-arc TopoJSON."
        ),
        "logo": "bi-globe2",
        "license": {
            "name": "Natural Earth public domain",
            "url": "https://www.naturalearthdata.com/about/terms-of-use/",
        },
        "color": FEATURE_COLORS[0],
        "objects": objects,
        "features": features,
        "detailLevels": [
            {
                "level": 0,
                "label": "Full detail",
                "switchZoom": DEFAULT_SWITCH_ZOOM,
            }
        ],
        "levels": [
            {
                "level": 0,
                "file": "combined.level0.topo.json",
            }
        ],
    }

    manifest_file = out_dir / "manifest.json"
    manifest_file.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")


def copy_support_files(src_dir: Path, out_dir: Path) -> None:
    for file_name in SUPPORT_FILES:
        src_file = src_dir / file_name
        if src_file.exists() and src_file.is_file():
            shutil.copy2(src_file, out_dir / file_name)


def parse_args() -> argparse.Namespace:
    repo_root = Path(__file__).resolve().parent.parent
    default_input_root = repo_root / "maps" / "NaturalEarth"
    default_output_root = repo_root / "spread-x" / "data" / "maps" / "NaturalEarth"

    parser = argparse.ArgumentParser(
        description=(
            "Compile Natural Earth physical shapefile bundles into one combined "
            "TopoJSON preset per resolution."
        )
    )
    parser.add_argument(
        "--input-root",
        default=str(default_input_root),
        help=f"Root containing 10m_physical/50m_physical/110m_physical. Default: {default_input_root}",
    )
    parser.add_argument(
        "--output-root",
        default=str(default_output_root),
        help=f"Root for generated preset folders. Default: {default_output_root}",
    )
    parser.add_argument(
        "--resolutions",
        default=",".join(ALL_RESOLUTIONS),
        help="Comma-separated resolutions to build (10m,50m,110m). Default: all.",
    )
    parser.add_argument(
        "--layers",
        default="",
        help=(
            "Optional comma-separated layer keys or shapefile stems to include in every selected "
            "resolution folder. Default: include all .shp files."
        ),
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()

    try:
        resolutions = parse_resolutions(args.resolutions)
        include_layers = {item.lower() for item in parse_csv_list(args.layers)} or None
        input_root = Path(args.input_root).expanduser().resolve()
        output_root = Path(args.output_root).expanduser().resolve()

        if not input_root.exists() or not input_root.is_dir():
            raise RuntimeError(f"Missing input root: {input_root}")

        ensure_mapshaper_available()
        output_root.mkdir(parents=True, exist_ok=True)

        for resolution in resolutions:
            src_dir = input_root / resolution_folder_name(resolution)
            if not src_dir.exists() or not src_dir.is_dir():
                raise RuntimeError(f"Missing resolution folder: {src_dir}")

            out_dir = output_root / resolution_folder_name(resolution)
            out_dir.mkdir(parents=True, exist_ok=True)

            layer_names = build_combined_topology(src_dir, out_dir, resolution, include_layers)
            write_manifest_file(out_dir, resolution, layer_names)
            copy_support_files(src_dir, out_dir)

        print("Done.")
        return 0

    except Exception as exc:  # pylint: disable=broad-except
        print(f"Error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())