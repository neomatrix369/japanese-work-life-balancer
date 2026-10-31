import type { TourVoice } from '../tour/useTourVoice';
import { VoicePicker } from './VoicePicker';

/** 🔊/🔇 narration toggle and voice picker for the tour controls, plus a quiet "browser voice" note. */
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
      {!voice.muted && voice.voiceId && !voice.browserVoice && (
        <span
          className="tour-voice-note"
          title={`Click to copy voice ID: ${voice.voiceId}`}
          style={{ alignSelf: 'center', fontSize: 10, color: 'var(--fg-muted, #64748b)', fontFamily: 'monospace', cursor: 'pointer' }}
          onClick={() => navigator.clipboard?.writeText(voice.voiceId!)}
        >
          {voice.voiceId}
        </span>
      )}
      {voice.browserVoice && voice.voiceProvider.provider !== 'browser' && (
        <span
          className="tour-voice-note"
          title="The premium voice is not available, so your browser reads the tour"
          style={{ alignSelf: 'center', fontSize: 10, color: 'var(--fg-muted, #64748b)' }}
        >
          browser voice
        </span>
      )}
    </>
  );
}
