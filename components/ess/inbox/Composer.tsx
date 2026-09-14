'use client';
import { useEffect, useRef, useState } from 'react';
import { flags } from './flags';
import { Ic } from './icons';

interface Props {
  conversationId: string;
  disabledReason?: React.ReactNode;   // closed / one-way — renders the "off" strip instead
  autoFocus?: boolean;
  onSend: (body: string, files: File[]) => Promise<void>;
}

/**
 * Enter sends, Shift+Enter is a newline (rule 9). The textarea grows to 160px.
 * After a send the parent re-opens the thread and reloads the list (rule from §6).
 */
export function Composer({ conversationId, disabledReason, autoFocus, onSend }: Props) {
  const [text, setText] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [ok, setOk] = useState(false);
  const [drop, setDrop] = useState(false);
  const ta = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => { setText(''); setFiles([]); }, [conversationId]);
  useEffect(() => { if (autoFocus) ta.current?.focus(); }, [autoFocus, conversationId]);

  const canSend = !busy && (text.trim().length > 0 || files.length > 0);

  async function submit() {
    if (!canSend) return;
    setBusy(true);
    try {
      await onSend(text.trim(), files);
      setText(''); setFiles([]);
      if (ta.current) ta.current.style.height = 'auto';
      setOk(true); window.setTimeout(() => setOk(false), 900);
    } finally { setBusy(false); }
  }

  if (disabledReason) return <div className="composer off">{disabledReason}</div>;

  return (
    <div className="composer">
      {flags.attachments && files.length > 0 && (
        <div className="attchips">
          {files.map((f, i) => (
            <span key={`${f.name}-${i}`}>{f.name}
              <button type="button" aria-label="Remove" onClick={() => setFiles(fs => fs.filter((_, k) => k !== i))}>
                {Ic.close({ style: { width: 12, height: 12 } })}
              </button>
            </span>
          ))}
        </div>
      )}
      <div
        className={`box${drop ? ' drop' : ''}`}
        onDragEnter={e => { if (!flags.attachments) return; e.preventDefault(); setDrop(true); }}
        onDragOver={e => { if (!flags.attachments) return; e.preventDefault(); setDrop(true); }}
        onDragLeave={() => setDrop(false)}
        onDrop={e => { if (!flags.attachments) return; e.preventDefault(); setDrop(false); setFiles(fs => [...fs, ...Array.from(e.dataTransfer.files)]); }}
      >
        {flags.attachments && (
          <>
            <button className="clip" type="button" aria-label="Attach a file" onClick={() => fileInput.current?.click()}>{Ic.clip()}</button>
            <input ref={fileInput} type="file" className="sr" multiple
              onChange={e => { setFiles(fs => [...fs, ...Array.from(e.target.files ?? [])]); e.target.value = ''; }} />
          </>
        )}
        <textarea
          ref={ta} rows={1} placeholder="Write a reply…" value={text}
          onChange={e => {
            setText(e.target.value);
            e.target.style.height = 'auto';
            e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px`;
          }}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void submit(); } }}
        />
        <button className={`send${ok ? ' ok' : ''}`} type="button" aria-label="Send" disabled={!canSend && !ok} onClick={() => void submit()}>
          {ok ? Ic.check() : Ic.send()}
        </button>
      </div>
      <div className="hint">
        <span><kbd>Enter</kbd> to send</span>
        <span><kbd>Shift</kbd>+<kbd>Enter</kbd> for a new line</span>
      </div>
    </div>
  );
}
