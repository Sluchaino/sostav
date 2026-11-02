export type IllustrationSize = 'S' | 'L';
export type ObjectRole = 'main' | 'secondary';
export type PaintTarget = 'object' | 'background';
export type ColorRole = 'background.base' | 'background.medium' | 'background.strong'
  | 'object.primary' | 'object.secondary' | 'object.soft' | 'neutral.ink' | 'neutral.paper';

export interface Palette {
  id: string;
  name: string;
  colors: Record<ColorRole, string>;
}

export interface SvgAsset {
  url: string;
  source: string;
  sha256: string;
  bytes: number;
  width: number;
  height: number;
  viewBox: [number, number, number, number];
  pathCount: number;
  elementCount: number;
  colors: string[];
  definitionIds: string[];
  tags: Record<string, number>;
  paintRoles: Record<string, ColorRole>;
}

export interface LibraryObject {
  custom?: boolean;
  meanings?: string[];
  id: string;
  name: string;
  tags: string[];
  detailStatus: 'simplified-main-pair' | 'no-proven-simplified-pair';
  note: string;
  variants: Record<IllustrationSize, Record<ObjectRole, SvgAsset>>;
}

export interface Background {
  id: string;
  name: string;
  paletteId: string;
  variants: Record<IllustrationSize, SvgAsset>;
}

export interface Catalog {
  schemaVersion: 1;
  basePaletteId: string;
  sizeMappingStatus: 'working-assumption' | 'confirmed';
  sizes: Record<IllustrationSize, { label: string; referenceFrame: { width: number; height: number } }>;
  formats: { id: string; width: number; height: number }[];
  geometryPolicy: {
    preservePaths: true;
    preserveRelativeSizes: true;
    independentObjectScaling: false;
    coordinateSpace: 'source-viewBox';
    sceneScaling: 'uniform';
    allowRotation: true;
  };
  colorRoles: Record<ColorRole, { label: string; targets: PaintTarget[]; editable: boolean }>;
  palettes: Palette[];
  objects: LibraryObject[];
  backgrounds: Background[];
  warnings: { code: string; message: string; objects?: string[] }[];
}
