import { ExecutionContext, NodeExecutionResult } from '../../types';
import { TextInputConfig } from './index';

export const textInputExecutor = async (
    config: TextInputConfig,
    input: any,
    context: ExecutionContext
): Promise<NodeExecutionResult> => {
    try {
        return {
            success: true,
            data: { text: config.text || '' },
        };
    } catch (error) {
        return {
            success: false,
            data: null,
            error: error instanceof Error ? error.message : 'Text flow failed',
        };
    }
};
