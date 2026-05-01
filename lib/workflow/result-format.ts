export const RESULT_TYPES = ['image', 'video', 'audio', '3d', 'text', 'json'] as const;

export type NodeResultType = (typeof RESULT_TYPES)[number];

const RESULT_TYPE_SET = new Set<string>(RESULT_TYPES);
const MEDIA_TYPES = new Set<NodeResultType>(['image', 'video', 'audio', '3d']);

export function normalizeNodeResultType(value: string | null | undefined): NodeResultType {
  const next = (value || '').toLowerCase();
  return RESULT_TYPE_SET.has(next) ? (next as NodeResultType) : 'json';
}

export function isMediaResultType(type: NodeResultType): boolean {
  return MEDIA_TYPES.has(type);
}

export function coerceResultDataArray(value: any): any[] {
  if (value === null || value === undefined) return [];

  if (Array.isArray(value)) {
    return value.filter((item) => item !== undefined);
  }

  if (typeof value === 'object' && value !== null && Array.isArray((value as any).data)) {
    return (value as any).data.filter((item: any) => item !== undefined);
  }

  return [value];
}

export function detectMediaTypeFromUrl(url: string): NodeResultType | null {
  const normalized = url.toLowerCase();
  if (/\.(png|jpe?g|webp|gif|bmp|svg)(\?|$)/i.test(normalized)) return 'image';
  if (/\.(mp4|webm|mov|avi|mkv)(\?|$)/i.test(normalized)) return 'video';
  if (/\.(mp3|wav|ogg|m4a|aac|flac)(\?|$)/i.test(normalized)) return 'audio';
  if (/\.(glb|gltf|obj|fbx|stl|usd|usdz)(\?|$)/i.test(normalized)) return '3d';
  return null;
}

export function extractMediaUrls(value: any): string[] {
  const found = new Set<string>();
  const visit = (node: any) => {
    if (!node) return;

    if (typeof node === 'string') {
      if (node.startsWith('http') || node.startsWith('data:')) {
        found.add(node);
      }
      return;
    }

    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }

    if (typeof node === 'object') {
      if (typeof node.url === 'string') found.add(node.url);
      if (node.data !== undefined) visit(node.data);
      if (node.output !== undefined) visit(node.output);
    }
  };

  visit(value);
  return Array.from(found);
}

export function extractTextValues(value: any): string[] {
  const values: string[] = [];
  const visit = (node: any) => {
    if (node === null || node === undefined) return;
    if (typeof node === 'string') {
      values.push(node);
      return;
    }
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (typeof node === 'object') {
      if (typeof node.text === 'string') {
        values.push(node.text);
        return;
      }
      values.push(JSON.stringify(node));
      return;
    }
    values.push(String(node));
  };

  visit(value);
  return values;
}

export function inferResultTypeFromValue(value: any): NodeResultType {
  const urls = extractMediaUrls(value);
  if (urls.length > 0) {
    const detected = detectMediaTypeFromUrl(urls[0]);
    return detected || 'image';
  }

  if (typeof value === 'string') return 'text';

  if (Array.isArray(value)) {
    if (value.every((item) => typeof item === 'string')) return 'text';
    return 'json';
  }

  if (value && typeof value === 'object') return 'json';
  return 'json';
}

export function toResultDataForType(type: NodeResultType, value: any): any[] {
  if (value === null || value === undefined) return [];

  if (isMediaResultType(type)) {
    return extractMediaUrls(value);
  }

  if (type === 'text') {
    return extractTextValues(value);
  }

  return coerceResultDataArray(value);
}

export function getPrimaryInputValue(type: NodeResultType, data: any): any {
  const values = coerceResultDataArray(data);
  if (values.length === 0) return undefined;

  if (type === 'json') {
    return values.length === 1 ? values[0] : values;
  }

  return values[0];
}

export function toOutputEnvelope(type: NodeResultType, data: any): { type: NodeResultType; data: any[] } {
  return {
    type: normalizeNodeResultType(type),
    data: coerceResultDataArray(data),
  };
}

export function isOutputEnvelope(value: any): value is { type: NodeResultType; data: any[] } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return typeof value.type === 'string' && Array.isArray(value.data);
}

export function toLegacyRenderableOutput(value: any): any {
  if (!isOutputEnvelope(value)) return value;

  const type = normalizeNodeResultType(value.type);
  const data = coerceResultDataArray(value.data);

  if (isMediaResultType(type)) {
    return data.map((item) => (typeof item === 'string' ? { url: item } : item));
  }

  if (type === 'text') {
    return typeof data[0] === 'string' ? data[0] : '';
  }

  return data.length === 1 ? data[0] : data;
}
