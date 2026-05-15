'use client';

import Lottie from 'lottie-react';
import animationData from '@/public/assets/Loading_animation.json';

export default function CanvasLoader() {
    return (
        <div className="w-full h-full flex items-center justify-center bg-surface-primary">
            <div className="w-40 h-40">
                <Lottie animationData={animationData} loop autoplay />
            </div>
        </div>
    );
}
