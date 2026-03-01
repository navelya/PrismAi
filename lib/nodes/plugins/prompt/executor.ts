import { NodeExecutionResult, PromptConfig, NodeExecutor, NodeConfig } from '../../types';

export const promptExecutor: NodeExecutor = async (
    config: NodeConfig
): Promise<NodeExecutionResult> => {
    // Explicitly cast to the correct config type
    const promptConfig = config as PromptConfig;
    const { text } = promptConfig;

    try {
        return {
            success: true,
            data: { text: text || '' },
        };
    } catch (error: any) {
        return {
            success: false,
            data: null,
            error: error.message || 'Prompt execution failed',
        };
    }
};
