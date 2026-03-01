import { ExecutionContext, NodeExecutionResult, FilterSortConfig, ImageObject } from '../../types';

export const filterSortExecutor = async (
    config: FilterSortConfig,
    input: any,
    context: ExecutionContext
): Promise<NodeExecutionResult> => {
    try {
        const { criteria = 'resolution', order = 'asc', limit } = config;

        // Normalize input to always be an array of images
        let images: ImageObject[] = [];
        const sourceData = input?.images_in || input?.images || input;

        if (Array.isArray(sourceData)) {
            images = [...sourceData];
        } else if (sourceData?.images && Array.isArray(sourceData.images)) {
            // Handle { images: [...] } format from merge node
            images = [...sourceData.images];
        } else if (sourceData?.url) {
            // Single image object
            images = [sourceData];
        } else {
            throw new Error('Invalid input: expected images array or single image');
        }

        // Sort based on criteria
        images.sort((a, b) => {
            let compareValue = 0;

            switch (criteria) {
                case 'resolution':
                    const aRes = a.resolution.width * a.resolution.height;
                    const bRes = b.resolution.width * b.resolution.height;
                    compareValue = aRes - bRes;
                    break;
                case 'size':
                    compareValue = (a.metadata?.size || 0) - (b.metadata?.size || 0);
                    break;
                case 'format':
                    compareValue = (a.metadata?.format || '').localeCompare(b.metadata?.format || '');
                    break;
            }

            return order === 'asc' ? compareValue : -compareValue;
        });

        // Apply limit if specified
        if (limit && limit > 0) {
            images = images.slice(0, limit);
        }

        return {
            success: true,
            data: images,
        };
    } catch (error) {
        return {
            success: false,
            data: null,
            error: error instanceof Error ? error.message : 'Failed to filter/sort',
        };
    }
};
