import { analyzeTreeAnnotations, parseTreeData } from '@artic-network/pearcore/tree-io.js';
import { detectFileType, parseGeoData, parseCSV } from '../parsers.js';

export function createLayerImportService({
  layerTypes,
  topojson,
  createLayer,
  applyNamedGeojsonPerformanceProfile,
  requestTreeMapping,
} = {}) {
  async function processImportText(text, filename, forcedLayerType = 'auto') {
    const detected = detectFileType(text, filename);
    let layerType;
    let data;

    if (forcedLayerType !== 'auto') {
      layerType = forcedLayerType;
    } else {
      switch (detected.type) {
        case 'topojson':
        case 'geojson':
          layerType = layerTypes.GEOJSON;
          break;
        case 'points-json':
        case 'csv':
          layerType = layerTypes.POINTS;
          break;
        case 'newick':
          layerType = layerTypes.TREE;
          break;
        default:
          console.warn('Could not auto-detect type for', filename);
          layerType = layerTypes.GEOJSON;
      }
    }

    switch (layerType) {
      case layerTypes.GEOJSON:
        data = parseGeoData(detected.data, topojson);
        break;
      case layerTypes.POINTS:
        data = detected.type === 'csv'
          ? parseCSV(detected.data)
          : Array.isArray(detected.data)
            ? detected.data
            : parseCSV(text);
        break;
      case layerTypes.TREE: {
        const analysis = analyzeTreeAnnotations(detected.data);
        let mapping = {
          longitudeKey: analysis.suggested.longitudeKey || '',
          latitudeKey: analysis.suggested.latitudeKey || '',
          hpdKey: analysis.suggested.hpdKey || '',
          locationKey: analysis.suggested.locationKey || '',
          posteriorKey: analysis.suggested.posteriorKey || '',
        };

        if (analysis.hasBeastAnnotations) {
          const chosen = await requestTreeMapping?.(analysis, filename);
          if (!chosen) {
            return {
              cancelled: true,
              statusText: `Import cancelled: ${filename}`,
            };
          }
          mapping = chosen;
        }

        data = parseTreeData(detected.data, mapping);
        break;
      }
      default:
        data = detected.data;
    }

    const name = filename.replace(/\.[^.]+$/, '');
    const layer = createLayer(layerType, name, data);
    if (/^admin[ _]?1$/i.test(name) || /^admin[ _]?2$/i.test(name)) {
      layer.visible = false;
    }
    applyNamedGeojsonPerformanceProfile?.(layer, layerTypes);

    const statusText = layerType === layerTypes.TREE && data?.metadata
      ? `Imported: ${filename} (${data.metadata.nodeCount} nodes, ${data.metadata.branchCount} branches)`
      : `Imported: ${filename}`;

    return {
      cancelled: false,
      layer,
      layerType,
      data,
      statusText,
    };
  }

  return {
    processImportText,
  };
}
