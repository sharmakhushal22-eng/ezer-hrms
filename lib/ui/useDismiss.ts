'use client';
// lib/ui/useDismiss.ts — close a popover when the user clicks away or presses Escape.
//
// THE BUG THIS REPLACES
//
// The usual way to dismiss a menu is a transparent full-screen div behind it
// that closes on click:
//
//   {open && <div onClick={() => setOpen(false)} style={{position:'fixed',inset:0}} />}
//
// It works for a click on empty space, and it is wrong for a click on anything
// else — because "anything else" includes the next trigger along. That div
// covers the whole viewport, so the click lands on the div rather than on the
// button the user aimed at. The menu closes and nothing else happens. The
// button has to be pressed a second time to open its own menu.
//
// On a row of dropdown tabs this is constant: every move from one tab to the
// next costs two clicks, the first of which appears to do nothing. It reads as
// the interface dropping input.
//
// A document-level listener has no such shadow. The click reaches whatever was
// actually under the pointer, so moving between two menus is one click: this
// menu closes on pointerdown, the other opens on the click that follows.
//
// pointerdown rather than click, in the capture phase, so the close happens
// before the target's own handler runs — otherwise a trigger's toggle could
// fire first and be immediately undone by the dismissal.

import * as React from 'react';

/**
 * Returns a ref to put on the popover's outermost wrapper — the element that
 * contains both the trigger and the panel. A pointerdown outside that element,
 * or Escape, calls `close`.
 *
 * @param open   whether the popover is currently showing; no listeners are
 *               attached while it is closed
 * @param close  called to dismiss it
 * @param ignore optional selector for a trigger that sits OUTSIDE the wrapper.
 *               Without it, clicking such a trigger would dismiss on
 *               pointerdown and re-open on the click, so the popover could
 *               never be closed from its own button.
 */
export function useDismiss<T extends HTMLElement = HTMLDivElement>(
  open: boolean,
  close: () => void,
  ignore?: string,
) {
  const ref = React.useRef<T>(null);

  // Held in a ref so an inline arrow for `close` does not tear down and
  // reattach the listeners on every render.
  const cb = React.useRef(close);
  cb.current = close;

  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const el = ref.current;
      if (!el) return;
      const t = e.target as Element | null;
      if (el.contains(t as Node)) return;
      if (ignore && t?.closest?.(ignore)) return;
      cb.current();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') cb.current(); };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, ignore]);

  return ref;
}
