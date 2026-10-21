import { Injectable, isDevMode, signal } from '@angular/core';
import { getVersion } from '@tauri-apps/api/app';
import { check, Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { inTauri } from './rift.service';

export type UpdateState =
  | { kind: 'idle' }
  | { kind: 'available'; version: string; notes: string }
  | { kind: 'downloading'; version: string; percent: number | null }
  | { kind: 'installing'; version: string }
  | { kind: 'error'; message: string };

const RECHECK_MS = 6 * 60 * 60 * 1000;

/**
 * Checks GitHub Releases for a newer signed build. Nothing installs on its
 * own: the main window shows a banner and you choose when to update, so an
 * update never interrupts a game.
 */
@Injectable({ providedIn: 'root' })
export class UpdateService {
  readonly state = signal<UpdateState>({ kind: 'idle' });
  readonly currentVersion = signal('');
  readonly checking = signal(false);
  readonly lastResult = signal<string>('');

  private pending: Update | null = null;
  private started = false;

  async start(): Promise<void> {
    if (this.started || !inTauri()) return;
    this.started = true;
    // `npm run tauri dev` runs your working copy; installing a release over
    // it would be confusing, so dev builds never update themselves.
    if (isDevMode()) {
      this.lastResult.set('Updates are off while running with npm run tauri dev.');
      return;
    }
    this.currentVersion.set(await getVersion());
    // Wait a little so the check doesn't compete with connecting to League.
    setTimeout(() => this.check(), 5000);
    setInterval(() => this.check(), RECHECK_MS);
  }

  async check(manual = false): Promise<void> {
    if (!inTauri() || isDevMode() || this.checking()) return;
    const busy = this.state().kind;
    if (busy === 'downloading' || busy === 'installing') return;
    this.checking.set(true);
    try {
      const update = await check();
      if (update) {
        this.pending = update;
        this.state.set({ kind: 'available', version: update.version, notes: update.body ?? '' });
        this.lastResult.set(`Version ${update.version} is available.`);
      } else {
        this.lastResult.set(`You're on the latest version (${this.currentVersion()}).`);
      }
    } catch (e) {
      // Automatic checks fail quietly (offline, GitHub hiccup); manual ones say why.
      this.lastResult.set(`Couldn't check for updates: ${e}`);
      if (manual) this.state.set({ kind: 'error', message: String(e) });
    } finally {
      this.checking.set(false);
    }
  }

  async install(): Promise<void> {
    const update = this.pending;
    if (!update) return;
    let total = 0;
    let done = 0;
    this.state.set({ kind: 'downloading', version: update.version, percent: null });
    try {
      await update.downloadAndInstall((event) => {
        if (event.event === 'Started') {
          total = event.data.contentLength ?? 0;
        } else if (event.event === 'Progress') {
          done += event.data.chunkLength;
          const percent = total ? Math.min(100, Math.round((100 * done) / total)) : null;
          this.state.set({ kind: 'downloading', version: update.version, percent });
        } else if (event.event === 'Finished') {
          this.state.set({ kind: 'installing', version: update.version });
        }
      });
      // On Windows the installer closes the app itself; this covers the rest.
      await relaunch();
    } catch (e) {
      this.state.set({ kind: 'error', message: String(e) });
    }
  }

  dismiss(): void {
    this.state.set({ kind: 'idle' });
  }
}
