/**
 * ElevenLabs API client. Server-only — reads ELEVENLABS_API_KEY from env.
 * Text-to-speech is synchronous: it returns audio bytes directly (no webhook).
 */
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY || '';
const ELEVENLABS_BASE_URL = 'https://api.elevenlabs.io/v1';

if (!process.env.ELEVENLABS_API_KEY) {
  console.warn('[ElevenLabs] Warning: ELEVENLABS_API_KEY is not set in environment.');
}

export interface ElevenLabsVoiceSettings {
  stability?: number;
  similarity_boost?: number;
  style?: number;
  use_speaker_boost?: boolean;
}

export interface GenerateSpeechArgs {
  voiceId: string;
  text: string;
  modelId: string;
  voiceSettings?: ElevenLabsVoiceSettings;
  outputFormat?: string; // e.g. mp3_44100_128
}

export interface GeneratedSpeech {
  buffer: Buffer;
  ext: string;
  contentType: string;
}

function outputFormatToFile(outputFormat: string): { ext: string; contentType: string } {
  // ElevenLabs output_format values look like "mp3_44100_128", "pcm_16000",
  // "ulaw_8000". We only persist mp3 as a browser-playable file here; other
  // formats fall back to a .bin container (still downloadable). mp3 is the
  // default and the only format the preset offers.
  if (outputFormat.startsWith('mp3')) return { ext: 'mp3', contentType: 'audio/mpeg' };
  if (outputFormat.startsWith('wav')) return { ext: 'wav', contentType: 'audio/wav' };
  return { ext: 'mp3', contentType: 'audio/mpeg' };
}

/**
 * Synthesize speech. Returns the audio bytes; the caller uploads them to storage.
 * Throws with the ElevenLabs error body on a non-2xx response.
 */
export async function generateSpeech(args: GenerateSpeechArgs): Promise<GeneratedSpeech> {
  if (!ELEVENLABS_API_KEY) throw new Error('ELEVENLABS_API_KEY is not set');
  if (!args.voiceId) throw new Error('ElevenLabs: voiceId is required');
  if (!args.text || !args.text.trim()) throw new Error('ElevenLabs: text is required');

  const outputFormat = args.outputFormat || 'mp3_44100_128';
  const url = `${ELEVENLABS_BASE_URL}/text-to-speech/${encodeURIComponent(args.voiceId)}?output_format=${encodeURIComponent(outputFormat)}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'xi-api-key': ELEVENLABS_API_KEY,
      'Content-Type': 'application/json',
      Accept: 'audio/mpeg',
    },
    body: JSON.stringify({
      text: args.text,
      model_id: args.modelId,
      ...(args.voiceSettings ? { voice_settings: args.voiceSettings } : {}),
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`ElevenLabs TTS failed (${res.status}): ${errText.slice(0, 300)}`);
  }

  const buffer = Buffer.from(await res.arrayBuffer());
  const { ext, contentType } = outputFormatToFile(outputFormat);
  return { buffer, ext, contentType };
}
