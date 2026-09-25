'use client';
import * as React from 'react';

/**
 * Confirmation toast. Call toast() AFTER a write succeeds — i.e. where the tab
 * already calls onRefresh() — never before, so the message never claims
 * something the database refused. If the app already has a toast system, map
 * useRxToast() onto it instead and skip the provider.
 */
const Ctx = React.createContext<(msg: string) => void>(() => {});

export function RxToastProvider({ children }: { children: React.ReactNode }) {
  const [msg, setMsg] = React.useState<string | null>(null);
  const [on, setOn] = React.useState(false);
  // Explicit `undefined`: this repo's React types require an initial value for
  // the no-argument useRef overload, so the kit's `useRef<T>()` does not compile
  // here. Same behaviour, one argument.
  const timer = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const toast = React.useCallback((m: string) => {
    setMsg(m); setOn(true); clearTimeout(timer.current);
    timer.current = setTimeout(() => setOn(false), 2400);
  }, []);
  return (
    <Ctx.Provider value={toast}>
      {children}
      <div className={on ? 'rx-toast on' : 'rx-toast'} role="status" aria-live="polite">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M8 12.5l3 3 5-6" /></svg>
        {msg}
      </div>
    </Ctx.Provider>
  );
}
export const useRxToast = () => React.useContext(Ctx);
