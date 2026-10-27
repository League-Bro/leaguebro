import { Injectable, computed, inject, isDevMode, signal } from '@angular/core';
import { getVersion } from '@tauri-apps/api/app';
import { check, Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { RiftService, inTauri } from './rift.service';

export type UpdateState =
  | { kind: 'idle' }
  | { kind: 'available'; version: string; notes: string }
  | { kind: 'downloading'; version: string; percent: number | null }
  | { kind: 'installing'; version: string }
  | { kind: 'error'; message: string };

/** GitHub can't push to installed copies, so a running app looks for a new release this often. */
const POLL_MS = 5 * 60 * 1000;
/** On launch, give the engine a moment to say whether League is in champ select or a game. */
const LAUNCH_SETTLE_MS = 3000;
/** The update splash stays up at least this long, so a fast download doesn't just flash it. */
const SPLASH_MIN_MS = 1800;
/** The startup splash never holds the app back longer than this, even if GitHub is slow. */
const BOOT_MAX_MS = 5000;
/** League phases an install must never interrupt. */
const BUSY_PHASES = new Set(['ChampSelect', 'GameStart', 'InProgress', 'Reconnect']);

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Keeps League Bro up to date from GitHub Releases (latest.json).
 *
 * - When the app starts and a newer build is out, it installs right away behind
 *   the update splash and restarts.
 * - While it runs, it checks every few minutes and pops up a prompt when a new
 *   release lands.
 * Neither happens during champ select or a game: the prompt waits until the
 * game ends, and a launch during a game asks instead of installing.
 */
@Injectable({ providedIn: 'root' })
export class UpdateService {
  private readonly rift = inject(RiftService);

  readonly state = signal<UpdateState>({ kind: 'idle' });
  /** The running app's version, also in dev builds. Shown in the header. */
  readonly version = signal('');
  /** Same, but only for release builds, which are the ones that can update. */
  readonly currentVersion = signal('');
  readonly checking = signal(false);
  readonly lastResult = signal<string>('');

  /** League is in champ select or a game, so updates wait. */
  readonly leagueBusy = computed(
    () =>
      BUSY_PHASES.has(this.rift.status().phase) ||
      !!this.rift.champSelect() ||
      !!this.rift.loading() ||
      !!this.rift.overlay(),
  );
  /** "A new version is out" popup; held back during champ select and games. */
  private readonly promptOpen = signal(false);
  readonly showPrompt = computed(() => this.promptOpen() && this.state().kind === 'available' && !this.leagueBusy());
  /** The startup splash, shown on launch while the update check runs. */
  readonly booting = signal(false);
  /** The full-window splash: on launch, and while an update downloads and installs. */
  readonly showSplash = computed(() => this.booting() || ['downloading', 'installing'].includes(this.state().kind));

  private pending: Update | null = null;
  /** The newest version the user has been told about, so each one pops up once. */
  private announced = '';
  private launching = false;
  private started = false;

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    if (!inTauri()) {
      this.demoPreview();
      return;
    }
    this.booting.set(true);
    // Read from the built app (tauri.conf.json), so a version bump shows up on its own.
    this.version.set(await getVersion());
    // `npm run tauri dev` runs your working copy; installing a release over
    // it would be confusing, so dev builds never update themselves.
    if (isDevMode()) {
      this.lastResult.set('Updates are off while running with npm run tauri dev.');
      sleep(SPLASH_MIN_MS).then(() => this.booting.set(false));
      return;
    }
    this.currentVersion.set(this.version());
    this.launchUpdate();
    setInterval(() => this.check(), POLL_MS);
  }

  /**
   * On launch, behind the startup splash: install a newer build straight away,
   * unless League is mid-game; otherwise the splash fades into the app.
   */
  private async launchUpdate(): Promise<void> {
    this.launching = true;
    const minShown = sleep(SPLASH_MIN_MS);
    const settled = sleep(LAUNCH_SETTLE_MS);
    await Promise.race([this.check(), sleep(BOOT_MAX_MS)]);
    await minShown;
    if (this.state().kind === 'available') await settled;
    this.launching = false;
    if (this.state().kind === 'available' && !this.leagueBusy()) {
      // install() switches the splash over to download progress.
      this.install();
    } else if (this.state().kind === 'available') {
      this.promptOpen.set(true);
    }
    this.booting.set(false);
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
        if (update.version !== this.announced) {
          this.announced = update.version;
          if (!this.launching) this.promptOpen.set(true);
        }
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
    this.promptOpen.set(false);
    const minShown = sleep(SPLASH_MIN_MS);
    let total = 0;
    let done = 0;
    this.state.set({ kind: 'downloading', version: update.version, percent: null });
    try {
      await update.download((event) => {
        if (event.event === 'Started') {
          total = event.data.contentLength ?? 0;
        } else if (event.event === 'Progress') {
          done += event.data.chunkLength;
          const percent = total ? Math.min(100, Math.round((100 * done) / total)) : null;
          this.state.set({ kind: 'downloading', version: update.version, percent });
        }
      });
      await minShown;
      this.state.set({ kind: 'installing', version: update.version });
      // On Windows the installer closes the app and opens the new one itself; this covers the rest.
      await update.install();
      await relaunch();
    } catch (e) {
      this.state.set({ kind: 'error', message: String(e) });
    }
  }

  /** "Later": close the popup; the banner stays so you can still update from it. */
  later(): void {
    this.promptOpen.set(false);
  }

  dismiss(): void {
    this.promptOpen.set(false);
    this.state.set({ kind: 'idle' });
  }

  /** Browser preview: `?update=boot` the startup splash, `?update=prompt` the popup, `?update=splash` the update splash. */
  private demoPreview(): void {
    const mode = new URLSearchParams(location.search).get('update');
    const version = '0.1.22';
    if (mode === 'boot') {
      this.booting.set(true);
      sleep(2500).then(() => this.booting.set(false));
    } else if (mode === 'prompt') {
      this.state.set({ kind: 'available', version, notes: '' });
      this.promptOpen.set(true);
    } else if (mode === 'splash') {
      let percent = 0;
      const timer = setInterval(() => {
        percent = Math.min(100, percent + 3);
        this.state.set(percent < 100 ? { kind: 'downloading', version, percent } : { kind: 'installing', version });
        if (percent >= 100) clearInterval(timer);
      }, 120);
    }
  }
}
