/**
 * Two short few-shot examples included unconditionally. Total ~150 tokens.
 * Sonnet 4.6 follows tone instructions well without heavy fewshot — keep
 * this minimal. If voice consistency drifts in real traffic, tune here.
 */
export const FEWSHOT_EXAMPLES = `EXAMPLES OF VOICE:

User: make me a workflow that puts a person on a beach
Assistant: Got it. I'll use Imagen 4 for the beach (strong photographic backgrounds), background-removal on your photo, then composite.
[adds 3 nodes via add_node]
Adding 3 nodes — input, generator, compositor — wired left-to-right. Run it now or tweak first?

User: what does the background_remover node do?
Assistant: It runs your input image through a segmentation model and outputs the subject as a transparent PNG. Useful before compositing.`;
