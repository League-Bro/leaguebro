import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { getVersion } from '@tauri-apps/api/app';
import { RiftService, inTauri } from '../core/rift.service';

type Kind = 'bug' | 'idea';

/** "Where did it happen?" choices for bug reports. */
const AREAS = ['Champ select', 'In game / overlay', 'After the game', 'Profile', 'Champions', 'Somewhere else'];

/** The area a bug most likely came from, by the client's gameflow phase. */
function areaFor(phase: string): string {
  if (phase === 'ChampSelect') return 'Champ select';
  if (phase === 'InProgress' || phase === 'Reconnect') return 'In game / overlay';
  if (phase === 'WaitingForStats' || phase === 'PreEndOfGame' || phase === 'EndOfGame') return 'After the game';
  return '';
}

/**
 * Bug reports and ideas. Sent to the feedback Worker (feedback.rs), which
 * posts each as a GitHub issue (contact info kept private), so players need
 * no account.
 */
@Component({
  selector: 'rl-feedback',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="wrap stack">
      <section class="card stack">
        @if (sent()) {
          <div class="done stack">
            <h2>Thanks, it's on its way!</h2>
            <p class="dim">
              The League Bro team will read your {{ sent() === 'bug' ? 'report' : 'idea' }}.
              @if (contact().trim()) { If we have questions, we'll get in touch. }
            </p>
            <div><button (click)="reset()">Send something else</button></div>
          </div>
        } @else {
          <div>
            <h2>Tell us what's up</h2>
            <p class="dim small">Goes straight to the League Bro team. No account needed.</p>
          </div>

          <div class="kinds">
            <button class="kind" [class.on]="kind() === 'bug'" (click)="kind.set('bug')">
              <b>Something's not working</b>
              <span>A feature broke, showed the wrong thing or didn't show up.</span>
            </button>
            <button class="kind" [class.on]="kind() === 'idea'" (click)="kind.set('idea')">
              <b>I have an idea</b>
              <span>Something you wish League Bro did, or did better.</span>
            </button>
          </div>

          @if (kind() === 'bug') {
            <div class="field">
              <span>Where did it happen?</span>
              <div class="chips">
                @for (a of areas; track a) {
                  <button class="chip" [class.on]="area() === a" (click)="area.set(area() === a ? '' : a)">{{ a }}</button>
                }
              </div>
            </div>
            <label class="field">
              <span>What went wrong?</span>
              <textarea rows="4" placeholder="Example: I locked in Ahri mid, but my runes didn't change."
                [value]="summary()" (input)="summary.set($any($event.target).value)"></textarea>
            </label>
            <label class="field">
              <span>What were you doing right before? <em class="faint">(optional)</em></span>
              <textarea rows="2" placeholder="Example: Ranked solo queue. I picked at the very end of the timer."
                [value]="details()" (input)="details.set($any($event.target).value)"></textarea>
            </label>
          } @else {
            <label class="field">
              <span>What's your idea?</span>
              <textarea rows="4" placeholder="Example: Let me choose my role in blind pick so I get the right runes."
                [value]="summary()" (input)="summary.set($any($event.target).value)"></textarea>
            </label>
            <label class="field">
              <span>How would it help you? <em class="faint">(optional)</em></span>
              <textarea rows="2" [value]="details()" (input)="details.set($any($event.target).value)"></textarea>
            </label>
          }

          <label class="field">
            <span>Want a reply? <em class="faint">(optional, only the team sees this)</em></span>
            <input type="text" maxlength="200" placeholder="Your Discord name or email"
              [value]="contact()" (input)="contact.set($any($event.target).value)" />
          </label>

          <label class="toggle">
            <input type="checkbox" [checked]="includeInfo()" (change)="includeInfo.set($any($event.target).checked)" />
            <span class="track"></span>
            <span class="label"><b>Include app details</b><span>{{ info() }}. Helps us find the problem. No account names.</span></span>
          </label>

          <div class="row">
            <button class="primary" [disabled]="!ready() || sending()" (click)="submit()">
              {{ sending() ? 'Sending…' : kind() === 'bug' ? 'Send report' : 'Send idea' }}
            </button>
            @if (error()) { <span class="loss small">{{ error() }}</span> }
          </div>
          <p class="faint small">What you write (not your contact info) is posted publicly on League Bro's GitHub page so others can see it's known. Please leave out passwords and other private info.</p>
        }
      </section>
    </div>
  `,
  styles: `
    .wrap { max-width: 720px; }
    .card { gap: 14px; }
    h2 { margin: 0; }
    .dim { color: var(--text-dim); }
    .small { font-size: 12.5px; margin: 4px 0 0; }
    .kinds { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    .kind {
      display: flex; flex-direction: column; gap: 4px; text-align: left; padding: 12px 14px;
      background: var(--bg-sunken); border: 1px solid var(--line-strong); border-radius: var(--radius-sm);
    }
    .kind span { color: var(--text-dim); font-size: 12.5px; }
    .kind.on { border-color: var(--accent); background: var(--accent-soft); }
    .field { display: flex; flex-direction: column; gap: 6px; }
    .field > span { color: var(--text-dim); }
    .field em { font-style: normal; font-size: 12.5px; }
    .chips { display: flex; flex-wrap: wrap; gap: 6px; }
    .chip { padding: 4px 12px; border-radius: 99px; font-size: 13px; }
    .chip.on { border-color: var(--accent-2); background: var(--accent-2-soft); color: var(--accent-2); font-weight: 600; }
    textarea {
      font: inherit; color: var(--text); resize: vertical; user-select: text;
      background: var(--bg-sunken); border: 1px solid var(--line-strong);
      border-radius: var(--radius-sm); padding: 8px 12px;
    }
    textarea:focus { outline: 3px solid var(--accent-soft); border-color: var(--accent); }
    .done { padding: 12px 0; }
    .done p { margin: 0; }
    @media (max-width: 560px) { .kinds { grid-template-columns: 1fr; } }
  `,
})
export class FeedbackView implements OnInit {
  protected readonly rift = inject(RiftService);
  protected readonly areas = AREAS;
  protected readonly kind = signal<Kind>('bug');
  protected readonly area = signal(areaFor(this.rift.status().phase));
  protected readonly summary = signal('');
  protected readonly details = signal('');
  protected readonly contact = signal('');
  protected readonly includeInfo = signal(true);
  protected readonly sending = signal(false);
  /** What was just sent, for the thank-you message. */
  protected readonly sent = signal<Kind | null>(null);
  protected readonly error = signal('');
  private readonly version = signal('demo');

  async ngOnInit(): Promise<void> {
    if (inTauri()) this.version.set(await getVersion().catch(() => 'unknown'));
  }

  private readonly clientState = computed(() => {
    const s = this.rift.status();
    return s.connected ? `League client: ${s.phase || 'connected'}` : 'League client not found';
  });

  protected readonly info = computed(() => `League Bro ${this.version()} · Windows or Mac version · ${this.clientState()}`);

  protected readonly ready = computed(() => this.summary().trim() !== '');

  protected async submit(): Promise<void> {
    this.error.set('');
    this.sending.set(true);
    const kind = this.kind();
    try {
      await this.rift.sendFeedback({
        kind,
        area: kind === 'bug' ? this.area() : '',
        summary: this.summary().trim(),
        details: this.details().trim(),
        contact: this.contact().trim(),
        client: this.clientState(),
        includeDetails: this.includeInfo(),
      });
      this.sent.set(kind);
    } catch (e) {
      this.error.set(`Couldn't send it: ${e}`);
    } finally {
      this.sending.set(false);
    }
  }

  protected reset(): void {
    this.summary.set('');
    this.details.set('');
    this.area.set(areaFor(this.rift.status().phase));
    this.sent.set(null);
  }
}
