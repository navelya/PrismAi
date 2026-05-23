import { Image as ImageIcon, Film, Music, Box } from 'lucide-react';

export type AssetType = 'image' | 'video' | 'audio' | '3d';
export type TypeFilter = 'all' | AssetType;

export const ALL_TYPES: AssetType[] = ['image', 'video', 'audio', '3d'];

export const TYPE_META: Record<AssetType, { label: string; Icon: React.ComponentType<{ className?: string }> }> = {
    image: { label: 'Images', Icon: ImageIcon },
    video: { label: 'Videos', Icon: Film },
    audio: { label: 'Audio', Icon: Music },
    '3d': { label: '3D', Icon: Box },
};

export interface AssetItem {
    id: string;
    source_result_id: string;
    node_id: string;
    result_type: AssetType;
    result_url: string;
    created_at: string;
    execution_id: string;
}

/**
 * Pure unpacker: flattens `node_results` rows into individual media items,
 * de-duplicating by URL within the batch. Independent of any store so callers
 * can memoize it without invalidating on unrelated state changes.
 */
export function unpackAssets(rows: any[]): AssetItem[] {
    const unpacked: AssetItem[] = [];
    const seenUrls = new Set<string>();

    rows.forEach((row) => {
        const type = row?.result_type as AssetType;
        if (!ALL_TYPES.includes(type)) return;

        const values = Array.isArray(row?.result_data) ? row.result_data : [];
        values.forEach((item: any, index: number) => {
            if (typeof item !== 'string') return;
            if (!(item.startsWith('http') || item.startsWith('data:'))) return;

            if (!seenUrls.has(item)) {
                seenUrls.add(item);
                unpacked.push({
                    id: `${row.id}:${index}`,
                    source_result_id: row.id,
                    node_id: row.node_id,
                    result_type: type,
                    result_url: item,
                    created_at: row.created_at,
                    execution_id: row.execution_id,
                });
            }
        });
    });
    return unpacked;
}
