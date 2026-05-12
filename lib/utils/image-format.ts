export type DownloadFormat = 'png' | 'jpeg' | 'webp';

const MIME_BY_FORMAT: Record<DownloadFormat, string> = {
    png: 'image/png',
    jpeg: 'image/jpeg',
    webp: 'image/webp',
};

const QUALITY = 0.92;

/**
 * Fetch an image URL and re-encode it as the requested format using a canvas.
 *
 * - JPEG fills white before drawing (no alpha → otherwise transparent pixels render black).
 * - PNG ignores the `quality` arg.
 * - If decoding fails, throws so the caller can fall back to opening the original URL.
 */
export async function convertImageFormat(
    sourceUrl: string,
    format: DownloadFormat
): Promise<Blob> {
    const response = await fetch(sourceUrl);
    if (!response.ok) throw new Error(`Failed to fetch image: ${response.status}`);
    const sourceBlob = await response.blob();

    let bitmap: ImageBitmap | HTMLImageElement;
    let width: number;
    let height: number;

    if (typeof createImageBitmap === 'function') {
        const bm = await createImageBitmap(sourceBlob);
        bitmap = bm;
        width = bm.width;
        height = bm.height;
    } else {
        const objectUrl = URL.createObjectURL(sourceBlob);
        try {
            const img = await new Promise<HTMLImageElement>((resolve, reject) => {
                const i = new Image();
                i.onload = () => resolve(i);
                i.onerror = (e) => reject(e);
                i.src = objectUrl;
            });
            bitmap = img;
            width = img.width;
            height = img.height;
        } finally {
            URL.revokeObjectURL(objectUrl);
        }
    }

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas context not supported');

    if (format === 'jpeg') {
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, width, height);
    }
    ctx.drawImage(bitmap as CanvasImageSource, 0, 0);

    return await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
            (blob) => {
                if (blob) resolve(blob);
                else reject(new Error('Canvas encode failed'));
            },
            MIME_BY_FORMAT[format],
            format === 'png' ? undefined : QUALITY
        );
    });
}

/** Map a DownloadFormat to its conventional file extension. */
export function extensionForFormat(format: DownloadFormat): string {
    return format === 'jpeg' ? 'jpg' : format;
}

/** Check if a URL already ends with the requested format's extension. */
export function urlMatchesFormat(url: string, format: DownloadFormat): boolean {
    const ext = extensionForFormat(format);
    const lower = url.toLowerCase();
    if (format === 'jpeg') {
        return lower.endsWith('.jpg') || lower.endsWith('.jpeg');
    }
    return lower.endsWith(`.${ext}`);
}
