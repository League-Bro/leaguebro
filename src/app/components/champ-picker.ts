import { Component, inject, input, output, signal } from '@angular/core';
import { RiftService } from '../core/rift.service';

/** Type-to-search champion box (native datalist). */
@Component({
  selector: 'rl-champ-picker',
  template: `
    <input
      type="text"
      [attr.list]="listId"
      [placeholder]="placeholder()"
      [value]="text()"
      (input)="onInput($any($event.target).value)"
      (keydown.enter)="commit()" />
    <datalist [id]="listId">
      @for (c of rift.statics()?.champions ?? []; track c.id) {
        <option [value]="c.name"></option>
      }
    </datalist>
  `,
  styles: `input { width: 220px; }`,
})
export class ChampPicker {
  protected readonly rift = inject(RiftService);
  readonly placeholder = input('Find a champion…');
  readonly picked = output<number>();
  protected readonly text = signal('');
  protected readonly listId = `champs-${Math.random().toString(36).slice(2)}`;

  onInput(v: string): void {
    this.text.set(v);
    // Selecting from the datalist fills the exact name; pick it right away.
    if (this.find(v)) this.commit();
  }

  commit(): void {
    const c = this.find(this.text());
    if (c) {
      this.picked.emit(c.id);
      this.text.set('');
    }
  }

  private find(v: string) {
    const q = v.trim().toLowerCase();
    return (this.rift.statics()?.champions ?? []).find((c) => c.name.toLowerCase() === q || c.alias.toLowerCase() === q);
  }
}
