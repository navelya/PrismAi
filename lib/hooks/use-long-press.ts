import { useCallback, useRef, useState } from 'react';

interface Options {
    shouldPreventDefault?: boolean;
    delay?: number;
    /** Movement (px) past which a touch is treated as a scroll/drag and the long-press is cancelled. */
    moveThreshold?: number;
}

export const useLongPress = (
    onLongPress: (e: React.TouchEvent | React.MouseEvent) => void,
    onClick: (e: React.TouchEvent | React.MouseEvent) => void,
    { shouldPreventDefault = true, delay = 500, moveThreshold = 10 }: Options = {}
) => {
    const [longPressTriggered, setLongPressTriggered] = useState(false);
    const timeout = useRef<NodeJS.Timeout>();
    const target = useRef<EventTarget>();
    const startPos = useRef<{ x: number; y: number } | null>(null);
    // Set once the finger drags past the threshold; suppresses both the
    // long-press and the trailing click so scrolling never selects an item.
    const moved = useRef(false);

    const start = useCallback(
        (event: React.TouchEvent | React.MouseEvent) => {
            moved.current = false;
            const point = 'touches' in event ? event.touches[0] : event;
            startPos.current = point ? { x: point.clientX, y: point.clientY } : null;

            if (shouldPreventDefault && event.target) {
                event.target.addEventListener('touchend', preventDefault, {
                    passive: false,
                });
                target.current = event.target;
            }
            timeout.current = setTimeout(() => {
                onLongPress(event);
                setLongPressTriggered(true);
            }, delay);
        },
        [onLongPress, delay, shouldPreventDefault]
    );

    const move = useCallback(
        (event: React.TouchEvent | React.MouseEvent) => {
            if (moved.current || !startPos.current) return;
            const point = 'touches' in event ? event.touches[0] : event;
            if (!point) return;
            const dx = point.clientX - startPos.current.x;
            const dy = point.clientY - startPos.current.y;
            if (Math.hypot(dx, dy) > moveThreshold) {
                // Treat as a scroll/drag: cancel the pending long-press.
                moved.current = true;
                timeout.current && clearTimeout(timeout.current);
            }
        },
        [moveThreshold]
    );

    const clear = useCallback(
        (event: React.TouchEvent | React.MouseEvent, shouldTriggerClick = true) => {
            timeout.current && clearTimeout(timeout.current);
            shouldTriggerClick && !longPressTriggered && !moved.current && onClick(event);
            setLongPressTriggered(false);
            startPos.current = null;
            if (shouldPreventDefault && target.current) {
                target.current.removeEventListener('touchend', preventDefault);
            }
        },
        [shouldPreventDefault, onClick, longPressTriggered]
    );

    return {
        onMouseDown: (e: React.MouseEvent) => start(e),
        onTouchStart: (e: React.TouchEvent) => start(e),
        onMouseMove: (e: React.MouseEvent) => move(e),
        onTouchMove: (e: React.TouchEvent) => move(e),
        onMouseUp: (e: React.MouseEvent) => clear(e),
        onMouseLeave: (e: React.MouseEvent) => clear(e, false),
        onTouchEnd: (e: React.TouchEvent) => clear(e),
    };
};

const preventDefault = (e: Event) => {
    const touchEvent = e as unknown as TouchEvent;
    if (!touchEvent.touches) return;
    if (touchEvent.touches.length < 2 && e.preventDefault) {
        e.preventDefault();
    }
};
