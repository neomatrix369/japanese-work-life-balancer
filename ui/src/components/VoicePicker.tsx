import type { VoiceProviderState } from '../tour/useVoiceProvider';

/**
 * Narration voice dropdown (ElevenLabs / Gemini / Gemini Argon / Browser voice). Providers
 * without a server key stay listed but disabled, so it is clear why they cannot be picked.
 */
export function VoicePicker({ state, id, compact = false }: { state: VoiceProviderState; id: string; compact?: boolean }) {
  const { provider, providers, setProvider } = state;
  return (
    <span className="voice-field">
      {!compact && <label htmlFor={id}>Voice</label>}
      <select
        id={id}
        className="voice-picker"
        aria-label={compact ? 'Narration voice' : undefined}
        value={provider}
        onChange={(e) => setProvider(e.target.value as VoiceProviderState['provider'])}
        title="Narration voice for the guided tour. First play of a line is slower; replays come from the cache."
      >
        {providers.map((p) => (
          <option key={p.id} value={p.id} disabled={!p.configured && p.id !== provider}>
            {p.label}
            {p.voice && p.id !== 'elevenlabs' ? ` · ${p.voice}` : ''}
            {p.configured ? '' : ' (no key)'}
          </option>
        ))}
      </select>
    </span>
  );
}
