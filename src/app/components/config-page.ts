import { inject, signal } from '@angular/core';
import { RiftService } from '../core/rift.service';
import { Config } from '../core/models';

/** A page that edits settings (Settings, Overlay): saves each change and shows a failed save's error. */
export abstract class ConfigPage {
  protected readonly rift = inject(RiftService);
  protected readonly error = signal('');

  protected save(fn: (c: Config) => Config): void {
    this.rift.updateConfig(fn).catch((e) => this.error.set(String(e)));
  }

  /** Saves one setting. */
  set<K extends keyof Config>(key: K, v: Config[K]): void {
    this.save((c) => ({ ...c, [key]: v }));
  }
}
