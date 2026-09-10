/**
 * Hover intent lives here rather than in the island.
 *
 * The renderer only learns the cursor is inside after the daemon has already
 * decided to stop being click-through, so the dwell has to be timed on this
 * side or the first half of it is invisible.
 *
 * The keyboard can also hold the island open. While held, the cursor leaving
 * does not close it; when the hold ends, the island closes unless the cursor
 * is inside, in which case hovering simply carries on.
 */
export class Hover {
  private openTimer: NodeJS.Timeout | null = null;
  private closeTimer: NodeJS.Timeout | null = null;
  private open = false;
  private inside = false;
  private held = false;

  constructor(private emit: (open: boolean) => void, private timing: () => { hoverDelay: number; leaveGrace: number }) {}

  isOpen(): boolean { return this.open; }

  /** Keep the island open regardless of the cursor, or stop doing so. */
  hold(held: boolean): void {
    if (this.held === held) return;
    this.held = held;
    if (held) {
      this.clearTimers();
      if (!this.open) { this.open = true; this.emit(true); }
      return;
    }
    if (!this.inside) this.set(false, true);
  }

  set(inside: boolean, immediate = false): void {
    this.inside = inside;
    const cfg = this.timing();
    if (inside) {
      if (this.closeTimer) {
        clearTimeout(this.closeTimer);
        this.closeTimer = null;
      }
      if (this.open || this.openTimer) return;
      this.openTimer = setTimeout(() => {
        this.openTimer = null;
        this.open = true;
        this.emit(true);
      }, cfg.hoverDelay);
      return;
    }
    if (this.openTimer) {
      clearTimeout(this.openTimer);
      this.openTimer = null;
    }
    if (this.held || !this.open || this.closeTimer) return;
    const close = () => {
      this.closeTimer = null;
      this.open = false;
      this.emit(false);
    };
    if (immediate) close();
    else this.closeTimer = setTimeout(close, cfg.leaveGrace);
  }

  private clearTimers() {
    if (this.openTimer) clearTimeout(this.openTimer);
    if (this.closeTimer) clearTimeout(this.closeTimer);
    this.openTimer = this.closeTimer = null;
  }
}
