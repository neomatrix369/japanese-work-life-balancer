import type { TourVoice } from '../tour/useTourVoice';
import { optionKey, type VoiceProvider } from '../tour/voice';
import { VoicePicker } from './VoicePicker';

const SERVICE: Record<VoiceProvider, string> = {
  elevenlabs: 'ElevenLabs',
  gemini: 'Gemini',
  'gemini-argon': 'Gemini',
  'gemini-ja': 'Gemini',
  browser: 'Browser',
};

/**
 * What the voice is doing, so a silent gap never looks like a stall: dots while the line is
 * being prepared, a small sound wave and the voice's name while it talks, and a note while a
 * rate-limited service is covered by the browser voice. The text is announced politely; the
 * dots and bars are decoration.
 */
export function VoiceStatusCue({ voice }: { voice: TourVoice }) {
  const { provider, selected, providers } = voice.voiceProvider;
  if (voice.muted) return null;

  let cue: 'dots' | 'wave' | null = null;
  let text = '';
  if (voice.limitedForSec > 0 && provider !== 'browser') {
    text = `${SERVICE[provider]} busy · browser voice for ${voice.limitedForSec} s`;
  } else if (voice.status === 'preparing') {
    cue = 'dots';
    text = 'Preparing voice…';
  } else if (voice.status === 'speaking' && !voice.browserVoice) {
    cue = 'wave';
    text = providers.find((p) => optionKey(p) === selected)?.label ?? SERVICE[provider];
  } else if (voice.browserVoice && provider !== 'browser') {
    text = 'browser voice';
  }

  return (
    <span
      className={`voice-cue tour-voice-note${cue === 'dots' ? ' is-preparing' : cue === 'wave' ? ' is-speaking' : ''}`}
      data-testid="voice-cue"
      title={text === 'browser voice' ? 'The premium voice is not available, so your browser reads the tour' : undefined}
    >
      {cue === 'dots' && (
        <span className="voice-cue-dots" aria-hidden="true"><i /><i /><i /></span>
      )}
      {cue === 'wave' && (
        <span className="voice-cue-wave" aria-hidden="true"><i /><i /><i /><i /><i /></span>
      )}
      <span className="voice-cue-text" aria-live="polite">{text}</span>
    </span>
  );
}

/** 🔊/🔇 narration toggle and voice picker for the tour controls, plus what the voice is doing. */
export function VoiceToggle({ voice }: { voice: TourVoice }) {
  return (
    <>
      <VoicePicker state={voice.voiceProvider} id="tour-voice-provider" compact />
      <button
        className="btn tour-voice"
        onClick={voice.toggleMute}
        aria-pressed={voice.muted}
        aria-label={voice.muted ? 'Unmute narration' : 'Mute narration'}
        aria-keyshortcuts="M"
        title={voice.muted ? 'Unmute narration (M)' : 'Mute narration (M)'}
      >
        {voice.muted ? '🔇' : '🔊'}
      </button>
      <VoiceStatusCue voice={voice} />
      {!voice.muted && voice.status === 'idle' && voice.voiceId && !voice.browserVoice && voice.voiceProvider.provider === 'elevenlabs' && (
        <span
          className="tour-voice-note tour-voice-id"
          title={`Click to copy voice ID: ${voice.voiceId}`}
          onClick={() => navigator.clipboard?.writeText(voice.voiceId!)}
        >
          {voice.voiceId}
        </span>
      )}
    </>
  );
}
