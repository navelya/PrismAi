export type BlendMode =
    | 'source-over' | 'multiply' | 'screen' | 'overlay'
    | 'darken' | 'lighten' | 'color-dodge' | 'color-burn'
    | 'hard-light' | 'soft-light' | 'difference' | 'exclusion';

export interface LayerSourceVideo { kind: 'video'; el: HTMLVideoElement; }
export interface LayerSourceImage { kind: 'image'; el: HTMLImageElement; }
export interface LayerSourceCanvas { kind: 'canvas'; el: HTMLCanvasElement; version: number; }
export type LayerSource = LayerSourceVideo | LayerSourceImage | LayerSourceCanvas;

export interface LayerDescriptor {
    id: string;                        // stable per layer
    source: LayerSource;
    transform: {
        x: number; y: number; width: number; height: number;
        rotation: number;              // degrees
        flipX: boolean; flipY: boolean;
        opacity: number;               // 0..1
        blendMode: BlendMode;
        crop?: { x: number; y: number; width: number; height: number } | null;
    };
    sourceWidth: number;               // intrinsic (videoWidth / naturalWidth / canvas.width)
    sourceHeight: number;
}
