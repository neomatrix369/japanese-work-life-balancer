import type { TourVoice } from '../tour/useTourVoice';

/** 🔊/🔇 narration toggle for the tour controls, plus a quiet "browser voice" note. */
export function VoiceToggle({ voice }: { voice: TourVoice }) {
  return (
    <>
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
      {voice.browserVoice && (
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
