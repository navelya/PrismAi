import { NodeExecutionResult, ExecutionContext, PromptConfig } from '../../types';

/**
 * Prompt server executor.
 *
 * Behavior preserved from the previous lib/workflow/handlers.ts handlePrompt —
 * checks four config-key locations because historically the prompt text has
 * lived under any of these keys.
 */
export const promptExecutor = async (
    config: PromptConfig & { prompt?: string; config?: { text?: string; prompt?: string } },
    _inputs: Record<string, any>,
    _context: ExecutionContext,
): Promise<NodeExecutionResult> => {
    const text =
        (config as any)?.prompt ||
        (config as any)?.text ||
        (config as any)?.config?.text ||
        (config as any)?.config?.prompt ||
        '';

    return { success: true, data: [String(text)] };
};
