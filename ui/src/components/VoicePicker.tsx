import type { VoiceProviderState } from '../tour/useVoiceProvider';
import { optionKey, type ProviderOption } from '../tour/voice';

/** "Gemini · Sulafat (warm)"; adds the voice when the server's label does not already name it. */
function optionLabel(p: ProviderOption): string {
  const showVoice = p.voice && p.id !== 'elevenlabs' && !p.label.includes(p.voice);
  return `${p.label}${showVoice ? ` · ${p.voice}` : ''}${p.configured ? '' : ' (no key)'}`;
}

/**
 * Narration voice dropdown (ElevenLabs / each Gemini voice / Gemini Argon / Browser voice). Options
 * without a server key stay listed but disabled, so it is clear why they cannot be picked.
 */
export function VoicePicker({ state, id, compact = false }: { state: VoiceProviderState; id: string; compact?: boolean }) {
  const { selected, providers, select } = state;
  return (
    <span className="voice-field">
      {!compact && <label htmlFor={id}>Voice</label>}
      <select
        id={id}
        className="voice-picker"
        aria-label={compact ? 'Narration voice' : undefined}
        value={selected}
        onChange={(e) => select(e.target.value)}
        title="Narration voice for the guided tour. First play of a line is slower; replays come from the cache."
      >
        {providers.map((p) => {
          const key = optionKey(p);
          return (
            <option key={key} value={key} disabled={!p.configured && key !== selected}>
              {optionLabel(p)}
            </option>
          );
        })}
      </select>
    </span>
  );
}
