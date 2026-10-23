import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { getVersion } from '@tauri-apps/api/app';
import { RiftService, inTauri } from '../core/rift.service';

type Kind = 'bug' | 'feature';

const ISSUES = 'https://github.com/doliaro/leaguebro/issues';
/** GitHub fills an issue form's fields from query params named after the field ids in .github/ISSUE_TEMPLATE. */
const TEMPLATES: Record<Kind, string> = { bug: 'bug_report.yml', feature: 'feature_request.yml' };
/** Keeps the URL well under what browsers and GitHub accept (~8 KB). */
const MAX_FIELD = 2000;

/**
 * Bug reports and feature requests. Fills in a GitHub issue form and opens
 * it in the browser, where the user submits it with their own GitHub account,
 * so the app never holds a GitHub token.
 */
@Component({
  selector: 'rl-feedback',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="wrap stack">
      <section class="card stack">
        <div class="row">
          <h2>Send feedback</h2>
          <div class="spacer"></div>
          <button class="ghost" (click)="openList()">See existing issues</button>
        </div>
        <div class="seg">
          <button [class.on]="kind() === 'bug'" (click)="kind.set('bug')">Bug report</button>
          <button [class.on]="kind() === 'feature'" (click)="kind.set('feature')">Feature request</button>
        </div>

        <label class="field">
          <span>Title</span>
          <input type="text" maxlength="120" [placeholder]="kind() === 'bug' ? 'Runes didn\\'t import for Ahri mid' : 'Let me pick a role for blind pick'"
            [value]="title()" (input)="title.set($any($event.target).value)" />
        </label>

        @if (kind() === 'bug') {
          <label class="field">
            <span>What happened?</span>
            <textarea rows="4" [value]="happened()" (input)="happened.set($any($event.target).value)"></textarea>
          </label>
          <label class="field">
            <span>What did you expect?</span>
            <textarea rows="2" [value]="expected()" (input)="expected.set($any($event.target).value)"></textarea>
          </label>
          <label class="field">
            <span>Steps to reproduce <em class="faint">(optional)</em></span>
            <textarea rows="3" placeholder="1. Queue ranked solo&#10;2. Lock in Ahri mid&#10;3. …" [value]="steps()" (input)="steps.set($any($event.target).value)"></textarea>
          </label>
          <label class="toggle">
            <input type="checkbox" [checked]="includeInfo()" (change)="includeInfo.set($any($event.target).checked)" />
            <span class="track"></span>
            <span class="label"><b>Include app details</b><span>{{ info() }}. No account names.</span></span>
          </label>
        } @else {
          <label class="field">
            <span>What would you like?</span>
            <textarea rows="4" [value]="idea()" (input)="idea.set($any($event.target).value)"></textarea>
          </label>
          <label class="field">
            <span>Why would it help? <em class="faint">(optional)</em></span>
            <textarea rows="3" [value]="why()" (input)="why.set($any($event.target).value)"></textarea>
          </label>
        }

        <div class="row">
          <button class="primary" [disabled]="!ready()" (click)="submit()">Continue on GitHub</button>
          @if (error()) { <span class="loss small">{{ error() }}</span> }
        </div>
        <p class="faint small">
          Opens GitHub in your browser with this filled in. Check it there and press "Create". You need a free GitHub account,
          and the issue is public, so leave out anything private.
        </p>
      </section>
    </div>
  `,
  styles: `
    .wrap { max-width: 720px; }
    .card { gap: 10px; }
    h2 { margin: 0; }
    .field { display: flex; flex-direction: column; gap: 6px; }
    .field > span { color: var(--text-dim); }
    .field em { font-style: normal; font-size: 12.5px; }
    textarea {
      font: inherit; color: var(--text); resize: vertical; user-select: text;
      background: var(--bg-sunken); border: 1px solid var(--line-strong);
      border-radius: var(--radius-sm); padding: 8px 12px;
    }
    textarea:focus { outline: 3px solid var(--accent-soft); border-color: var(--accent); }
    .small { font-size: 12.5px; margin: 0; }
  `,
})
export class FeedbackView implements OnInit {
  protected readonly rift = inject(RiftService);
  protected readonly kind = signal<Kind>('bug');
  protected readonly title = signal('');
  protected readonly happened = signal('');
  protected readonly expected = signal('');
  protected readonly steps = signal('');
  protected readonly idea = signal('');
  protected readonly why = signal('');
  protected readonly includeInfo = signal(true);
  protected readonly error = signal('');
  private readonly version = signal('demo');

  async ngOnInit(): Promise<void> {
    if (inTauri()) this.version.set(await getVersion().catch(() => 'unknown'));
  }

  protected readonly info = computed(() => {
    const s = this.rift.status();
    const client = s.connected ? `League client: ${s.phase || 'connected'}` : 'League client not found';
    return `League Bro ${this.version()} · ${client}`;
  });

  protected readonly ready = computed(() =>
    this.title().trim() !== '' && (this.kind() === 'bug' ? this.happened() : this.idea()).trim() !== '',
  );

  protected async submit(): Promise<void> {
    this.error.set('');
    const kind = this.kind();
    const params = new URLSearchParams({ template: TEMPLATES[kind], title: this.title().trim() });
    const add = (id: string, value: string) => {
      const v = value.trim();
      if (v) params.set(id, v.length > MAX_FIELD ? v.slice(0, MAX_FIELD) + '…' : v);
    };
    if (kind === 'bug') {
      add('what-happened', this.happened());
      add('expected', this.expected());
      add('steps', this.steps());
      if (this.includeInfo()) add('details', this.info());
    } else {
      add('idea', this.idea());
      add('why', this.why());
    }
    try {
      await this.rift.openIssuePage(`${ISSUES}/new?${params}`);
    } catch (e) {
      this.error.set(String(e));
    }
  }

  protected openList(): void {
    this.rift.openIssuePage(ISSUES).catch((e) => this.error.set(String(e)));
  }
}
