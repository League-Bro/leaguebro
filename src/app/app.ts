import { Component, OnInit, inject } from '@angular/core';
import { RiftService } from './core/rift.service';
import { Shell } from './components/shell';
import { Overlay } from './components/overlay';

@Component({
  selector: 'app-root',
  imports: [Shell, Overlay],
  template: `
    @if (rift.windowLabel() === 'overlay') {
      <rl-overlay />
    } @else {
      <rl-shell />
    }
  `,
})
export class App implements OnInit {
  protected readonly rift = inject(RiftService);

  async ngOnInit(): Promise<void> {
    await this.rift.start();
    if (this.rift.windowLabel() === 'overlay') {
      document.documentElement.classList.add('overlay-window');
      document.body.classList.add('overlay-window');
    }
  }
}
