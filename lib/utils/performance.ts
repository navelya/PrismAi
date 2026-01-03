/**
 * Throttle function - limits execution to once per delay period
 */
export function throttle<T extends (...args: any[]) => any>(
    func: T,
    delay: number
): (...args: Parameters<T>) => void {
    let timeoutId: NodeJS.Timeout | null = null;
    let lastRan: number = 0;

    return function (this: any, ...args: Parameters<T>) {
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
export function debounce<T extends (...args: any[]) => any>(
    func: T,
    delay: number
): (...args: Parameters<T>) => void {
    let timeoutId: NodeJS.Timeout | null = null;

    return function (this: any, ...args: Parameters<T>) {
        if (timeoutId) {
            clearTimeout(timeoutId);
        }

        timeoutId = setTimeout(() => {
            func.apply(this, args);
        }, delay);
    };
}
