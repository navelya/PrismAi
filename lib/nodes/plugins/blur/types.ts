/**
 * Blur Node Types
 */
export interface BlurConfig {
    radius: number;           // Blur radius in pixels (0-50)
    edgeMode?: 'clamp' | 'wrap' | 'mirror';  // Edge handling (future)
}
