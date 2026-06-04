#!/usr/bin/env python3
"""Build GeoBoundaries TopoJSON preset artifacts from raw source GeoJSON files.

This script is a Python equivalent of scripts/build-admin-topology.sh with
additional CLI controls for selected simplify levels and selected source
feature files.
"""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
from pathlib import Path

ALL_FEATURES = ("admin0", "admin1", "admin2")
KEEP_PCTS = {
    0: 100,
    1: 85,
    2: 72,
    3: 60,
    4: 50,
    5: 42,
    6: 35,
    7: 29,
    8: 24,
    9: 20,
    10: 17,
}
SWITCH_ZOOM = {
    0: 1,
    1: 1.4,
    2: 1.8,
    3: 2.4,
    4: 3.1,
    5: 4.0,
    6: 5.2,
    7: 6.8,
    8: 8.6,
    9: 10.8,
    10: 13.5,
}
FEATURE_META = {
    "admin0": {
        "label": "Admin 0",
        "color": "#2aa198",
        "description": "Country boundaries",
    },
    "admin1": {
        "label": "Admin 1",
        "color": "#4e79a7",
        "description": "First-level administrative boundaries",
    },
    "admin2": {
        "label": "Admin 2",
        "color": "#f28e2b",
        "description": "Second-level administrative boundaries",
    },
    "land": {
        "label": "Land",
        "color": "#8bc34a",
        "description": "Dissolved land polygons built from admin0 arcs",
    },
}

MAPSHAPER_CMD: list[str] | None = None


def parse_csv_list(value: str) -> list[str]:
    if not value:
        return []
    return [part.strip() for part in value.split(",") if part.strip()]


def parse_levels(value: str) -> list[int]:
    raw = parse_csv_list(value)
    if not raw:
        return list(range(0, 11))

    levels: set[int] = set()
    for item in raw:
        try:
            level = int(item)
        except ValueError as exc:
            raise argparse.ArgumentTypeError(
                f"Invalid simplify level '{item}'. Expected integers 0..10."
            ) from exc
        if level < 0 or level > 10:
            raise argparse.ArgumentTypeError(
                f"Invalid simplify level '{item}'. Expected integers 0..10."
            )
        levels.add(level)

    return sorted(levels)


def parse_features(value: str) -> list[str]:
    raw = parse_csv_list(value)
    if not raw:
        return list(ALL_FEATURES)

    allowed = set(ALL_FEATURES)
    selected: list[str] = []
    seen: set[str] = set()

    for item in raw:
        key = item.lower()
        if key not in allowed:
            raise argparse.ArgumentTypeError(
                f"Invalid feature '{item}'. Allowed values: {', '.join(ALL_FEATURES)}"
            )
        if key not in seen:
            selected.append(key)
            seen.add(key)

    return selected


def parse_layout_level(value: str) -> int:
    try:
        level = int(value)
    except ValueError as exc:
        raise argparse.ArgumentTypeError(
            f"Invalid layout simplify level '{value}'. Expected integer 0..10."
        ) from exc

    if level < 0 or level > 10:
        raise argparse.ArgumentTypeError(
            f"Invalid layout simplify level '{value}'. Expected integer 0..10."
        )

    return level


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


def find_license_file(input_folder: Path) -> Path:
    candidates = [
        input_folder / "LICENSE.TXT",
        input_folder / "LICENSE.txt",
        input_folder / "LICENSE",
        input_folder / "LICENCE.TXT",
        input_folder / "LICENCE.txt",
        input_folder / "LICENCE",
    ]
    for path in candidates:
        if path.exists() and path.is_file():
            return path

    for path in sorted(input_folder.iterdir()):
        if not path.is_file():
            continue
        lowered = path.name.lower()
        if lowered.startswith("license") or lowered.startswith("licence"):
            return path

    raise RuntimeError(f"No license file found in {input_folder}")


def build_individual_topologies(src_dir: Path, out_dir: Path, features: list[str]) -> list[str]:
    built: list[str] = []

    for feature in features:
        src_file = src_dir / f"{feature}.geojson"
        out_file = out_dir / f"{feature}.topo.json"
        if not src_file.exists():
            print(f"Skip: missing {src_file}")
            continue

        print(f"Building {out_file} from {src_file}")
        run_command(mapshaper_args(
            str(src_file),
            "-clean",
            "-snap",
            "interval=1e-7",
            "-o",
            "format=topojson",
            str(out_file),
        ))
        built.append(feature)

    return built


def create_land_geojson(src_admin0: Path, tmp_dir: Path) -> Path:
    land_geojson = tmp_dir / "land.geojson"
    print("Building land polygons from admin0 arcs")
    run_command(mapshaper_args(
        str(src_admin0),
        "-clean",
        "-dissolve2",
        "-o",
        "format=geojson",
        str(land_geojson),
    ))
    return land_geojson


def build_land_topology(src_admin0: Path, tmp_dir: Path, out_dir: Path) -> None:
    land_geojson = create_land_geojson(src_admin0, tmp_dir)
    land_topology = out_dir / "land.topo.json"
    print(f"Building {land_topology} from {land_geojson}")
    run_command(mapshaper_args(
        str(land_geojson),
        "-clean",
        "-snap",
        "interval=1e-7",
        "-o",
        "format=topojson",
        str(land_topology),
    ))


def build_layout_topology(
    src_admin0: Path,
    tmp_dir: Path,
    layout_out_dir: Path,
    layout_level: int,
) -> None:
    land_geojson = create_land_geojson(src_admin0, tmp_dir)
    layout_base = tmp_dir / "layout.level0.topo.json"
    layout_file = layout_out_dir / "layout-topo.json"

    print("Building shared layout topology (countries, land)")
    run_command(mapshaper_args(
        "combine-files",
        str(src_admin0),
        "name=countries",
        str(land_geojson),
        "name=land",
        "-clean",
        "rewind",
        "-snap",
        "interval=1e-7",
        "-rename-layers",
        "countries,land",
        "-o",
        "format=topojson",
        str(layout_base),
    ))

    if layout_level == 0:
        shutil.copy2(layout_base, layout_file)
        run_command(mapshaper_args(
            str(layout_file),
            "-clean",
            "rewind",
            "-o",
            "format=topojson",
            "force",
            str(layout_file),
        ))
        print(f"Wrote {layout_file} at level 0")
        return

    keep_pct = KEEP_PCTS[layout_level]
    print(f"Simplifying layout topology to level {layout_level} (keep {keep_pct}%)")
    run_command(mapshaper_args(
        str(layout_base),
        "-simplify",
        "visvalingam",
        "weighted",
        f"{keep_pct}%",
        "keep-shapes",
        "-o",
        "format=topojson",
        str(layout_file),
    ))

    # Rewind polygon rings after simplify to avoid complement-style land fill.
    run_command(mapshaper_args(
        str(layout_file),
        "-clean",
        "rewind",
        "-o",
        "format=topojson",
        "force",
        str(layout_file),
    ))


def build_combined_base(
    src_dir: Path,
    tmp_dir: Path,
    out_dir: Path,
    features: list[str],
) -> tuple[Path, list[str]]:
    layer_names: list[str] = []
    combine_args: list[str] = mapshaper_args("combine-files")

    for feature in features:
        src_file = src_dir / f"{feature}.geojson"
        if not src_file.exists():
            continue
        combine_args.extend([str(src_file), f"name={feature}"])
        layer_names.append(feature)

    if "admin0" in layer_names:
        land_geojson = create_land_geojson(src_dir / "admin0.geojson", tmp_dir)
        combine_args.extend([str(land_geojson), "name=land"])
        layer_names.append("land")

    if not layer_names:
        raise RuntimeError("No valid source GeoJSON files were found for combined topology.")

    base_file = out_dir / "combined.level0.topo.json"
    print("Building shared combined topology:", ", ".join(layer_names))
    combine_args.extend(
        [
            "-clean",
            "-snap",
            "interval=1e-7",
            "-rename-layers",
            ",".join(layer_names),
            "-o",
            "format=topojson",
            str(base_file),
        ]
    )
    run_command(combine_args)

    return base_file, layer_names


def build_pyramid_levels(base_file: Path, out_dir: Path, levels: list[int]) -> list[dict[str, object]]:
    level_entries: list[dict[str, object]] = []

    for level in levels:
        out_file = out_dir / f"combined.level{level}.topo.json"
        if level == 0:
            if base_file != out_file:
                shutil.copy2(base_file, out_file)
        else:
            keep_pct = KEEP_PCTS[level]
            print(f"Building simplify level {level} (keep {keep_pct}%)")
            run_command(mapshaper_args(
                str(base_file),
                "-simplify",
                "visvalingam",
                "weighted",
                f"{keep_pct}%",
                "keep-shapes",
                "-o",
                "format=topojson",
                str(out_file),
            ))

        level_entries.append({"level": level, "file": out_file.name})

    return level_entries


def write_manifest_file(
    out_dir: Path,
    layer_names: list[str],
    level_entries: list[dict[str, object]],
) -> None:
    detail_levels = []
    for entry in level_entries:
        level = int(entry["level"])
        detail_levels.append(
            {
                "level": level,
                "label": "Full detail" if level == 0 else f"Level {level}",
                "switchZoom": SWITCH_ZOOM[level],
            }
        )

    objects = {name: name for name in layer_names}
    features = []
    for name in layer_names:
        meta = FEATURE_META[name]
        features.append(
            {
                "key": name,
                "label": meta["label"],
                "objectName": name,
                "color": meta["color"],
                "description": meta["description"],
            }
        )

    manifest = {
        "version": 1,
        "name": "GeoBoundaries",
        "folder": out_dir.name,
        "title": "GeoBoundaries",
        "description": "Shared-edge administrative boundary data with a precomputed simplification pyramid.",
        "logo": "bi-globe2",
        "license": {
            "name": "CC BY 4.0 / GeoBoundaries",
            "url": "https://www.geoboundaries.org/",
        },
        "color": "#2aa198",
        "objects": objects,
        "features": features,
        "detailLevels": detail_levels,
        "levels": level_entries,
    }

    manifest_file = out_dir / "manifest.json"
    manifest_file.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")


def copy_license_file(input_folder: Path, out_dir: Path) -> None:
    source_license = find_license_file(input_folder)
    target_license = out_dir / "LICENSE.TXT"
    shutil.copy2(source_license, target_license)
    print(f"Copied license to {target_license}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Compile GeoBoundaries src/admin*.geojson into per-feature TopoJSON and "
            "a simplified combined TopoJSON pyramid."
        )
    )
    parser.add_argument(
        "--input-folder",
        required=True,
        help="Folder containing src/ and the license file.",
    )
    parser.add_argument(
        "--output-folder",
        help="Output folder for generated files. Defaults to --input-folder.",
    )
    parser.add_argument(
        "--levels",
        default=",".join(str(level) for level in range(0, 11)),
        help="Comma-separated simplify levels to build (0..10). Default: 0,1,...,10",
    )
    parser.add_argument(
        "--features",
        default=",".join(ALL_FEATURES),
        help="Comma-separated source features to include (admin0,admin1,admin2). Default: all.",
    )
    parser.add_argument(
        "--create-layout-topo",
        action="store_true",
        help=(
            "Also create spread-x/data/maps/layout-topo.json as a shared-arc combined "
            "countries+land topology for globe layout rendering."
        ),
    )
    parser.add_argument(
        "--layout-level",
        type=parse_layout_level,
        default=10,
        help="Simplification level (0..10) for --create-layout-topo. Default: 10",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()

    try:
        levels = parse_levels(args.levels)
        features = parse_features(args.features)
        layout_level = int(args.layout_level)

        input_folder = Path(args.input_folder).expanduser().resolve()
        output_folder = (
            Path(args.output_folder).expanduser().resolve()
            if args.output_folder
            else input_folder
        )
        repo_root = Path(__file__).resolve().parent.parent
        layout_out_dir = repo_root / "spread-x" / "data" / "maps"

        src_dir = input_folder / "src"
        if not src_dir.exists() or not src_dir.is_dir():
            raise RuntimeError(f"Missing src folder: {src_dir}")

        ensure_mapshaper_available()
        output_folder.mkdir(parents=True, exist_ok=True)

        tmp_dir = output_folder / ".tmp"
        if tmp_dir.exists():
            shutil.rmtree(tmp_dir)
        tmp_dir.mkdir(parents=True, exist_ok=True)

        built_features = build_individual_topologies(src_dir, output_folder, features)
        if not built_features:
            raise RuntimeError("No requested source feature files were found. Nothing to build.")

        if "admin0" in built_features:
            build_land_topology(src_dir / "admin0.geojson", tmp_dir, output_folder)

        base_file, layer_names = build_combined_base(src_dir, tmp_dir, output_folder, features)
        level_entries = build_pyramid_levels(base_file, output_folder, levels)
        write_manifest_file(output_folder, layer_names, level_entries)
        copy_license_file(input_folder, output_folder)

        if args.create_layout_topo:
            src_admin0 = src_dir / "admin0.geojson"
            if not src_admin0.exists():
                raise RuntimeError(
                    "--create-layout-topo requires src/admin0.geojson to build countries and land objects."
                )
            layout_out_dir.mkdir(parents=True, exist_ok=True)
            build_layout_topology(src_admin0, tmp_dir, layout_out_dir, layout_level)

        shutil.rmtree(tmp_dir, ignore_errors=True)
        print("Done.")
        return 0

    except Exception as exc:  # pylint: disable=broad-except
        print(f"Error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
