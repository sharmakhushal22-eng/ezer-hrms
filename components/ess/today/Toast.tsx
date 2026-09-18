'use client';
import { Check } from './icons';
export default function Toast({ msg }: { msg: string | null }) {
  return <div className={'toast' + (msg ? ' show' : '')} role="status" aria-live="polite"><span className="ok"><Check width={12} height={12} stroke="#fff" /></span><span>{msg}</span></div>;
}
