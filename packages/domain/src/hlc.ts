/**
 * Hybrid logical clock.
 *
 * Operations need an ordering that (a) roughly tracks wall time so histories
 * read sensibly, and (b) never goes backwards even when a device's clock does.
 * The clock is `{ wall, counter }`; comparison is lexicographic with the device
 * id as the final tiebreak, which makes every comparison total and identical on
 * every replica.
 */
export interface Hlc {
  /** Milliseconds since epoch, monotonic per device. */
  readonly wall: number;
  /** Disambiguates events inside the same millisecond. */
  readonly counter: number;
}

export interface HlcStamp extends Hlc {
  readonly deviceId: string;
}

export function hlcCompare(a: HlcStamp, b: HlcStamp): number {
  if (a.wall !== b.wall) return a.wall < b.wall ? -1 : 1;
  if (a.counter !== b.counter) return a.counter < b.counter ? -1 : 1;
  if (a.deviceId === b.deviceId) return 0;
  return a.deviceId < b.deviceId ? -1 : 1;
}

/** True when `a` is the later stamp — the winner of a last-writer-wins field. */
export function hlcLater(a: HlcStamp, b: HlcStamp): boolean {
  return hlcCompare(a, b) > 0;
}

export interface ClockOptions {
  readonly deviceId: string;
  /** Injected so tests and the simulation harness stay deterministic. */
  readonly now?: () => number;
}

export class HlcClock {
  private readonly deviceId: string;
  private readonly now: () => number;
  private wall = 0;
  private counter = 0;

  constructor(options: ClockOptions) {
    this.deviceId = options.deviceId;
    this.now = options.now ?? (() => Date.now());
  }

  /** Stamp a locally created operation. */
  next(): HlcStamp {
    const physical = this.now();
    if (physical > this.wall) {
      this.wall = physical;
      this.counter = 0;
    } else {
      this.counter += 1;
    }
    return { wall: this.wall, counter: this.counter, deviceId: this.deviceId };
  }

  /**
   * Fold a remote stamp in, so anything this device creates afterwards sorts
   * after what it has already seen.
   */
  observe(remote: Hlc): void {
    const physical = this.now();
    const wall = Math.max(this.wall, remote.wall, physical);
    if (wall === this.wall && wall === remote.wall) {
      this.counter = Math.max(this.counter, remote.counter) + 1;
    } else if (wall === remote.wall) {
      this.counter = remote.counter + 1;
    } else if (wall !== this.wall) {
      this.counter = 0;
    } else {
      this.counter += 1;
    }
    this.wall = wall;
  }
}
