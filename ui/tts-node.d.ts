/**
 * Minimal Node typings for tts-plugin.ts. The UI has no @types/node (and installing it would
 * touch the shared node_modules), so we declare only the few calls the plugin makes.
 */
declare module 'node:crypto' {
  export function createHash(algorithm: string): {
    update(data: string): { digest(encoding: 'hex'): string };
  };
}

declare module 'node:fs/promises' {
  export function readFile(path: string): Promise<Uint8Array>;
  export function writeFile(path: string, data: Uint8Array): Promise<void>;
  export function mkdir(path: string, options: { recursive: boolean }): Promise<unknown>;
}

declare module 'node:path' {
  export function resolve(...parts: string[]): string;
  export function join(...parts: string[]): string;
}
