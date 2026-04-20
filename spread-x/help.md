# SPREAD-X Help

SPREAD-X maps spatial phylogenetic trees onto geographic projections.

## Getting Started

1. The app starts with a default **Base Map** layer using the Natural Earth
   projection with country outlines.
2. Click the **+** button in the toolbar or layer panel to add data layers.
3. Import GeoJSON/TopoJSON files, CSV point data, or phylogenetic trees.
4. You can also **drag and drop** files onto the map.

## Layers

The **Layers** panel on the left shows all layers in draw order (bottom to top).

- **Toggle visibility** — Click the eye icon next to a layer
- **Select** — Click a layer to select it and show its settings
- **Reorder** — Use the arrow buttons to move layers up/down
- **Delete** — Select a layer and click the trash icon
- **Duplicate** — Select a layer and click the copy icon

### Layer Types

- **Base Map** — Sets the projection, country outlines, ocean/land colours,
  and graticule. There is always exactly one base map layer.
- **GeoJSON** — Any GeoJSON or TopoJSON geographic data with fill/stroke styling.
- **Points** — CSV or JSON point data with latitude/longitude columns.
  Supports labels from any data field.
- **Tree** — Phylogenetic trees rendered as branches on the map (great circle
  or straight line).

## Settings

The **Settings** panel on the right shows visual controls for the selected layer.
All changes are applied live.

## Map Navigation

- **Pan** — Click and drag the map
- **Zoom** — Scroll wheel or pinch gesture
- **Reset** — Click the fullscreen icon in the toolbar

## Projections

Available D3 projections include Natural Earth, Equal Earth, Mercator,
Transverse Mercator, Equirectangular, Orthographic, Stereographic,
Azimuthal Equal Area, Conic Equal Area, and Albers.

## Keyboard Shortcuts

- `Cmd+O` — Import file
- `Cmd+Shift+E` — Export graphic
- `Escape` — Close panels and modals
