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

## 2. `.rx-dlg-modal` was never centred

Fixed during phase 4 — see the comment in `lib/ui/recruitment.redesign.css`
above the `.rx-dlg-modal` rule. Noted here because it has the same shape as
issue 1: the kit ships the rule, its own prototype never renders that variant,
so nothing exercised it until this integration did.
