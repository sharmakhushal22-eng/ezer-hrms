'use client';
// components/ess/social/WishSheet.tsx — writing a wish, a greeting or a welcome.
//
// One composer for all three. What changes between them is the wording and the
// accent colour, not the mechanics, and the API already agrees: POST
// /api/ess/celebrations takes {to_employee_id, kind, message} where kind is
// BIRTHDAY | ANNIVERSARY | KUDOS. The message field has existed all along and
// no screen has ever sent one — this is the screen that does.
//
// GIFS COME FROM A PACK WE HOST. No Giphy, no Tenor: a third-party picker sends
// every search an employee types to another company, and the search box of an
// internal social feed is not something to hand over. The tiles below are drawn
// in CSS so the preview needs no assets; the real pack lands in Supabase
// Storage under the same keys.
//
// Sub-components at module scope — the textarea here is precisely what a nested
// declaration would break.
import { useState } from 'react';
import type { SocialKind, SocialMedia } from './types';
import { GIF_PACK, REACTIONS, WISH_SUGGESTIONS } from './mock';
import { Send, Gif } from './icons';

const VERB: Record<string, { cta: string; placeholder: string }> = {
  birthday: { cta: 'Send birthday wishes', placeholder: 'Write something for their birthday…' },
  anniversary: { cta: 'Send your congratulations', placeholder: 'Say something about working with them…' },
  joiner: { cta: 'Send your welcome', placeholder: 'Welcome them to the company…' },
  shoutout: { cta: 'Post it', placeholder: 'Say what they did, and why it mattered…' },
};

function GifTile({ g, on, onPick }: {
  g: (typeof GIF_PACK)[number]; on: boolean; onPick: () => void;
}) {
  const glyph: Record<string, string> = {
    confetti: '🎊', cake: '🎂', balloons: '🎈', clap: '👏', popper: '🎉', highfive: '🙌',
  };
  return (
    <button
      type="button" className="gift" data-on={on ? '1' : '0'} onClick={onPick}
      aria-pressed={on} aria-label={g.label}
      style={{ background: `color-mix(in srgb, hsl(${g.hue} 70% 92%) var(--ez-avatar-tint-mix, 100%), var(--ez-surface))` }}
    >
      <span className="glyph" aria-hidden style={{ animationDelay: `${g.hue % 7 * 0.13}s` }}>
        {glyph[g.ref] ?? '🎉'}
      </span>
      <span className="cap">{g.label}</span>
    </button>
  );
}

export default function WishSheet({ kind, name, onSend, onCancel }: {
  kind: SocialKind;
  name: string;
  onSend: (message: string, media: SocialMedia | null) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState('');
  const [media, setMedia] = useState<SocialMedia | null>(null);
  const [showGifs, setShowGifs] = useState(false);
  const v = VERB[kind] ?? VERB.shoutout;
  const suggestions = WISH_SUGGESTIONS[kind] ?? [];

  return (
    <div className="sheet" style={{ position: 'relative' }}>
      <div>
        <div className="lbl">To {name}</div>
        <textarea
          autoFocus
          value={text}
          onChange={e => setText(e.target.value)}
          placeholder={v.placeholder}
          // 500 is the cap the celebrations route already enforces on the
          // server. Matching it here means the limit is felt while typing
          // rather than reported after pressing send.
          maxLength={500}
          style={{ marginTop: 7 }}
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
          <span style={{ fontSize: 11.5, color: 'var(--ez-faint)', fontVariantNumeric: 'tabular-nums' }}>
            {text.length}/500
          </span>
        </div>
      </div>

      {suggestions.length > 0 && !text && (
        <div>
          <div className="lbl" style={{ marginBottom: 6 }}>Or start from one of these</div>
          <div className="sug">
            {suggestions.map(s => (
              <button key={s} type="button" onClick={() => setText(s)}>{s}</button>
            ))}
          </div>
        </div>
      )}

      <div>
        <div className="lbl" style={{ marginBottom: 6 }}>Add an emoji</div>
        <div className="sug">
          {REACTIONS.map(e => (
            <button key={e} type="button" aria-label={`Add ${e}`}
              onClick={() => setText(t => (t + ' ' + e).trimStart())}
              style={{ fontSize: 15, paddingInline: 9 }}>{e}</button>
          ))}
        </div>
      </div>

      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button type="button" className="btn sm" onClick={() => setShowGifs(s => !s)} aria-expanded={showGifs}>
            <Gif /> {media ? `GIF: ${media.label}` : 'Add a GIF'}
          </button>
          {media && (
            <button type="button" className="btn sm quiet" onClick={() => setMedia(null)}>Remove</button>
          )}
        </div>
        {showGifs && (
          <div className="gifs" style={{ marginTop: 10 }}>
            {GIF_PACK.map(g => (
              <GifTile
                key={g.ref} g={g} on={media?.ref === g.ref}
                onPick={() => setMedia(media?.ref === g.ref ? null : { kind: 'gif', ref: g.ref, label: g.label })}
              />
            ))}
          </div>
        )}
      </div>

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button type="button" className="btn quiet" onClick={onCancel}>Cancel</button>
        <button
          type="button" className="btn primary"
          onClick={() => onSend(text.trim(), media)}
          // A wish with neither words nor a GIF is just a button press, and the
          // one-per-day rule means it cannot be followed by a real one.
          disabled={!text.trim() && !media}
        >
          <Send /> {v.cta}
        </button>
      </div>
    </div>
  );
}
