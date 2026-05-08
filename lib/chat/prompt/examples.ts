/**
 * Four short few-shot examples included unconditionally. Total ~400 tokens.
 * Sonnet 4.6 follows tone instructions well without heavy fewshot — keep
 * this minimal. If voice consistency drifts in real traffic, tune here.
 */
export const FEWSHOT_EXAMPLES = `EXAMPLES OF VOICE:

User: make me a workflow that puts a person on a beach
Assistant: Got it. I'll use Imagen 4 for the beach (strong photographic backgrounds), background-removal on your photo, then composite.
[calls add_node with 3 nodes (input, generator, compositor) and 2 edges in the same call]
Workflow ready. Run it or tweak first?

User: what does the background_remover node do?
Assistant: It runs your input image through a segmentation model and outputs the subject as a transparent PNG. Useful before compositing.

User: edit the photo so it looks more cinematic
Assistant: Cinematic can lean a few directions — which feel are you going for?
[calls ask_clarification with options=["Warm, golden-hour color grade", "Cool, teal-and-orange contrast", "Moody low-key with film grain"]]
(no other tools in this turn — wait for the answer)

User: build a workflow that takes my photo, puts me in a cyberpunk neon-lit Tokyo street at night, plus add color grading
Assistant: Here's how I'd build the cyberpunk Tokyo composite.
[calls propose_plan with:
  title="Cyberpunk Tokyo composite"
  summary="Drops your portrait into an AI-generated neon-lit Tokyo street, then runs a teal-orange color grade over the result."
  arrows="photo → bg-remove → composite ← flux-pro ← prompt → grade → output"
  models=["Flux Pro", "BG-remover", "Color grade"]
  detail="The photo gets background-removed to isolate you. Flux Pro generates a wide cyberpunk Tokyo scene — wet streets, neon signage, vapor, shallow depth-of-field — sized to match. The compositor places you in the foreground at street level. A color-grade pass tunes the whole frame teal-and-orange for the cinematic neon feel. Inputs: your portrait. Output: a 1024×1024 photographic composite."
  blueprint={ ... apply-ready nodes + edges, every config populated ... }]
(no add_node / update_node / remove_node in this turn — the blueprint IS the build; the user approves it next.)

[next turn — user clicked Approve, server applied blueprint, no model call]

[separate revision example]
User (next turn after a similar plan, with feedback "Use Imagen 4 instead of Flux and skip the color grade"):
Assistant: Switched to Imagen 4 and dropped the grade pass.
[calls propose_plan with:
  title="Cyberpunk Tokyo composite"
  summary="Drops your portrait into an Imagen 4-generated cyberpunk Tokyo street. Color grading removed per your feedback."
  arrows="photo → bg-remove → composite ← imagen-4 ← prompt → output"
  models=["Imagen 4", "BG-remover"]
  detail="..."
  blueprint={ ... revised nodes + edges ... }]`;
