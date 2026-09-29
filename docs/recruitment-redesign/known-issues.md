# Known issues in the recruitment redesign kit

Things found while integrating the kit that are **not** bugs introduced by the
integration. Each says what it is, what it currently costs, and why it was left
alone rather than fixed in passing.

## 1. `.rx-tl` names two unrelated things

`components/recruitment/rx/Shell.tsx` gives every rail tab label
`className="rx-tl"` (one per tab — 11 on this module). `primitives.tsx`
`<Timeline>` uses the same class for its container. The stylesheet has a single
rule, written for the timeline:

```css
.rx-tl{display:flex;flex-direction:column;gap:0;position:relative}
```

There is no `.rx-tab .rx-tl` override, so that rule reaches the rail labels.

**Inherited, not ours.** The kit ships it: its `Shell.tsx:133` and
`primitives.tsx:140` both use `rx-tl`, and its stylesheet carries the one rule.

**Cost today: none visible.** Each rail label holds a single text node, so
column-flex lays it out the same as inline — measured live at 65x14px with the
right font size, and the rail renders correctly on every tab.

**Why it is still worth knowing.** The two consumers are now joined at the hip.
Any future change to the timeline rule — a `gap`, a `padding`, an `align-items`
— silently restyles all 11 rail labels on every tab of the module, and the
person making the timeline change has no reason to look at the rail.

**If it is ever fixed:** rename the rail's label class (`rx-tab-l`, say) in
`Shell.tsx` and add the matching rule, rather than renaming the timeline's —
the timeline class is load-bearing for `.rx-tli`/`.rx-tld` inside it. That
touches the rail on every tab, which is why it was not done as part of a
tab-scoped redesign phase.

## Verification limits (not defects — things that cannot be checked here)

### The browser harness cannot exercise CSS breakpoints

Resizing the browser window does **not** change the page's layout viewport.
Measured during phase 6d, after `resize_window` reported success at 500x800:

```
innerWidth: 1440      <- the layout viewport, unchanged
outerWidth: 752       <- the OS window really did shrink
devicePixelRatio: 2
matchMedia('(max-width:1180px)').matches -> false
matchMedia('(max-width:760px)').matches  -> false
```

The tab renders at a fixed viewport independent of the window, so the two
`@media` blocks in `recruitment.redesign.css` (<=1180px and <=760px) can never
be triggered from this session. Anything that depends on them — the bento
collapse, `.s3/.s4 -> span 6`, `.s5..s9 -> span 12`, the single-column phone
layout — is **unverified by inspection only**, however many times it is retried.

Don't burn turns on it. Verify responsive behaviour in a real browser, or by
reading the rules and the span classes each layout uses.

### Screenshot pixels are not click pixels

`computer:left_click` takes CSS pixels, but the screenshots come back at a
different width than the page's CSS viewport. Measured during phase 8b:

```
getBoundingClientRect() centre of the Next button : (495, 620)
window.innerWidth / visualViewport.width          : 1440 / 1432
devicePixelRatio                                  : 2
screenshot widths seen in the same session        : 1503, 1524, 1560, 1564
```

So a coordinate read off a screenshot image does not address the same point as
the same coordinate passed to a click, and the drift is not a constant offset —
it changes with the screenshot width. Several clicks in this session went to the
wrong tab or the wrong rail item for exactly this reason, and each one looked
like "the feature is broken" rather than "the click missed".

**Use `find` and click by `ref`.** It resolves the element directly, and it also
disambiguates when a page mounts the same component twice — /mrf-preview mounts
two `<MrfForm>` instances, so a positional click can land on the second form's
button while a DOM probe reads the first.

Read coordinates from `getBoundingClientRect()` only when a ref is unavailable,
and never from the screenshot image.

## 2. `.rx-dlg-modal` was never centred

Fixed during phase 4 — see the comment in `lib/ui/recruitment.redesign.css`
above the `.rx-dlg-modal` rule. Noted here because it has the same shape as
issue 1: the kit ships the rule, its own prototype never renders that variant,
so nothing exercised it until this integration did.
