/**
 * How many modal surfaces are currently open.
 *
 * The app binds global keyboard shortcuts to bare keys (the quiz answers on 1–5 and steps back on
 * ArrowLeft, via a `<svelte:window onkeydown>` handler). `showModal()` makes the rest of the
 * document inert, but key events still bubble to `window`, so those shortcuts keep firing under a
 * dialog unless the handler checks this flag first.
 *
 * A counter rather than a boolean: a dialog can be raised from inside another surface (a policy
 * link inside the Terms gate), and closing the inner one must not hand the shortcuts back while
 * the outer one is still up.
 *
 * Not reactive. The only consumer is a plain DOM event handler needing the current value, and
 * `depth += 1` reads before it writes — registering from inside a dialog-opening `$effect` would
 * make that effect depend on a value it just set. Add a separate reactive projection if something
 * ever needs to render from this.
 */
class ModalState {
  private depth = 0;

  /** True while any modal surface is open; global key handlers must no-op on it. */
  get isOpen(): boolean {
    return this.depth > 0;
  }

  /**
   * Register an open modal. Returns the release function — call it on close.
   * Safe to use as an `$effect` return value, whose cleanup runs on unmount, so an unmounted modal
   * can never leave the shortcuts suspended forever.
   */
  open(): () => void {
    this.depth += 1;
    let released = false;
    return () => {
      // Guard a double release (a close handler plus an effect teardown) from driving the count
      // negative, which would report `isOpen` false with a modal still on screen.
      if (released) return;
      released = true;
      this.depth -= 1;
    };
  }
}

export const modal = new ModalState();
