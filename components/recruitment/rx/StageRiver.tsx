'use client';
import * as React from 'react';
import { Icon } from './icons';
import type { CandidateVM } from './logic/types';
import { countByStage } from './logic/derive';

/** The signature element: current stage counts, left to right, Rejected set apart. */
export function StageRiver({ candidates, stages, onStage }: { candidates: CandidateVM[]; stages: readonly string[]; onStage?: (stage: string) => void }) {
  const { counts, rejected, max } = countByStage(candidates, stages);
  const busiest = counts.find((c) => c.count === max && max > 0)?.stage;
  return (
    <>
      <div className="rx-river" style={{ gridTemplateColumns: `repeat(${counts.length}, minmax(0, 1fr))` }}>
        {counts.map(({ stage, count }, i) => {
          const cls = count === 0 ? 'zero' : stage === busiest ? 'hot' : i === counts.length - 1 ? 'win' : '';
          return (
            <button key={stage} type="button" className="rx-node" onClick={() => onStage?.(stage)}
              title={`${count} at ${stage}`} style={{ background: 'none', border: 0, font: 'inherit', cursor: onStage ? 'pointer' : 'default' }}>
              <span className={`rx-dot ${cls}`}>{count}</span>
              <span className="rx-nl">{stage}</span>
              <span className="rx-nb"><i style={{ width: `${Math.round((count / max) * 100)}%` }} /></span>
            </button>
          );
        })}
      </div>
      <div className="rx-outcome"><Icon name="x" /><b>{rejected}</b><span>Rejected, kept apart because it is an outcome, not a stage in the flow.</span></div>
    </>
  );
}
