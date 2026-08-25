import type { GateReason, InteractionSignals } from './types';

/**
 * The human gate + interaction signals the spam scorer reads.
 *
 * Everything here is fed from React's own events (the hook wires
 * `register()` and `formProps` into it) plus two passive window listeners
 * for mouse and scroll. No DOM is touched, nothing is observed that React
 * owns - which is the whole reason the old library broke under React.
 *
 * The scorer penalises: no gate reason, no keystrokes, no focus events,
 * no fields touched, no mouse, webdriver, no plugins, no languages. A form
 * that only syncs values through onChange and never reports focus or keys
 * looks like a bot - so the hook reports all of them.
 */
export class InteractionTracker {
  private gateReason: GateReason = 'none';

  private gateAt = 0;

  private keystrokes = 0;

  private focusEvents = 0;

  private mouse = false;

  private scrolled = false;

  private touched = new Set<string>();

  private gateListeners: Array<(reason: GateReason) => void> = [];

  private detach: (() => void) | null = null;

  // -----------------------------------------------
  // Gate
  // -----------------------------------------------

  get isOpen(): boolean {
    return this.gateAt !== 0;
  }

  onGateOpen(listener: (reason: GateReason) => void): void {
    this.gateListeners.push(listener);
  }

  openGate(reason: GateReason): void {
    if (this.isOpen) {
      return;
    }
    this.gateReason = reason;
    this.gateAt = Date.now();
    for (const listener of this.gateListeners) {
      listener(reason);
    }
  }

  // -----------------------------------------------
  // Signals
  // -----------------------------------------------

  focus(field: string): void {
    this.focusEvents++;
    this.touched.add(field);
  }

  keystroke(): void {
    this.keystrokes++;
  }

  touch(field: string): void {
    this.touched.add(field);
  }

  /** Passive window listeners for mouse + scroll. Returns once; call stop() on unmount. */
  listen(): void {
    if (this.detach || typeof window === 'undefined') {
      return;
    }
    const onMouse = (): void => {
      this.mouse = true;
    };
    const onScroll = (): void => {
      this.scrolled = true;
    };
    window.addEventListener('mousemove', onMouse, { passive: true, once: true });
    window.addEventListener('scroll', onScroll, { passive: true, once: true });
    this.detach = (): void => {
      window.removeEventListener('mousemove', onMouse);
      window.removeEventListener('scroll', onScroll);
    };
  }

  stop(): void {
    this.detach?.();
    this.detach = null;
  }

  payload(): InteractionSignals {
    const nav = typeof navigator !== 'undefined' ? navigator : null;

    return {
      dur: this.gateAt ? Date.now() - this.gateAt : 0,
      gt: this.gateReason,
      k: this.keystrokes,
      f: this.focusEvents,
      m: this.mouse ? 1 : 0,
      s: this.scrolled ? 1 : 0,
      t: this.touched.size,
      w: nav?.webdriver ? 1 : 0,
      p: nav?.plugins?.length ?? 0,
      l: nav?.languages?.length ?? 0,
    };
  }

  /** After a successful submit the next session starts its own count. */
  reset(): void {
    this.gateReason = 'none';
    this.gateAt = 0;
    this.keystrokes = 0;
    this.focusEvents = 0;
    this.touched = new Set();
  }
}
