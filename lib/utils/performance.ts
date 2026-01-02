/**
 * Throttle function - limits execution to once per delay period
 */
export function throttle\u003cT extends (...args: any[]) => any\u003e(
    func: T,
    delay: number
): (...args: Parameters\u003cT\u003e) => void {
    let timeoutId: NodeJS.Timeout | null = null;
    let lastRan: number = 0;

    return function (this: any, ...args: Parameters\u003cT\u003e) {
        const now = Date.now();

        if (!lastRan) {
            func.apply(this, args);
            lastRan = now;
        } else {
            if (timeoutId) {
                clearTimeout(timeoutId);
            }

            timeoutId = setTimeout(() => {
                if (now - lastRan >= delay) {
                    func.apply(this, args);
                    lastRan = now;
                }
            }, delay - (now - lastRan));
        }
    };
}

/**
 * Debounce function - delays execution until after delay period of inactivity
 */
export function debounce\u003cT extends (...args: any[]) => any\u003e(
    func: T,
    delay: number
): (...args: Parameters\u003cT\u003e) => void {
    let timeoutId: NodeJS.Timeout | null = null;

    return function (this: any, ...args: Parameters\u003cT\u003e) {
        if (timeoutId) {
            clearTimeout(timeoutId);
        }

        timeoutId = setTimeout(() => {
            func.apply(this, args);
        }, delay);
    };
}
