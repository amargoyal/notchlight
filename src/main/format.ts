/** Daemon-side formatting. The platform-free parts live in shared/fmt.ts. */
export { duration, ellipsis, tokens } from '../shared/fmt';

/** `~/dev/notchlight` — the home tilde is worth more than eight characters. */
export function tildePath(p: string): string {
  const home = process.env.HOME || '';
  return home && p.startsWith(home) ? '~' + p.slice(home.length) : p;
}
