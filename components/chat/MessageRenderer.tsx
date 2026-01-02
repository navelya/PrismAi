'use client';

import React from 'react';
import { ImageObject } from '@/lib/nodes/types';
import { FileText, ImageIcon } from 'lucide-react';
import { ImageModal } from '@/components/ui/ImageModal';

interface MessageRendererProps {
    data: any;
}

export default function MessageRenderer({ data }: MessageRendererProps) {
    // Detect array of images
    if (Array.isArray(data) && data.length > 0 && data[0].url) {
        return <ImageGallery images={data} />;
    }

    // Detect array of objects (table data)
    if (Array.isArray(data) && data.length > 0 && typeof data[0] === 'object') {
        return <DataTable data={data} />;
    }

    // Text or JSON
    if (typeof data === 'string') {
        return <TextRenderer text={data} />;
    }

    // Fallback: JSON display
    return (
        <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
            <pre className="text-sm text-gray-700 overflow-x-auto">
                {JSON.stringify(data, null, 2)}
            </pre>
        </div>
    );
}

const ImageGallery = React.memo(function ImageGallery({ images }: { images: ImageObject[] }) {
    const [selectedImage, setSelectedImage] = React.useState<{ url: string; index: number } | null>(null);

    return (
        <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm text-gray-600">
                <ImageIcon className="w-4 h-4" />
                <span>{images.length} images</span>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                {images.map((img, idx) => (
                    <div
                        key={idx}
                        className="group relative rounded-lg overflow-hidden shadow-md hover:shadow-xl transition-all duration-300 hover:scale-105 cursor-pointer"
                        onClick={() => setSelectedImage({ url: img.url, index: idx })}
                    >
                        <img
                            src={img.url}
                            alt={img.metadata?.title || `Image ${idx + 1}`}
                            className="w-full h-48 object-cover"
                            loading="lazy"
                            decoding="async"
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity">
                            <div className="absolute bottom-0 left-0 right-0 p-3 text-white">
                                <div className="text-xs font-medium truncate">
                                    {img.metadata?.title || 'Image'}
                                </div>
                                <div className="text-xs text-gray-300">
                                    {img.resolution.width} x {img.resolution.height}
                                </div>
                                <div className="text-xs text-purple-300 mt-1">
                                    Click to view full size
                                </div>
                            </div>
                        </div>
                    </div>
                ))}
            </div>

            {/* Image Modal */}
            {selectedImage && (
                <ImageModal
                    imageUrl={selectedImage.url}
                    isOpen={true}
                    onClose={() => setSelectedImage(null)}
                    imageIndex={selectedImage.index}
                    totalImages={images.length}
                />
            )}
        </div>
    );
});

function DataTable({ data }: { data: any[] }) {
    if (data.length === 0) return null;

    const keys = Object.keys(data[0]);

    return (
        <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm text-gray-600">
                <FileText className="w-4 h-4" />
                <span>{data.length} rows</span>
            </div>

            <div className="overflow-x-auto rounded-lg border border-gray-200">
                <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                        <tr>
                            {keys.map((key) => (
                                <th
                                    key={key}
                                    className="px-4 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider"
                                >
                                    {key}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                        {data.map((row, idx) => (
                            <tr key={idx} className="hover:bg-gray-50">
                                {keys.map((key) => (
                                    <td key={key} className="px-4 py-3 text-sm text-gray-900">
                                        {typeof row[key] === 'object'
                                            ? JSON.stringify(row[key])
                                            : String(row[key])}
                                    </td>
                                ))}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

function TextRenderer({ text }: { text: string }) {
    return (
        <div className="prose prose-sm max-w-none">
            <p className="text-gray-700 whitespace-pre-wrap">{text}</p>
        </div>
    );
}
