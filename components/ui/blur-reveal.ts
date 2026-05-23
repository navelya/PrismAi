/**
 * Shared Framer Motion config for the "blur-up" reveal used by BlurryImage and
 * BlurryVideo: media starts blurred + slightly scaled-up and dimmed, then fades
 * to sharp once it has decoded (image `onLoad` / video `onLoadedData`). This
 * replaces the browser's default top-to-bottom raster reveal with a smooth
 * blur → sharp transition.
 */
export function blurRevealMotion(isLoaded: boolean, blurAmount: string, transitionDuration: number) {
    return {
        initial: { filter: `blur(${blurAmount})`, opacity: 0.3 },
        animate: {
            filter: isLoaded ? 'blur(0px)' : `blur(${blurAmount})`,
            opacity: isLoaded ? 1 : 0.5,
            scale: isLoaded ? 1 : 1.05,
        },
        transition: {
            duration: transitionDuration,
            ease: [0.4, 0, 0.2, 1] as const,
        },
    };
}
