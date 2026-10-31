/**
 * The narrator's voice provider as React state: which provider is in use, which ones the
 * server offers, and a setter. One narrator owns the choice, so every picker (top bar,
 * tour controls) shows the same value.
 */
import { useCallback, useSyncExternalStore } from 'react';
import type { Narrator, ProviderOption, VoiceProvider } from './voice';

export interface VoiceProviderState {
  provider: VoiceProvider;
  providers: ProviderOption[];
  setProvider: (p: VoiceProvider) => void;
}

export function useVoiceProvider(narrator: Narrator): VoiceProviderState {
  const subscribe = useCallback((fn: () => void) => narrator.subscribe(fn), [narrator]);
  const provider = useSyncExternalStore(subscribe, narrator.provider);
  const providers = useSyncExternalStore(subscribe, narrator.providers);
  const setProvider = useCallback((p: VoiceProvider) => narrator.setProvider(p), [narrator]);
  return { provider, providers, setProvider };
}
