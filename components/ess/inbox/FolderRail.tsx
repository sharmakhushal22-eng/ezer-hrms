'use client';
import { Ic } from './icons';
import type { FolderVM } from './types';
import { inkStyle, useTick } from './ui';

interface Props {
  folders: FolderVM[];          // without ALL
  totalUnread: number;          // Messages group unread — the ALL row
  active: FolderVM['code'];
  collapsed: boolean;
  onPick: (code: FolderVM['code']) => void;
  onCompose: () => void;
  onToggleCollapse: () => void;
}

export function FolderRail({ folders, totalUnread, active, collapsed, onPick, onCompose, onToggleCollapse }: Props) {
  const direct = folders.find(f => f.code === 'DIRECT') ?? folders[0];
  const perf = folders.find(f => f.code === 'PERFORMANCE') ?? folders[folders.length - 1];
  return (
    <aside className="pane rail">
      <button className="tog" type="button" onClick={onToggleCollapse}
        aria-label={collapsed ? 'Expand folders' : 'Collapse folders'} title={collapsed ? 'Expand folders' : 'Collapse folders'}>
        {Ic.back({ style: { width: 13, height: 13 } })}
      </button>
      <button className="compose" type="button" onClick={onCompose} title="New message">
        {Ic.plus()}<span>New message</span>
      </button>
      <h3>Who is this from?</h3>
      <nav className="folders" aria-label="Folders">
        <FolderButton
          code="ALL" label="All" hint="Everything, newest first" unread={totalUnread}
          active={active === 'ALL'} onPick={onPick}
          style={direct && perf ? inkStyle(direct) : undefined}
          dotStyle={direct && perf ? { background: `linear-gradient(135deg, ${direct.inkLight}, ${perf.inkLight})` } : undefined}
        />
        {folders.map(f => (
          <FolderButton key={f.code} code={f.code} label={f.label} hint={f.hint} unread={f.unread}
            active={active === f.code} onPick={onPick} style={inkStyle(f)} />
        ))}
      </nav>
      <div className="foot">
        <kbd>/</kbd> search · <kbd>c</kbd> compose · <kbd>↑</kbd><kbd>↓</kbd> move · <kbd>s</kbd> star · <kbd>u</kbd> unread · <kbd>Esc</kbd> back
      </div>
    </aside>
  );
}

function FolderButton({ code, label, hint, unread, active, onPick, style, dotStyle }: {
  code: FolderVM['code']; label: string; hint: string; unread: number; active: boolean;
  onPick: (c: FolderVM['code']) => void; style?: React.CSSProperties; dotStyle?: React.CSSProperties;
}) {
  const tick = useTick(unread);
  return (
    <button className="folder ib-h" type="button" style={style} aria-current={active ? 'true' : 'false'}
      title={hint} onClick={() => onPick(code)}>
      <span className="dot" style={dotStyle} />
      <span className="lbl">{label}<small><span>{hint}</span></small></span>
      <span className={`n ${tick}`}>{unread > 0 ? unread : ''}</span>
    </button>
  );
}
