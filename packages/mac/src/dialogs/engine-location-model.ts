/**
 * Settings › Advanced › Engine, on Windows: where Beluga's engine runs, this PC or a WSL distro
 * (like VS Code's Remote-WSL). The app shell keeps the choice and starts the engine there
 * (packages/mac/src-tauri/src/engine.rs); this is what the pane shows of it.
 */

export type EnginePlace = 'windows' | 'wsl';

/** What the shell's `engine_location` says. */
export interface EngineStatus {
  readonly place: EnginePlace;
  readonly distro: string | null;
  /** Only Windows has WSL; elsewhere the pane leaves the group out. */
  readonly available: boolean;
  /** How the app reached the WSL engine ("mirrored networking", say), once it has. */
  readonly route: string | null;
}

export const ON_WINDOWS = 'windows';
const WSL_PREFIX = 'wsl:';

/** The Select's value for a status: `windows`, or `wsl:<distro>`. */
export const valueOf = (st: Pick<EngineStatus, 'place' | 'distro'>): string => (st.place === 'wsl' && st.distro ? `${WSL_PREFIX}${st.distro}` : ON_WINDOWS);

/** What a Select value asks the shell for. */
export function choiceOf(value: string): { place: EnginePlace; distro: string | null } {
  return value.startsWith(WSL_PREFIX) ? { place: 'wsl', distro: value.slice(WSL_PREFIX.length) } : { place: 'windows', distro: null };
}

/** This PC first, then each distro; the one chosen before still shows when WSL no longer lists it. */
export function engineOptions(distros: readonly string[], st: Pick<EngineStatus, 'place' | 'distro'>): Array<{ value: string; label: string }> {
  const names = st.place === 'wsl' && st.distro && !distros.includes(st.distro) ? [...distros, st.distro] : distros;
  return [{ value: ON_WINDOWS, label: 'This PC (Windows)' }, ...names.map((d) => ({ value: `${WSL_PREFIX}${d}`, label: `WSL · ${d}` }))];
}

/** The line under the choice. */
export function engineDetail(st: EngineStatus): string {
  if (st.place !== 'wsl' || !st.distro) return 'Beluga’s engine runs here, on Windows. Pick a WSL distro to use the projects, tools and Claude you have in Linux instead.';
  const via = st.route ? `, reached at 127.0.0.1 through ${st.route}` : '';
  return `Beluga’s engine runs in ${st.distro}${via}. Your projects, terminals and Claude are the ones in Linux.`;
}

/** What it says while it moves. */
export const movingText = (value: string): string => {
  const c = choiceOf(value);
  return c.place === 'wsl' ? `Starting Beluga in ${c.distro}…` : 'Going back to the engine on Windows…';
};
