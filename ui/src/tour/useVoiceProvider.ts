/**
 * The narrator's voice choice as React state: which option is in use (provider + voice), which ones the
 * server offers, and setters. One narrator owns the choice, so every picker (top bar, tour controls)
 * shows the same value.
 */
import { useCallback, useSyncExternalStore } from 'react';
import type { Narrator, ProviderOption, VoiceProvider } from './voice';

export interface VoiceProviderState {
  provider: VoiceProvider;
  /** picker value in use (see optionKey in voice.ts) */
  selected: string;
  providers: ProviderOption[];
  setProvider: (p: VoiceProvider) => void;
  select: (key: string) => void;
}

export function useVoiceProvider(narrator: Narrator): VoiceProviderState {
  const subscribe = useCallback((fn: () => void) => narrator.subscribe(fn), [narrator]);
  const provider = useSyncExternalStore(subscribe, narrator.provider);
  const selected = useSyncExternalStore(subscribe, narrator.selected);
  const providers = useSyncExternalStore(subscribe, narrator.providers);
  const setProvider = useCallback((p: VoiceProvider) => narrator.setProvider(p), [narrator]);
  const select = useCallback((key: string) => narrator.select(key), [narrator]);
  return { provider, selected, providers, setProvider, select };
}
