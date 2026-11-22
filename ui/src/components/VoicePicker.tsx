import type { VoiceProviderState } from '../tour/useVoiceProvider';
import { optionKey, type ProviderOption, type ServedBy, type VoiceProvider } from '../tour/voice';

const ENGINE_NAME: Record<ServedBy, string> = { elevenlabs: 'ElevenLabs', gemini: 'Gemini', browser: 'the browser' };

/**
 * "Gemini · Sulafat (warm)"; adds the voice when the server's label does not already name it. ElevenLabs
 * labels already name their voice ("ElevenLabs · Lily (English)") and `voice` is an ID, so it is never added.
 */
function optionLabel(p: ProviderOption): string {
  if (p.id === 'elevenlabs-auto') return `Auto (best available)${p.configured ? '' : ' (no key)'}`;
  const showVoice = p.voice && p.id !== 'elevenlabs' && !p.label.includes(p.voice);
  return `${p.label}${showVoice ? ` · ${p.voice}` : ''}${p.configured ? '' : ' (no key)'}`;
}

/** "Spoken by Gemini" when on Auto, or when another engine covered the choice; null when the choice spoke. */
function servedByNote(provider: VoiceProvider, servedBy: ServedBy | null): string | null {
  if (!servedBy) return null;
  const expected = provider === 'elevenlabs-auto' ? null : provider.startsWith('gemini') ? 'gemini' : provider;
  return expected === servedBy ? null : `Spoken by ${ENGINE_NAME[servedBy]}`;
}

/**
 * Narration voice dropdown (Auto / each ElevenLabs voice / each Gemini voice / Gemini Argon / Browser voice).
 * Options without a server key stay listed but disabled, so it is clear why they cannot be picked. A small
 * note says which engine spoke the latest line whenever that is not simply the choice.
 */
export function VoicePicker({ state, id, compact = false }: { state: VoiceProviderState; id: string; compact?: boolean }) {
  const { provider, selected, providers, select, servedBy } = state;
  const note = servedByNote(provider, servedBy);
  // the tour's status cue already says "browser voice" next to the compact picker
  const showNote = note && !(compact && servedBy === 'browser');
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
      {showNote && <span className="tour-voice-note voice-served-by">{note}</span>}
    </span>
  );
}
