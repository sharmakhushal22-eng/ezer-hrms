# Rail perf + behaviour harness

The browser half of the left-menu smoke test. `scripts/smoke-menu.py` reads the
source; these drive a real Chrome over CDP against a harness built from the
*shipped* CSS, so the thing measured is the thing that ships.

    pip3 install websocket-client
    python3 scripts/menu-perf/mkfold.py     # rebuild the harness from layout.tsx
    python3 scripts/menu-perf/cdp_perf.py   # frame pacing, every section both ways
    python3 scripts/menu-perf/cdp_sections.py
    python3 scripts/menu-perf/cdp_stress.py
    python3 scripts/menu-perf/cdp_theme.py
    python3 scripts/menu-perf/cdp_fold.py

They expect `SP` to point at a scratch directory holding the generated
`fold-*.html`, and `cdp_menu.py`-style route checks need `npm run dev` up.

## Why the frame numbers are trustworthy

A headless browser can report a clean 16.7ms cadence while rendering nothing,
which would make any "no jank" claim worthless. `cdp_proof.py` injects a
synchronous block mid-animation and confirms the measurement *sees* it:

    injected   0ms -> max  16.8ms, 0 late frames   clean
    injected 120ms -> max 100.0ms, 1 late frame    JANK SEEN
    injected 250ms -> max 233.2ms, 1 late frame    JANK SEEN

Run that first if a result ever looks too good.
