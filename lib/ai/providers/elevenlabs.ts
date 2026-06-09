import { ProviderAdapter, ProviderAdapterArgs } from './types';
import { generateSpeech, ElevenLabsVoiceSettings } from '@/lib/ai/elevenlabs-client';
import { createServiceClient } from '@/lib/supabase/service';
import { uploadResultBuffer } from '@/lib/workflow/media-mirror';

/** Build voice_settings from the resolved control inputs, omitting undefined. */
function pickVoiceSettings(inputs: Record<string, any>): ElevenLabsVoiceSettings | undefined {
  const settings: ElevenLabsVoiceSettings = {};
  if (typeof inputs.stability === 'number') settings.stability = inputs.stability;
  if (typeof inputs.similarity_boost === 'number') settings.similarity_boost = inputs.similarity_boost;
  if (typeof inputs.style === 'number') settings.style = inputs.style;
  if (typeof inputs.use_speaker_boost === 'boolean') settings.use_speaker_boost = inputs.use_speaker_boost;
  return Object.keys(settings).length > 0 ? settings : undefined;
}

export const elevenlabsAdapter: ProviderAdapter = {
  key: 'elevenlabs',
  mode: 'sync',
  async execute({ model, inputs, iterationIndex, ctx }: ProviderAdapterArgs) {
    const voiceId = inputs['voice_id'];
    const text = inputs['text'];
    if (!voiceId) throw new Error('ElevenLabs: no voice selected (voice_id is empty)');
    if (!text || typeof text !== 'string' || !text.trim()) {
      throw new Error('ElevenLabs: text is required');
    }
    if (!ctx.nodeId) throw new Error('ElevenLabs adapter: missing nodeId in context');

    const modelId = model.provider_model_id || 'eleven_multilingual_v2';
    const outputFormat = typeof inputs['output_format'] === 'string' ? inputs['output_format'] : 'mp3_44100_128';
    const voiceSettings = pickVoiceSettings(inputs);

    const { buffer, ext } = await generateSpeech({ voiceId, text, modelId, voiceSettings, outputFormat });

    // Resolve the owning user + session for the permanent storage path.
    const supabase = createServiceClient();
    const { data: execCtx, error: execErr } = await supabase
      .from('executions')
      .select('session_id, sessions(user_id)')
      .eq('id', ctx.executionId)
      .single();
    const resolvedUserId = (execCtx?.sessions as any)?.user_id as string | undefined;
    if (!resolvedUserId) {
      // Should never happen for a valid in-flight execution. Warn loudly: the
      // file would land under `results/unknown_user/...`, which is unreachable
      // for retrieval/cleanup, rather than silently misfiling it.
      console.warn(
        `[elevenlabs] Could not resolve user for execution ${ctx.executionId} (${execErr?.message || 'no row'}); uploading under 'unknown_user'.`
      );
    }
    const userId = resolvedUserId || 'unknown_user';
    const sessionId = ctx.sessionId || execCtx?.session_id || 'unknown_session';

    const url = await uploadResultBuffer(supabase, buffer, 'audio', ext, userId, sessionId, ctx.nodeId, iterationIndex);

    // Return a hosted { url } with .mp3 extension. The dispatcher infers 'audio'
    // from the extension (detectMediaTypeFromUrl) and completes the node.
    return { success: true, status: 'success', data: { url } };
  },
};
