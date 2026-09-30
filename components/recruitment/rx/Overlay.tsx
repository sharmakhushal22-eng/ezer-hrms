'use client';
import * as React from 'react';

/**
 * Drawer / modal on the native <dialog> element.
 * showModal() gives the top layer, focus trapping and Esc for free; closedby="any"
 * adds backdrop light-dismiss, with a click fallback where the attribute is not
 * supported yet (Safari).
 *
 * Replaces only the SHELL of CandidateInterviewModal and the MRF detail drawer.
 * Their contents — and every write they make — stay as they are.
 */
export function RxDialog({ open, onClose, variant, label, children, style }: {
  open: boolean; onClose: () => void; variant: 'drawer' | 'modal'; label: string; children: React.ReactNode;
  /**
   * Escape hatch for content that manages its own padding. `.rx-dlg-drawer`
   * sets padding:28px, which suits content written for this shell — but a panel
   * lifted out of an older container already pads every section itself, and the
   * 28px then insets a header meant to bleed to the edges.
   */
  style?: React.CSSProperties;
}) {
  const ref = React.useRef<HTMLDialogElement>(null);

  React.useEffect(() => {
    const d = ref.current; if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  React.useEffect(() => {
    const d = ref.current; if (!d) return;
    const onCloseEvt = () => onClose();
    d.addEventListener('close', onCloseEvt);
    const supportsClosedBy = typeof HTMLDialogElement !== 'undefined' && 'closedBy' in HTMLDialogElement.prototype;
    const onClick = (e: MouseEvent) => {
      if (supportsClosedBy || e.target !== d) return;
      const r = d.getBoundingClientRect();
      const inside = r.top <= e.clientY && e.clientY <= r.bottom && r.left <= e.clientX && e.clientX <= r.right;
      if (!inside) d.close();
    };
    d.addEventListener('click', onClick);
    return () => { d.removeEventListener('close', onCloseEvt); d.removeEventListener('click', onClick); };
  }, [onClose]);

  return (
    <dialog ref={ref} className={variant === 'drawer' ? 'rx-dlg rx-dlg-drawer' : 'rx-dlg rx-dlg-modal'} aria-label={label} style={style}
      // closedby is newer than React's DOM typings
      {...({ closedby: 'any' } as Record<string, string>)}>
      {children}
    </dialog>
  );
}
