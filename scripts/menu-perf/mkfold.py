import pathlib, os, re
ROOT='/Users/tusharpanwar/Desktop/HRMS/ezer-hrms'; SP=os.environ['SP']
lay=pathlib.Path(ROOT,'app/dashboard/layout.tsx').read_text()
theme=pathlib.Path(ROOT,'lib/ui/theme.css').read_text()
a=lay.index('<style>{`',lay.index('const HUE')); b=lay.index('`}</style>',a)
rail=(lay[a+len('<style>{`'):b].replace('${C.railText}','var(--ez-rail-text)')
      .replace('${C.railFaint}','var(--ez-rail-faint)').replace('${F.micro}','11')
      .replace('${W.bold}','700').replace('${C.rail}','var(--ez-rail)'))
assert '${' not in rail, rail[rail.index('${'):rail.index('${')+60]
HUE=dict(re.findall(r"'(/dashboard[^']*)':\s*'(#[0-9A-Fa-f]{6})'",lay))
INK={g:(l,d) for g,l,d in re.findall(r"'([^']+)':\s*\{ inkL: '(#[0-9A-Fa-f]{6})', inkD: '(#[0-9A-Fa-f]{6})' \}",lay)}
NAV=lay[lay.index('const NAV: NavGroup[]'):lay.index('const OPEN_W')]
GROUPS=[(m.group(1), re.findall(r"label: '([^']+)',\s*href: '([^']+)'", m.group(2)))
        for m in re.finditer(r"\{ group: '([^']*)', items: \[(.*?)\]\}", NAV, re.S)]
ACTIVE='/dashboard/payroll'
G='<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="%s" stroke-linecap="round" stroke-linejoin="round"><rect x="2.3" y="2.3" width="11.4" height="11.4" rx="3"/><path d="M5.4 8h5.2M8 5.4v5.2"/></svg>'
SHUT={'People','Money'}
body=''
for i,(g,items) in enumerate(GROUPS):
    l,d=INK.get(g,('var(--ez-rail-faint)',)*2)
    shut = g in SHUT
    hasact = any(h==ACTIVE for _,h in items)
    head=''
    if g:
        head=('<button class="ez-group-head%s" data-g="%s" aria-expanded="%s">'
              '<span class="ez-dotwrap"><span class="ez-group-dot"></span></span>'
              '<span class="ez-group-name">%s</span>%s'
              '<span class="ez-fold"><svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 4.5 6 7.8 9 4.5"/></svg></span>'
              '</button>')%(' ez-here-head' if (shut and hasact) else '', g,
                'false' if shut else 'true', g,
                ('<span class="ez-count%s">%d</span>'%(
                  ' ez-count-here' if (shut and hasact) else '', len(items))) if shut else '')
    rows=''
    for n,(label,href) in enumerate(items):
        hue=HUE[href]; on=href==ACTIVE
        rows+=('<a class="ez-nav%s" style="--nav-hue:%s;--n:%d">%s<span class="ez-nav-tile">%s</span>'
               '<span class="lb" style="font-weight:%s;color:%s">%s</span></a>')%(
          ' ez-nav-on' if on else '', hue, n,
          ('<span class="bar" style="background:%s;box-shadow:0 0 8px %s80"></span>'%(hue,hue)) if on else '',
          G%('2' if on else '1.7'), '700' if on else '600',
          'var(--ez-rail-text)' if on else 'var(--ez-rail-item)', label)
    cls='ez-group-items' if g else 'ez-group-items ez-group-bare'
    body+=('<div class="ez-group%s" style="--g-ink-l:%s;--g-ink-d:%s;--i:%d">%s'
           '<div class="ez-group-panel"%s><div class="ez-group-panel-inner">'
           '<div class="%s">%s</div></div></div></div>')%(
        '' if shut else ' ez-open', l,d,i,head,' inert' if (shut and g) else '',cls,rows)
shell="""
body{margin:0;font-family:system-ui,-apple-system,sans-serif;background:var(--ez-canvas)}
.rail{width:244px;background:var(--ez-rail);border-right:1px solid var(--ez-rail-line);min-height:100vh;padding:12px 10px 16px;display:flex;flex-direction:column;gap:1px}
.ez-nav{height:40px;border-radius:10px;display:flex;align-items:center;gap:10px;padding:0 8px;position:relative;flex-shrink:0;text-decoration:none}
.bar{position:absolute;left:0;top:7px;bottom:7px;width:3px;border-radius:0 3px 3px 0}
.ez-nav-tile{width:26px;height:26px;border-radius:8px;flex-shrink:0;display:flex;align-items:center;justify-content:center}
.lb{font-size:13.5px;letter-spacing:-.005em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
"""
js="""document.querySelectorAll('.ez-group-head').forEach(b=>b.addEventListener('click',()=>{
  const g=b.closest('.ez-group'); const open=g.classList.toggle('ez-open');
  b.setAttribute('aria-expanded',open);
  // mirror the component: a shut panel is inert, so its links leave the tab order
  const panel=g.querySelector('.ez-group-panel');
  if(open) panel.removeAttribute('inert'); else panel.setAttribute('inert','');
  g.querySelector('.ez-count')?.remove();
  g.querySelector('.ez-group-head')?.classList.remove('ez-here-head');
}));"""
for t in ('light','dark'):
    pathlib.Path(SP,'fold-%s.html'%t).write_text(
      '<!doctype html><html data-ez-theme="%s"><head><meta charset="utf-8">'
      '<style>%s</style><style>%s</style><style>%s</style></head>'
      '<body><div class="rail">%s</div><script>%s</script></body></html>'%(
        t,theme,shell,rail,body,js))
print('  fold harness: People and Money shut, active row inside Money')
