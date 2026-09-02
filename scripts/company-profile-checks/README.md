# Company-profile browser checks

The browser half of the company-profile smoke test. `scripts/smoke-company-profile.py`
reads the source; these drive a real Chrome over CDP against the running app.

    pip3 install websocket-client
    npm run dev
    # add a temporary route that re-exports the page outside the auth gate:
    #   app/zz-preview-cp/page.tsx  ->  export { default } from '../dashboard/company-profile/page'
    SP=/tmp/scratch python3 scripts/company-profile-checks/cp_browser.py    # 10 tabs open, console clean
    SP=/tmp/scratch python3 scripts/company-profile-checks/cp_contrast.py   # AA over every tab, both themes

## Two things these get wrong if you are not careful

The company row is `<div class="cp-head" onClick>`, not a button. Clicking
"the first button" lands on Edit and expands nothing — every tab then reports
EMPTY and it looks like the page is broken.

The contrast walker cannot resolve a gradient ground, so it skips those nodes
(235 of 596 on this page) rather than guessing. A clean run means "nothing
failed among what could be measured", not "everything was measured".
