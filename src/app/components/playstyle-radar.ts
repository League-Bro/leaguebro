import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { MatchLine } from '../core/models';
import { readLocal, writeLocal } from '../core/storage';
import { RiftService } from '../core/rift.service';
import { LaneTargets, RANK_TARGETS } from '../core/playstyle-targets';
import { RankPicker, rankName } from './rank-picker';

type Role = 'top' | 'jungle' | 'mid' | 'adc' | 'support' | 'any';
type AxisKey = 'gold' | 'damage' | 'fights' | 'kda' | 'deaths' | 'vision' | 'objectives';

/**
 * Rough per-role targets for an average ranked game (around Gold/Platinum, scaled by `RANK_SCALE`), per minute
 * unless noted. `any` is used when the game's position isn't known.
 */
type Targets = { gold: number; damage: number; kp: number; kda: number; deaths: number; vision: number; objectives: number };

const TARGETS: Record<Role, Targets> = {
  //        gold/min  dmg/min   kill part.  KDA        deaths/min      vision/min    objective dmg/min
  top: { gold: 400, damage: 600, kp: 0.45, kda: 2.6, deaths: 0.18, vision: 0.7, objectives: 220 },
  jungle: { gold: 380, damage: 470, kp: 0.6, kda: 3, deaths: 0.17, vision: 1, objectives: 600 },
  mid: { gold: 420, damage: 720, kp: 0.55, kda: 2.8, deaths: 0.18, vision: 0.75, objectives: 160 },
  adc: { gold: 430, damage: 720, kp: 0.55, kda: 2.8, deaths: 0.17, vision: 0.65, objectives: 230 },
  support: { gold: 270, damage: 320, kp: 0.62, kda: 3.3, deaths: 0.18, vision: 2.1, objectives: 60 },
  any: { gold: 390, damage: 580, kp: 0.55, kda: 2.9, deaths: 0.18, vision: 1, objectives: 250 },
};

/**
 * How the targets move with rank (estimates): gold, damage, vision, objective damage and KDA
 * scale by this, the deaths target shrinks by it, and kill participation stays put.
 */
const RANK_SCALE: Record<string, number> = {
  IRON: 0.85, BRONZE: 0.89, SILVER: 0.94, GOLD: 0.98, PLATINUM: 1.02, EMERALD: 1.05, DIAMOND: 1.08, MASTER: 1.12, GRANDMASTER: 1.14, CHALLENGER: 1.16,
};
/** A "+" filter (Gold+) sits a little above its own rank. */
const PLUS_BUMP = 0.03;
/** Where the chosen rank to compare with is kept ('' = the player's own). */
const RANK_KEY = 'leaguebro.playstyleRank';

const TIER_IDS = ['iron', 'bronze', 'silver', 'gold', 'platinum', 'emerald', 'diamond', 'master', 'grandmaster', 'challenger'];
/** Fewer sampled player-games than this for a rank and lane, and the sample isn't used. */
const MIN_SAMPLE = 30;

/** Riot API averages (scripts/calibrate-playstyle.mjs) for a rank filter ('gold', 'gold_plus', 'all') and role, pooled by games. */
function sampled(rankId: string, role: Role): Targets | null {
  if (!RANK_TARGETS) return null;
  const base = rankId.replace(/_plus$/, '');
  const from = TIER_IDS.indexOf(base);
  const tiers = rankId === 'all' ? TIER_IDS : rankId.endsWith('_plus') && from >= 0 ? TIER_IDS.slice(from) : [base];
  const rows = tiers.map((t) => RANK_TARGETS!.ranks[t]?.[role]).filter((r): r is LaneTargets => !!r);
  const n = rows.reduce((a, r) => a + r.games, 0);
  if (n < MIN_SAMPLE) return null;
  const w = (k: keyof Targets) => rows.reduce((a, r) => a + r[k] * r.games, 0) / n;
  return { gold: w('gold'), damage: w('damage'), kp: w('kp'), kda: w('kda'), deaths: w('deaths'), vision: w('vision'), objectives: w('objectives') };
}

/** The tier list lane for each role, for OP.GG's per-rank KDA. */
const LANES: [Role, string][] = [['top', 'top'], ['jungle', 'jungle'], ['mid', 'middle'], ['adc', 'bottom'], ['support', 'utility']];

/** Queues and modes the targets don't fit (they're for Summoner's Rift). */
const OFF_RIFT_QUEUES = new Set([72, 73, 75, 76, 78, 83, 98, 100, 310, 313, 317, 318, 325, 450, 720, 900, 920, 1010, 1020, 1300, 1400, 1700, 1710, 1900, 2300, 2400]);
const OFF_RIFT_MODE = /ARAM|CHERRY|ARENA|URF|ONEFORALL|NEXUS|ULTBOOK|BRAWL|KIWI|STRAWBERRY|DOOMBOT|SNOWURF|TUTORIAL|PRACTICE/i;

type Lane = Exclude<Role, 'any'>;
/** Per axis: what to work on when under the goal (general, then per role), and the next step once at or above it. */
const AXES: { key: AxisKey; label: string; low: string; byRole: Record<Lane, string>; high: string }[] = [
  {
    key: 'gold', label: 'Gold',
    low: "Farm between fights and catch side waves. CS is most of a game's gold.",
    byRole: {
      top: 'Never miss a cannon minion, take tower plates early, and catch the side wave after every back.',
      jungle: 'Keep a clear path: take camps between ganks instead of waiting in bushes, and never leave a camp up when you pass it.',
      mid: 'Shove your wave before you roam so it doesn\'t crash into your tower, and take side waves mid game.',
      adc: 'Practise last-hitting under tower, where most gold is lost, and farm the side lane whenever nothing is up.',
      support: 'Finish your support item quest early by poking and using its charges, and take kills the carry can\'t.',
    },
    high: 'Turn leads into more: take plates and push your wave before you roam, so no gold is left behind.',
  },
  {
    key: 'damage', label: 'Damage',
    low: 'Trade more in lane and stay in range in fights. Only damage to champions counts.',
    byRole: {
      top: 'Trade when your opponent walks up to last-hit, and in fights hit whoever is in range instead of diving the back line alone.',
      jungle: 'Gank lanes that can follow up, and stay for the fight after the gank instead of going straight back to camps.',
      mid: 'Poke your opponent every time they walk up for a minion, and use your spells in every skirmish near mid.',
      adc: 'Stay at the edge of your range and keep attacking. A carry who is dead or waiting deals no damage.',
      support: 'Poke on cooldown in lane if your champion can, and land your main spell in every fight.',
    },
    high: 'Look for longer trades when your spells are up, and keep hitting the closest target in fights instead of waiting for the perfect one.',
  },
  {
    key: 'fights', label: 'Team fights',
    low: 'Group with your team for skirmishes and objectives. Too many kills are happening without you.',
    byRole: {
      top: 'Save Teleport for dragon and grub fights instead of only using it to get back to lane.',
      jungle: 'Be near the next fight: gank the lanes that are winning and show up for every objective.',
      mid: 'Shove and move to side fights. Mid is the closest lane to both rivers.',
      adc: 'After laning, walk with your support and team instead of farming alone on the far side of the map.',
      support: 'Leave lane after the first tower and roam with your jungler, so you are where the next fight is.',
    },
    high: 'Watch the minimap for fights about to start and get there first, with Teleport or a shove and roam.',
  },
  {
    key: 'kda', label: 'KDA',
    low: "Pick fights you can win and walk away from the ones you can't. A good KDA is mostly not throwing deaths away.",
    byRole: {
      top: "Don't fight their laner and jungler two against one: ward the river around 3 minutes and back off when you can't see them.",
      jungle: "Don't invade without vision or a reason. Take fights next to your laners, where you have help.",
      mid: 'Roaming is risky without vision: ping before you go, and head back once your wave reaches your tower.',
      adc: 'Stand behind your front line and let the enemy commit first. Your damage only counts while you are alive.',
      support: "Engage when your carry can follow up, and don't walk into unwarded bushes for your team.",
    },
    high: 'Keep the discipline: count enemy cooldowns before you commit, and leave once the fight is won.',
  },
  {
    key: 'deaths', label: 'Deaths',
    low: 'Ward before pushing past the river, and back off when your lane opponent goes missing.',
    byRole: {
      top: 'Top is the longest lane: past the middle of it without a ward, one gank is a death.',
      jungle: 'Count the enemies you can see before invading. If three are missing, they are probably waiting for you.',
      mid: "Stay behind your wave when their jungler isn't on the map.",
      adc: 'Use Flash to get away when you are caught. Dying with Flash up is the most common carry death.',
      support: 'Ward with a teammate nearby, and check dangerous bushes with Oracle Lens instead of walking in.',
    },
    high: "Every death you skip is gold and time for your team. Check the minimap every few seconds and don't face-check bushes.",
  },
  {
    key: 'vision', label: 'Vision',
    low: 'Buy a Control Ward every back, use your trinket on cooldown, and swap to Oracle Lens later on.',
    byRole: {
      top: 'Ward the river bush and tri-bush, and keep a Control Ward on your side of the river.',
      jungle: 'Swap to Oracle Lens after your first clears and sweep around every objective before it spawns.',
      mid: 'Ward both sides of the river before you shove. Ganks reach mid from two directions.',
      adc: 'Use your trinket on cooldown, buy a Control Ward each back, and swap to Farsight once laning is over.',
      support: 'Swap to Oracle Lens once your support item upgrades, keep two Control Wards out, and ward a minute ahead of each objective.',
    },
    high: 'Ward where the next objective spawns a minute before it does, and clear enemy wards on the way.',
  },
  {
    key: 'objectives', label: 'Objectives',
    low: 'Hit towers after a won fight and show up for dragons, grubs and Baron. Objectives win games.',
    byRole: {
      top: 'Hit the tower whenever your lane is pushed or your opponent is dead, and split push while your team is grouped elsewhere.',
      jungle: 'Plan around objective timers: be at dragon and grubs as they spawn, and keep Smite for the last hit.',
      mid: 'Take mid tower plates after a won trade, and rotate to dragon with your jungler.',
      adc: 'Towers fall fastest to you: after a won fight, hit the nearest tower before you back.',
      support: 'Supports deal little objective damage. Help by warding the objective and keeping enemies off your team while it falls.',
    },
    high: 'Set up the next objective before the fight starts, and ping it so your team goes with you.',
  },
];

/** How a stat compares with the goal: a long way under, a bit under, on it, or well above it. */
type Level = 'far' | 'under' | 'on' | 'above';
function levelOf(ofGoal: number): Level {
  return ofGoal < 0.8 ? 'far' : ofGoal < 0.95 ? 'under' : ofGoal < 1.1 ? 'on' : 'above';
}
const ROLE_NAME: Record<Lane, string> = { top: 'top laner', jungle: 'jungler', mid: 'mid laner', adc: 'bot laner', support: 'support' };

/** A score tops out at this many times the all-ranks average, so a few stomps don't run off the chart. */
const GAME_CAP = 2;
/**
 * The chart is zoomed in around the all-ranks average on an S-curve: the halfway ring is the average, small
 * differences near it are stretched (ranks only differ by 5 to 15% on most stats, Riot sample, patch 16.4), and
 * far-off values are squeezed toward the middle or edge without pinning there. ZOOM is the stretch: near the
 * average, 10% of a stat moves a point ZOOM / 2 * 10% of the radius (a plain scale from zero to 1.5x moved it 6.7%).
 */
const ZOOM = 3.5;
const MIN_GAMES = 3;

const VIEW_W = 400;
const VIEW_H = 300;
const CX = 200;
const CY = 152;
const R = 120;
/** Labels sit this far out (share of the radius). */
const LABEL_AT = 1.16;

interface Axis {
  key: AxisKey;
  label: string;
  /** What to work on: how far off you are, in numbers, then advice for your main role (or the next step once on target). */
  tip: string;
  /** Far under, a bit under, on, or above the goal: picks the tip's heading. */
  level: Level;
  /** The player's average against the all-ranks baseline for their roles (1 = baseline). Where the pink shape sits. */
  score: number;
  /** The chosen rank's goal against the same baseline. Where the dotted ring sits. */
  goalScore: number;
  /** score / goalScore: 1 = right on the goal. */
  ofGoal: number;
  /** What it was, for the label: "412/min". */
  value: string;
  /** The target in the same units: "450/min". */
  goal: string;
  games: number;
  /** Your best and worst single game, in the card's units ('' with fewer than two games). */
  best: string;
  worst: string;
  /** Games that met the goal on their own. */
  hits: number;
  /** Where the goal comes from: sampled ranked games (Riot API), OP.GG's KDA, or an estimate. */
  source: 'riot' | 'opgg' | 'estimate';
}

function roleOf(m: MatchLine): Role {
  const p = m.position;
  if (p === 'top' || p === 'jungle' || p === 'mid' || p === 'adc' || p === 'support') return p;
  return m.spells.includes(11) ? 'jungle' : 'any';
}

/** Rounded to the nearest 50, for gold. */
function round50(x: number): number {
  return Math.round(x / 50) * 50;
}

function avg(list: number[]): number {
  return list.length ? list.reduce((a, b) => a + b, 0) / list.length : 0;
}

/** How much a rank filter ('gold', 'gold_plus', 'all') scales the targets. */
function rankScale(id: string): number {
  const base = id.replace(/_plus$/, '').toUpperCase();
  const k = RANK_SCALE[base];
  if (!k) return 1;
  return id.endsWith('_plus') ? k + PLUS_BUMP : k;
}

/** Your recent games on seven axes, each against a target for the role you played, as a spider chart. */
@Component({
  selector: 'rl-playstyle-radar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RankPicker],
  // A single game that isn't on Summoner's Rift (ARAM, Arena…) shows nothing at all.
  host: { '[style.display]': "single() && offRift() ? 'none' : null" },
  template: `
    <section class="card stack">
      <div class="card-head">
        <div class="title">
          <div class="info" tabindex="0" aria-describedby="playstyle-info">
            <h3>Playstyle</h3>
            <div class="hover-card info-card" id="playstyle-info" role="tooltip">
              <span class="small">{{ single() ? 'This game' : "Your recent Summoner's Rift games (not ARAM or Arena)" }} against the average player of the rank you pick, in the role you played.</span>
              <span class="small">{{ footNote() }}</span>
              <span class="faint small">Hover a section name for your number, the goal and how to improve it.</span>
            </div>
          </div>
          @if (games() > 0) {
            <span class="faint small note">{{ single() ? 'This game' : 'Last ' + games() + ' Rift ' + (games() === 1 ? 'game' : 'games') }}</span>
          }
        </div>
        <div class="head-right">
          <span class="faint small vs">vs</span>
          <rl-rank-picker class="end" [small]="true" [value]="chosen()" [auto]="autoLabel()" [autoRank]="ownTier()" (picked)="pickRank($event)" />
        </div>
      </div>
      @if (offRift()) {
        <p class="faint small">The playstyle chart only counts Summoner's Rift games, so it sits this queue out.</p>
      } @else if (axes().length < 3) {
        <p class="faint small">Play a few more Summoner's Rift games and this fills in.</p>
      } @else {
        <div class="chart">
          <div class="plot">
          <svg class="radar" [attr.viewBox]="'0 0 ' + viewW + ' ' + viewH" role="img" [attr.aria-label]="summary()">
            @for (ring of rings; track ring) {
              <polygon class="ring" [attr.points]="ringPoints(ring)" />
            }
            @for (a of axes(); track a.key; let i = $index) {
              <line class="spoke" [class.on]="hover() === i" [attr.x1]="cx" [attr.y1]="cy" [attr.x2]="at(i, 1).x" [attr.y2]="at(i, 1).y" />
            }
            @if (hover() !== null) { <polygon class="slice" [attr.points]="slice(hover()!)" /> }
            <polygon class="target" [attr.points]="goalShape()" />
            <polygon class="shape" [attr.points]="shape()" />
            @for (a of axes(); track a.key; let i = $index) {
              <circle class="goal-dot" [class.on]="hover() === i" [attr.cx]="at(i, reach(a.goalScore)).x" [attr.cy]="at(i, reach(a.goalScore)).y" r="2.5" />
              <circle class="dot" [class.weak]="isWeak(a.key)" [class.on]="dotHover() === i" [attr.cx]="at(i, reach(a.score)).x" [attr.cy]="at(i, reach(a.score)).y" r="3" />
            }
            <!-- Bigger invisible targets over your dots, for their own small card. -->
            @for (a of axes(); track a.key; let i = $index) {
              <circle class="dot-hit" [attr.cx]="at(i, reach(a.score)).x" [attr.cy]="at(i, reach(a.score)).y" r="9"
                      (mouseenter)="dotHover.set(i)" (mouseleave)="dotHover.set(null)" />
            }
            @for (a of axes(); track a.key; let i = $index) {
              <g class="axis" [class.on]="hover() === i" tabindex="0" [attr.aria-label]="a.label + ': ' + a.value + ', goal ' + a.goal"
                 (mouseenter)="hover.set(i)" (mouseleave)="hover.set(null)" (focus)="hover.set(i)" (blur)="hover.set(null)">
                <rect class="hit" [attr.x]="labelBox(i, a).x" [attr.y]="labelBox(i, a).y" [attr.width]="labelBox(i, a).w" [attr.height]="labelBox(i, a).h" rx="4" />
                <text class="label" [class.weak]="isWeak(a.key)" [attr.x]="at(i, labelAt).x" [attr.y]="at(i, labelAt).y" [attr.text-anchor]="anchor(i)">
                  <tspan [attr.x]="at(i, labelAt).x" dy="-0.15em">{{ a.label }}</tspan>
                  <tspan class="val" [attr.x]="at(i, labelAt).x" dy="1.2em">{{ a.value }}</tspan>
                </text>
              </g>
            }
          </svg>
          @if (dotCard(); as d) {
            <div class="hover-card dot-card" [style]="d.style" role="tooltip">
              <div class="hc-head"><span class="hc-title">{{ d.axis.label }}</span><span class="mono">{{ d.axis.value }}</span></div>
              @if (d.axis.best) {
                <div class="hc-row"><span class="faint">Best game</span><span class="mono">{{ d.axis.best }}</span></div>
                <div class="hc-row"><span class="faint">Worst game</span><span class="mono">{{ d.axis.worst }}</span></div>
              }
              @if (!single()) {
                <div class="faint small">Hit the goal in {{ d.axis.hits }} of {{ d.axis.games }} {{ d.axis.games === 1 ? 'game' : 'games' }}</div>
              } @else {
                <div class="faint small">{{ pct(d.axis.ofGoal) }}% of the goal</div>
              }
            </div>
          }
          @if (hovered(); as h) {
            <div class="hover-card" [style]="h.style" role="tooltip">
              <div class="hc-head">
                <span class="hc-title">{{ h.axis.label }}</span>
                <span class="mono hc-score" [class.under]="h.axis.ofGoal < 0.95">{{ pct(h.axis.ofGoal) }}% of goal</span>
              </div>
              <div class="hc-row"><span class="faint">{{ who() }}</span><span class="mono">{{ h.axis.value }}</span></div>
              <div class="hc-row goal"><span>Goal {{ goalWhere() }}</span><span class="mono">{{ h.axis.goal }}</span></div>
              <div class="faint small">{{ sourceNote(h.axis.source) }}</div>
              <div class="hc-tip">
                <span class="faint cap">{{ tipHead(h.axis) }}</span>
                <span class="small">{{ h.axis.tip }}</span>
              </div>
            </div>
          }
          </div>
          <div class="key faint small">
            <span><i class="sw you"></i>{{ who() }}</span>
            <span><i class="sw goal"></i>Goal for the role played {{ goalWhere() }}</span>
          </div>
        </div>
      }
    </section>
  `,
  styles: `
    :host { display: block; }
    .card.stack { gap: 6px; height: 100%; }
    .card-head { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 6px 10px; min-height: 26px; }
    .head-right { display: flex; align-items: center; gap: 10px; }
    .title { display: flex; align-items: baseline; flex-wrap: wrap; gap: 2px 10px; min-width: 0; }
    .note { white-space: nowrap; }
    .vs { white-space: nowrap; }
    h3 { margin: 0; }
    /* Where the goals come from, in a card under the title on hover (or keyboard focus). */
    .info { position: relative; cursor: default; outline: none; }
    .info h3 { text-decoration: underline dotted var(--line-strong); text-underline-offset: 4px; }
    .hover-card.info-card { display: none; top: calc(100% + 6px); left: 0; width: 280px; line-height: 1.4; }
    .info:hover .hover-card.info-card, .info:focus-visible .hover-card.info-card { display: flex; }
    .chart { flex: 1; display: flex; flex-direction: column; justify-content: center; gap: 6px; }
    .plot { position: relative; width: 100%; max-width: 640px; margin: 0 auto; }
    .radar { width: 100%; height: auto; display: block; overflow: visible; }
    .ring { fill: none; stroke: var(--line-strong); stroke-width: 1; }
    .spoke { stroke: var(--line); stroke-width: 1; transition: stroke 0.15s; }
    .spoke.on { stroke: var(--accent-2); }
    .target { fill: var(--accent-2-soft); stroke: var(--accent-2); stroke-width: 1.4; stroke-dasharray: 4 4; opacity: 0.85; pointer-events: none; }
    .shape { fill: var(--accent-soft); stroke: var(--accent); stroke-width: 2; stroke-linejoin: round; filter: drop-shadow(0 0 6px var(--accent-glow)); pointer-events: none; }
    .dot { fill: var(--accent); pointer-events: none; }
    .dot.weak { fill: var(--bg); stroke: var(--accent); stroke-width: 2; }
    .dot.on { r: 4.5; }
    .dot-hit { fill: transparent; cursor: default; }
    .hover-card.dot-card { width: 190px; }
    .goal-dot { fill: var(--accent-2); opacity: 0; transition: opacity 0.15s; pointer-events: none; }
    .goal-dot.on { opacity: 1; }
    .axis { cursor: default; outline: none; }
    .hit { fill: transparent; }
    .label { pointer-events: none; }
    /* The hovered axis's share of the chart, kept inside the outer ring. */
    .slice { fill: var(--accent-2-soft); stroke: none; pointer-events: none; }
    .label { font-size: 9.5px; fill: var(--text); dominant-baseline: middle; transition: fill 0.15s; }
    .label .val { font: 8.5px var(--mono); fill: var(--text-faint); }
    .label.weak { fill: var(--accent); font-weight: 600; }
    .axis.on .label { fill: var(--accent-2); }
    .axis:focus-visible .label { text-decoration: underline; }
    .hover-card {
      position: absolute; z-index: 5; width: 250px; pointer-events: none;
      display: flex; flex-direction: column; gap: 5px; padding: 10px 12px;
      background: var(--bg-raised); border: 1px solid var(--line-strong); border-radius: var(--radius-sm);
      box-shadow: 0 10px 28px rgba(0, 0, 0, 0.45);
    }
    .hc-head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
    .hc-title { font-weight: 600; }
    .hc-score { font-size: 12px; color: var(--accent-2); }
    .hc-score.under { color: var(--accent); }
    .hc-row { display: flex; justify-content: space-between; gap: 8px; font-size: 12.5px; }
    .hc-row.goal { color: var(--accent-2); }
    .hc-tip { display: flex; flex-direction: column; gap: 2px; margin-top: 3px; padding-top: 7px; border-top: 1px solid var(--line); line-height: 1.4; }
    .cap { text-transform: uppercase; letter-spacing: 0.08em; font-size: 10.5px; }
    .key { display: flex; justify-content: center; flex-wrap: wrap; gap: 4px 16px; }
    .key span { display: inline-flex; align-items: center; gap: 6px; }
    .sw { display: inline-block; width: 14px; height: 8px; border-radius: 3px; }
    .sw.you { background: var(--accent-soft); border: 1.5px solid var(--accent); }
    .sw.goal { border: 1.5px dashed var(--accent-2); }
  `,
})
export class PlaystyleRadar {
  /** The games to chart, newest first (already narrowed to the chosen queue). */
  readonly matches = input.required<MatchLine[]>();
  /** Whose games these are, for the legend. */
  readonly who = input('You');
  /** Their Solo/Duo (or Flex) tier, e.g. "GOLD"; the goals default to it. Null for unranked. */
  readonly tier = input<string | null>(null);
  /** One game (post-game summary, an opened match): no game-count minimum, and no best/worst game. */
  readonly single = input(false);

  /** The rank picked to compare with ('' = their own rank). Kept across visits. */
  protected readonly chosen = signal(readLocal(RANK_KEY) ?? '');
  protected readonly ownTier = computed(() => this.tier()?.toLowerCase() ?? null);
  /** The rank filter in use: the picked one, else their own, else all ranks. */
  private readonly rankId = computed(() => this.chosen() || this.ownTier() || 'all');
  private readonly scale = computed(() => rankScale(this.rankId()));
  /** "Gold", "Gold+" or "All ranks", for the legend and hover card. */
  protected readonly rankLabel = computed(() => rankName(this.rankId()));
  /** "in Gold", or "across all ranks". */
  protected readonly goalWhere = computed(() => (this.rankId() === 'all' ? 'across all ranks' : `in ${this.rankLabel()}`));
  protected readonly autoLabel = computed(() => {
    const own = this.ownTier();
    return `${this.who() === 'You' ? 'Your' : 'Their'} rank${own ? ` (${rankName(own)})` : ''}`;
  });

  protected readonly hover = signal<number | null>(null);
  /** The axis whose pink dot is under the mouse. */
  protected readonly dotHover = signal<number | null>(null);

  private readonly rift = inject(RiftService);
  /** Real average KDA by rank filter, then role ('any' = all lanes together), from OP.GG's ranked tier lists. */
  private readonly kdaByRank = signal<Record<string, Partial<Record<Role, number>>>>({});
  private readonly kdaAsked = new Set<string>();

  constructor() {
    // The chosen rank's KDA, and all ranks' as the fixed scale.
    effect(() => {
      const rank = this.rankId();
      untracked(() => {
        void this.loadKda('all');
        void this.loadKda(rank);
      });
    });
  }

  /** OP.GG's average KDA per lane for `rank`, weighted by games. One request fills all five lanes (the rest come from its cache). */
  private async loadKda(rank: string): Promise<void> {
    if (this.kdaAsked.has(rank)) return;
    this.kdaAsked.add(rank);
    const out: Partial<Record<Role, number>> = {};
    let [sum, games] = [0, 0];
    for (const [role, lane] of LANES) {
      try {
        const list = await this.rift.getTierList('opgg', lane, rank);
        let [s, g] = [0, 0];
        for (const e of list.entries) {
          if (e.kda) {
            s += e.kda * e.games;
            g += e.games;
          }
        }
        if (g > 0) {
          out[role] = s / g;
          [sum, games] = [sum + s, games + g];
        }
      } catch {
        // Offline or OP.GG changed: this lane keeps the estimate.
      }
    }
    if (games > 0) out.any = sum / games;
    this.kdaByRank.update((m) => ({ ...m, [rank]: out }));
  }

  /** Real KDA for the role played in `m`: the chosen rank's and all ranks', or null to use the estimates for both. */
  private realKda(m: MatchLine): { goal: number; base: number } | null {
    const all = this.kdaByRank();
    const role = roleOf(m);
    const goal = all[this.rankId()]?.[role];
    const base = all['all']?.[role];
    return goal && base ? { goal, base } : null;
  }

  /** Sampled averages for the role played in `m`: the chosen rank's and all ranks', or null if there's no sample. */
  private sample(m: MatchLine): { goal: Targets; base: Targets } | null {
    const role = roleOf(m);
    const goal = sampled(this.rankId(), role);
    const base = sampled('all', role);
    return goal && base ? { goal, base } : null;
  }

  /** The all-ranks targets for the role played in `m`: the fixed scale both shapes are drawn on. */
  private base(m: MatchLine): Targets {
    const s = this.sample(m);
    if (s) return s.base;
    const t = TARGETS[roleOf(m)];
    const real = this.realKda(m);
    return real ? { ...t, kda: real.base } : t;
  }

  /** The goals for the role played in `m` at the chosen rank: OP.GG's KDA where there is one, the rest estimated. */
  private target(m: MatchLine): Targets {
    const s = this.sample(m);
    if (s) return s.goal;
    const t = TARGETS[roleOf(m)];
    const k = this.scale();
    const real = this.realKda(m);
    return { gold: t.gold * k, damage: t.damage * k, kp: t.kp, kda: real ? real.goal : t.kda * k, deaths: t.deaths / k, vision: t.vision * k, objectives: t.objectives * k };
  }

  protected readonly viewW = VIEW_W;
  protected readonly viewH = VIEW_H;
  protected readonly cx = CX;
  protected readonly cy = CY;
  protected readonly labelAt = LABEL_AT;
  protected readonly rings = [0.25, 0.5, 0.75, 1];

  /** Counted Summoner's Rift games (remakes left out). */
  private readonly riftGames = computed(() =>
    this.matches().filter((m) => m.result !== 'remake' && m.duration > 300 && !OFF_RIFT_QUEUES.has(m.queueId) && !OFF_RIFT_MODE.test(m.gameMode)),
  );
  protected readonly games = computed(() => this.riftGames().length);
  /** The role in at least half the counted games, for role tips; null when the games are spread out. */
  protected readonly mainRole = computed<Lane | null>(() => {
    const games = this.riftGames();
    const count = new Map<Role, number>();
    for (const m of games) count.set(roleOf(m), (count.get(roleOf(m)) ?? 0) + 1);
    const top = [...count.entries()].sort((a, b) => b[1] - a[1])[0];
    return top && top[0] !== 'any' && top[1] * 2 >= games.length ? top[0] : null;
  });
  /** "How to improve as a mid laner" etc. */
  protected tipHead(a: Axis): string {
    const lane = this.mainRole();
    if (a.level === 'far' || a.level === 'under') return lane ? `How to improve as a ${ROLE_NAME[lane]}` : 'How to improve';
    return a.level === 'on' ? 'Next step' : 'Keep it up';
  }
  /** Every game picked is off the Rift (an ARAM or Arena tab). */
  protected readonly offRift = computed(() => this.riftGames().length === 0 && this.matches().some((m) => m.result !== 'remake'));

  protected readonly axes = computed<Axis[]>(() => {
    const games = this.riftGames();
    const minGames = this.single() ? 1 : MIN_GAMES;
    if (games.length < minGames) return [];
    const mins = (m: MatchLine) => m.duration / 60;
    const sum = (list: MatchLine[], f: (m: MatchLine) => number) => list.reduce((a, m) => a + f(m), 0);
    /** A per-game target (or baseline) over `list`, weighted by `w` (game length for per-minute stats). */
    const wavg = (list: MatchLine[], f: (m: MatchLine) => number, w: (m: MatchLine) => number = () => 1) => {
      const total = sum(list, w);
      return total > 0 ? sum(list, (m) => f(m) * w(m)) / total : 0;
    };
    /** Each axis for one game, in the card's units: yours (null when the game has no number), the goal, and the format. */
    const pct = (x: number) => `${Math.round(100 * x)}%`;
    const perGame: Record<AxisKey, { you: (m: MatchLine) => number | null; goal: (m: MatchLine) => number; show: (x: number) => string }> = {
      gold: { you: (m) => m.gold / mins(m), goal: (m) => this.target(m).gold, show: (x) => `${Math.round(x)}/min` },
      damage: { you: (m) => m.damage / mins(m), goal: (m) => this.target(m).damage, show: (x) => `${Math.round(x)}/min` },
      fights: { you: (m) => (m.teamKills ? (m.kills + m.assists) / m.teamKills : null), goal: (m) => this.target(m).kp, show: pct },
      kda: { you: (m) => (m.kills + m.assists) / Math.max(1, m.deaths), goal: (m) => this.target(m).kda, show: (x) => x.toFixed(1) },
      deaths: { you: (m) => m.deaths, goal: (m) => this.target(m).deaths * mins(m), show: (x) => `${Math.round(x)}` },
      vision: { you: (m) => (m.vision > 0 ? m.vision : null), goal: (m) => this.target(m).vision * mins(m), show: (x) => `${Math.round(x)}` },
      objectives: { you: (m) => (m.objectiveDamage != null ? m.objectiveDamage / mins(m) : null), goal: (m) => this.target(m).objectives, show: (x) => `${Math.round(x)}/min` },
    };
    const out: Axis[] = [];
    for (const def of AXES) {
      // Everything is in the units shown on the card, so "% of goal" is just you against the goal there:
      // mine (yours), want (the chosen rank's goal) and base (the all-ranks average for your roles).
      let list: MatchLine[] = games;
      let mine = 0;
      let want = 0;
      let base = 0;
      let fewerIsBetter = false;
      let value = '';
      let goal = '';
      /** What closing the gap to the goal takes, in plain numbers ('' when there's no gap to close). */
      let need = '';
      switch (def.key) {
        case 'gold': {
          const t = sum(list, mins);
          mine = sum(list, (m) => m.gold) / t;
          want = wavg(list, (m) => this.target(m).gold, mins);
          base = wavg(list, (m) => this.base(m).gold, mins);
          value = `${Math.round(mine)}/min`;
          goal = `${Math.round(want)}/min`;
          const extra = round50((want - mine) * (t / list.length));
          if (extra > 0) need = `That's about ${extra} more gold a game, roughly ${Math.max(1, Math.round(extra / 21))} more minions.`;
          break;
        }
        case 'damage': {
          mine = sum(list, (m) => m.damage) / sum(list, mins);
          want = wavg(list, (m) => this.target(m).damage, mins);
          base = wavg(list, (m) => this.base(m).damage, mins);
          value = `${Math.round(mine)}/min`;
          goal = `${Math.round(want)}/min`;
          const extra = Math.round((want - mine) / 10) * 10;
          if (extra > 0) need = `That's about ${extra} more damage to champions every minute.`;
          break;
        }
        case 'fights': {
          list = games.filter((m) => m.teamKills != null && m.teamKills > 0);
          const kills = sum(list, (m) => m.teamKills!);
          if (kills === 0) break;
          mine = sum(list, (m) => m.kills + m.assists) / kills;
          want = wavg(list, (m) => this.target(m).kp, (m) => m.teamKills!);
          base = wavg(list, (m) => this.base(m).kp, (m) => m.teamKills!);
          value = `${Math.round(100 * mine)}% KP`;
          goal = `${Math.round(100 * want)}% KP`;
          const extra = Math.round((want - mine) * (kills / list.length));
          if (extra > 0) need = `That's being part of about ${extra} more of your team's kills a game.`;
          break;
        }
        case 'kda': {
          // Over all the games together, since one deathless game has no ratio of its own.
          const k = sum(list, (m) => m.kills + m.assists);
          const d = sum(list, (m) => m.deaths);
          mine = k / Math.max(1, d);
          want = wavg(list, (m) => this.target(m).kda);
          base = wavg(list, (m) => this.base(m).kda);
          value = mine.toFixed(1);
          goal = want.toFixed(1);
          const fewer = Math.round(((d - k / want) / list.length) * 10) / 10;
          if (fewer >= 0.3) need = `At your kills and assists, that's dying about ${fewer.toFixed(1)} fewer times a game.`;
          break;
        }
        case 'deaths': {
          fewerIsBetter = true;
          mine = sum(list, (m) => m.deaths) / list.length;
          want = wavg(list, (m) => this.target(m).deaths * mins(m));
          base = wavg(list, (m) => this.base(m).deaths * mins(m));
          value = `${mine.toFixed(1)}/game`;
          goal = `${want.toFixed(1)} or fewer/game`;
          const fewer = Math.round((mine - want) * 10) / 10;
          if (fewer >= 0.3) need = `That's about ${fewer.toFixed(1)} fewer deaths a game.`;
          break;
        }
        case 'vision': {
          // OP.GG has no vision score (it comes through as 0). Per game, like the Profile's vision tile.
          list = games.some((m) => m.vision > 0) ? games : [];
          if (!list.length) break;
          mine = sum(list, (m) => m.vision) / list.length;
          want = wavg(list, (m) => this.target(m).vision * mins(m));
          base = wavg(list, (m) => this.base(m).vision * mins(m));
          value = `${Math.round(mine)}/game`;
          goal = `${Math.round(want)}/game`;
          const extra = Math.round(want - mine);
          if (extra > 0) need = `That's about ${extra} more vision score a game. A ward that lasts its full time is worth a few points.`;
          break;
        }
        case 'objectives': {
          list = games.filter((m) => m.objectiveDamage != null);
          const t = sum(list, mins);
          if (t === 0) break;
          mine = sum(list, (m) => m.objectiveDamage!) / t;
          want = wavg(list, (m) => this.target(m).objectives, mins);
          base = wavg(list, (m) => this.base(m).objectives, mins);
          value = `${Math.round(mine)}/min`;
          goal = `${Math.round(want)}/min`;
          const extra = Math.round(((want - mine) * (t / list.length)) / 100) * 100;
          if (extra > 0) need = `That's about ${extra} more damage to towers and monsters a game.`;
          break;
        }
      }
      if (list.length < minGames || !(want > 0) || !(base > 0)) continue;
      // Against the all-ranks average: above 1 is better than average. Fewer-is-better stats flip, with a floor
      // so a nearly deathless run doesn't go off the chart.
      const rel = (x: number) => (fewerIsBetter ? base / Math.max(x, base / GAME_CAP) : x / base);
      const score = Math.min(GAME_CAP, rel(mine));
      const goalScore = rel(want);
      const ofGoal = score / goalScore;
      const source = list.every((m) => this.sample(m)) ? 'riot' : def.key === 'kda' && list.every((m) => this.realKda(m)) ? 'opgg' : 'estimate';
      const level = levelOf(ofGoal);
      const lane = this.mainRole();
      const advice = level === 'far' || level === 'under' ? (lane ? def.byRole[lane] : def.low) : def.high;
      const lead =
        level === 'far' ? `This is well under the goal. ${need}` :
        level === 'under' ? `Close. ${need}` :
        level === 'on' ? 'Right around the goal.' :
        `${this.pct(ofGoal) - 100}% above the goal: a strength.`;
      const pg = perGame[def.key];
      const each = list.map((m) => ({ you: pg.you(m), goal: pg.goal(m) })).filter((g): g is { you: number; goal: number } => g.you != null);
      const sorted = each.map((g) => g.you).sort((a, b) => (fewerIsBetter ? a - b : b - a));
      const hits = each.filter((g) => (fewerIsBetter ? g.you <= g.goal : g.you >= g.goal)).length;
      const best = sorted.length > 1 ? pg.show(sorted[0]) : '';
      const worst = sorted.length > 1 ? pg.show(sorted[sorted.length - 1]) : '';
      out.push({ key: def.key, label: def.label, tip: `${lead.trim()} ${advice}`, level, score, goalScore, ofGoal, value, goal, games: each.length, best, worst, hits, source });
    }
    return out;
  });

  /** Where the goals come from, under the chart. */
  protected readonly footNote = computed(() => {
    const src = new Set(this.axes().map((a) => a.source));
    if (src.size === 1 && src.has('riot')) return `Goals are averages of sampled ranked games from Riot (patch ${RANK_TARGETS?.patch}).`;
    if (src.has('opgg')) return "KDA goals are real averages from OP.GG's ranked games; the others are estimates.";
    return 'Goals are estimates for the selected rank.';
  });

  protected sourceNote(source: Axis['source']): string {
    if (source === 'riot') return `Average of players ${this.goalWhere()} in sampled ranked games (patch ${RANK_TARGETS?.patch})`;
    if (source === 'opgg') return `Average of players ${this.goalWhere()} on OP.GG this patch`;
    return 'Estimated goal';
  }

  /** Every axis under the goal (the same line the tips use for "How to improve"); drawn in pink. */
  protected readonly weak = computed(() => this.axes().filter((a) => a.level === 'far' || a.level === 'under'));

  /** The hovered axis and where its card goes: beside the label, toward the middle of the chart. */
  protected readonly hovered = computed(() => {
    const i = this.hover();
    const axis = i === null ? undefined : this.axes()[i];
    if (i === null || !axis) return null;
    const p = this.at(i, LABEL_AT);
    const x = (100 * p.x) / VIEW_W;
    const y = (100 * p.y) / VIEW_H;
    const side = this.anchor(i);
    const horiz = side === 'middle' ? `left: ${x}%; transform: translateX(-50%);` : side === 'start' ? `right: ${100 - x}%;` : `left: ${x}%;`;
    const vert = p.y < CY ? `top: calc(${y}% + 18px);` : `bottom: calc(${100 - y}% + 18px);`;
    return { axis, style: horiz + vert };
  });

  /** The small card over a hovered dot: best and worst game, and how many games met the goal. */
  protected readonly dotCard = computed(() => {
    const i = this.dotHover();
    const axis = i === null ? undefined : this.axes()[i];
    if (i === null || !axis) return null;
    const p = this.at(i, this.reach(axis.score));
    // Above the dot, or below it for dots in the top half so the card stays inside the chart.
    const shift = p.y < CY ? 'translate(-50%, 12px)' : 'translate(-50%, calc(-100% - 12px))';
    return { axis, style: `left: ${(100 * p.x) / VIEW_W}%; top: ${(100 * p.y) / VIEW_H}%; transform: ${shift};` };
  });

  protected readonly shape = computed(() =>
    this.axes()
      .map((a, i) => {
        const p = this.at(i, this.reach(a.score));
        return `${p.x},${p.y}`;
      })
      .join(' '),
  );

  /** The dotted ring: the chosen rank's goal on each axis. */
  protected readonly goalShape = computed(() =>
    this.axes()
      .map((a, i) => {
        const p = this.at(i, this.reach(a.goalScore));
        return `${p.x},${p.y}`;
      })
      .join(' '),
  );

  protected readonly summary = computed(
    () => `Playstyle compared with role goals ${this.goalWhere()}: ` + this.axes().map((a) => `${a.label} ${this.pct(a.ofGoal)}% of goal`).join(', '),
  );

  protected pickRank(id: string): void {
    this.chosen.set(id);
    writeLocal(RANK_KEY, id || null);
  }

  protected isWeak(key: AxisKey): boolean {
    return this.weak().some((a) => a.key === key);
  }

  /** How far out a score sits, 0 to 1 (0.5 = the all-ranks average; see `ZOOM`). */
  protected reach(score: number): number {
    return Math.max(0.02, 0.5 + 0.5 * Math.tanh((score - 1) * ZOOM));
  }

  /** The point at `frac` of the radius along axis `i` (fractions fall between axes), first axis straight up. */
  protected at(i: number, frac: number): { x: number; y: number } {
    const n = this.axes().length;
    const ang = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    return { x: +(CX + Math.cos(ang) * R * frac).toFixed(1), y: +(CY + Math.sin(ang) * R * frac).toFixed(1) };
  }

  /** The box around axis `i`'s name and value, the only part that opens its hover card. Text width is estimated. */
  protected labelBox(i: number, a: Axis): { x: number; y: number; w: number; h: number } {
    const p = this.at(i, LABEL_AT);
    const w = Math.max(a.label.length * 5.6, a.value.length * 5.3) + 8;
    const h = 26;
    const side = this.anchor(i);
    const x = side === 'middle' ? p.x - w / 2 : side === 'start' ? p.x - 4 : p.x - w + 4;
    return { x: +x.toFixed(1), y: +(p.y - 10).toFixed(1), w: +w.toFixed(1), h };
  }

  /** Axis `i`'s part of the outer ring: from the centre out to halfway along the ring's two edges beside it. */
  protected slice(i: number): string {
    const mid = (a: { x: number; y: number }, b: { x: number; y: number }) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    const tip = this.at(i, 1);
    return [{ x: CX, y: CY }, mid(this.at(i - 1, 1), tip), tip, mid(tip, this.at(i + 1, 1))].map((p) => `${p.x},${p.y}`).join(' ');
  }

  protected ringPoints(frac: number): string {
    return this.axes()
      .map((_, i) => {
        const p = this.at(i, frac);
        return `${p.x},${p.y}`;
      })
      .join(' ');
  }

  protected anchor(i: number): 'start' | 'middle' | 'end' {
    const x = this.at(i, 1).x - CX;
    return Math.abs(x) < 8 ? 'middle' : x > 0 ? 'start' : 'end';
  }

  protected pct(score: number): number {
    return Math.round(score * 100);
  }
}
