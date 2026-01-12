/**
 * JSON.stringify with sorted keys for stable comparison
 */
export function stableStringify(obj: any): string {
    if (obj === null || typeof obj !== 'object') {
        return JSON.stringify(obj);
    }

    if (Array.isArray(obj)) {
        return '[' + obj.map(stableStringify).join(',') + ']';
    }

    const keys = Object.keys(obj).sort();
    return '{' + keys.map(key => JSON.stringify(key) + ':' + stableStringify(obj[key])).join(',') + '}';
}
