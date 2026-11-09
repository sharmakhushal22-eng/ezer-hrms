# Video storage and delivery for the EZER LMS

Researched 1 November 2026. All prices are USD list prices, excluding GST and card forex charges, read on 2026-11-01 unless a different date is given. No project code was read.

Evidence labels:
- **[inferred]** means my own deduction, not stated by a source.
- **[search result]** means the claim came from a search result summary and I could not open the page itself (usually HTTP 403).
- **[tested]** means I ran it myself on 2026-11-01.

---

## 1. Recommendation

**(a) Today, no new paid vendor: Supabase Storage on the Pro plan.**
- Upload straight from the browser with TUS to a private bucket.
- Accept only MP4 with H.264 video, AAC audio and the `moov` box at the front of the file.
- Generate the poster and read the duration in the browser.
- Play with a plain `<video>` element.
- Issue **one shared signed URL per video, rotated about every 24 hours**, not one per viewer. Per-viewer tokens never warm the CDN cache.
- Track completion with `played` ranges, heartbeats and a server-side wall-clock cap.
- Marginal cost for the 500-employee scenario is **$0/month** on an existing Pro project (240 GB/month against 250 GB cached plus 250 GB uncached included, section 3).

This requires Pro. The Free plan's 50 MB upload limit rejects even one 120 MB video.

**(b) When a customer outgrows that: Mux, capped at 720p, with Bunny Stream as the fallback.**
- Run a one-day playback test on Jio and Airtel before committing, because I could not verify Mux's India edge coverage. Bunny's five Indian PoPs are confirmed on its own network page.
- Among managed services (no video pipeline to run), Mux is cheapest in every modelled case up to about 28 tenants of this size. After that Bunny is cheaper. CloudFront flat-rate with MediaConvert undercuts both at high volume, but you would be operating the pipeline yourself.

**Switch when any one of these is true** (the thresholds are my judgement [inferred]):

| Trigger | Threshold |
|---|---|
| Volume | Over 1 TB of video egress in a month, two months running (overage of about $22.50 if all cached, $67.50 if all uncached) |
| One large customer | A single tenant whose mandatory-training month will exceed 1 TB. At 1.2 GB/hour that is about 174 employees watching all 40 videos in one month, including the 20% re-watch (1,000 GB ÷ 5.76 GB) |
| Network quality | A customer with a large frontline or low-bandwidth workforce, or failed or stalled plays above about 3% for any tenant. A single MP4 has no lower-quality fallback |
| Contract | A customer requires DRM or a similar content-protection clause |
| Reachability | A repeat of the 2026 block on `supabase.co`, or a customer firewall that blocks it |

**SCORM:** do not build it at MVP. Ship native video plus quiz, and keep a `content_type` column as the seam. Add SCORM 1.2 import when the first paying prospect brings a library, most likely a purchased POSH course. Skip xAPI and cmi5 (section 7).

**Three risks to fix before launch:**
1. **Video and the HRMS share one egress quota.** All Supabase services draw on the same uncached quota, and a Spend Cap turns overage into a grace period under the Fair Use Policy instead of a bill ([egress docs](https://supabase.com/docs/guides/platform/manage-your-usage/egress)). A training push could therefore affect the whole HRMS project [inferred]. Decide the Spend Cap setting deliberately before video goes live.
2. **Quotas are per organisation, not per customer.** The $0 result holds for one tenant only. Five tenants of this size means 1,200 GB/month (section 3.4).
3. **Signed-URL Range support is proven from source code, not by a live request.** Run the 15-minute spike in section 2.2 first.

---

## 2. Option comparison

### 2.1 Feature summary

| Option | Storage price | Delivery price | Adaptive bitrate | Signed access | India delivery | Build effort [inferred] |
|---|---|---|---|---|---|---|
| Supabase Storage (Pro) | 100 GB included, then $0.0213/GB | 250 GB uncached + 250 GB cached included, then $0.09 / $0.03 per GB | No | Yes, signed URLs | Mumbai origin. Delivery fronted by a CDN that emits `cf-cache-status` | Low |
| Cloudflare Stream | $5 per 1,000 minutes per month | $1 per 1,000 minutes | Yes, HLS/DASH | Yes, tokens up to 24 hours | Not researched at PoP level for Stream | Low |
| Cloudflare R2 | $0.015/GB (10 GB free) | Egress free | No | Presigned URLs, S3 endpoint only | No India jurisdiction listed | Medium |
| S3 + CloudFront | $0.025/GB in Mumbai | $0.109/GB India after 1 TB free, or $15/month flat plan | Only with MediaConvert | Yes | Flat-rate docs never mention India | High |
| Mux | $0.0024/min/month (720p) | First 100,000 min/month free, then $0.0008/min (720p) | Yes | Yes, signed JWT | Multi-CDN, India edges unverified | Low |
| Bunny Stream | $0.01/GB, plus replication | $0.03/GB Asia (Standard tier) | Yes, free standard encoding | Yes, token auth | 5 Indian PoPs confirmed | Low to medium |
| Vimeo | Not verified | Not verified | Yes | Domain-level privacy | Not researched | Low, unsuitable |
| YouTube unlisted | Free | Free | Yes | None | Not researched | Unsuitable |

### 2.2 Supabase Storage

**Plans and limits**

| Item | Free | Pro | Source |
|---|---|---|---|
| Plan price | $0 | From $25/month | [pricing](https://supabase.com/pricing) |
| Storage included | 1 GB | 100 GB, then $0.0213/GB | [pricing](https://supabase.com/pricing), [storage size](https://supabase.com/docs/guides/platform/manage-your-usage/storage-size) |
| Uncached egress | 5 GB | 250 GB, then $0.09/GB | [egress](https://supabase.com/docs/guides/platform/manage-your-usage/egress) |
| Cached egress | 5 GB | 250 GB, then $0.03/GB | [egress](https://supabase.com/docs/guides/platform/manage-your-usage/egress) |
| Max upload | 50 MB | 500 GB, set in Storage Settings | [file limits](https://supabase.com/docs/guides/storage/uploads/file-limits) |
| Smart CDN | No, Basic CDN | Yes | [pricing](https://supabase.com/pricing), [Smart CDN](https://supabase.com/docs/guides/storage/cdn/smart-cdn) |
| Image transforms | No | 100 origin images, then $5 per 1,000 | [pricing](https://supabase.com/pricing) |
| Custom domain add-on | n/a | $10/month | [custom domain usage](https://supabase.com/docs/guides/platform/manage-your-usage/custom-domains) |

Image transforms apply to images only, so they do not help with video. The Storage docs I read describe no video transcoding [inferred].

**Range requests and MP4 seeking work. The result below is my own test.**

[tested] Against `https://xguihxuzqibwxjnimxev.supabase.co/storage/v1/object/public/videos/docs/cascade-delete.mp4`, a 4.98 MB public file from Supabase's own docs:

| Request | Result |
|---|---|
| `Range: bytes=0-99`, first try | `206`, `content-range: bytes 0-99/4977621`, `cf-cache-status: MISS` |
| Same range, second try | `206`, `cf-cache-status: HIT` |
| `Range: bytes=200000-200999` (a range never requested before) | `206`, `HIT` |
| `HEAD` | `200`, `accept-ranges: bytes` |
| Range with an `Origin` header | `206`, `access-control-allow-origin: *` |
| First 64 bytes | `ftyp` then `moov`, so the file is faststart |

The HIT on a new range suggests the edge caches the whole object and answers ranges from it [inferred].

Code history supports this:
- The 2021 [byte-range issue](https://github.com/supabase/storage/issues/20) was closed, though someone commented "For me its failing again" in December 2025.
- [Issue #322](https://github.com/supabase/storage/issues/322) on the RANGE header was closed in March 2024, and [PR #358](https://github.com/supabase/storage/pull/358) added Range to the file adapter.
- The S3 backend path forwards the header in [`asset.ts`](https://github.com/supabase/storage/blob/master/src/storage/renderer/asset.ts) (`range: request.headers.range`).
- The signed-URL route renders through that same `asset` renderer in [`getSignedObject.ts`](https://github.com/supabase/storage/blob/master/src/http/routes/object/getSignedObject.ts).

Not proven: a live signed URL on a private bucket, and files over about 5 MB. Run this on a staging or test bucket with a real 120 MB file before committing:

```bash
curl -s -o /dev/null -D - -r 50000000-50000999 "<signed url>" | grep -iE '^HTTP|content-range|cf-cache-status'
```

Run it twice with the same URL. Expect `206` both times and `HIT` the second time. Then play the file in iOS Safari, which needs correct 206 handling. Reports say Safari refuses to play without byte-range support ([Stack Overflow mirror, search result](https://kiwix.lema.org/stackoverflow.com_en_all_2023-11/a/4762072)).

**Signed URLs and the CDN: this is the key cost decision.** From the [Smart CDN docs](https://supabase.com/docs/guides/storage/cdn/smart-cdn):
- Each signed URL has a unique `token`, and each token is a separate cache entry.
- Generating a new signed URL per request means the cache never warms up.
- Revoking or expiring a token does not clear its cached response. Only deleting the object does, and that can take up to a minute.

[CDN fundamentals](https://supabase.com/docs/guides/storage/cdn/fundamentals) adds that eviction can happen before the cache-control TTL if nobody in a region requests the object.

| Approach | Egress class | Trade-off |
|---|---|---|
| Per-viewer signed URL | Effectively all uncached, $0.09/GB over quota | Strong per-user revocation |
| Shared URL per video, rotated every 24 hours, stored server-side | Mostly cached, $0.03/GB over quota | A leaked URL works for up to a day. Revocation means deleting the object [inferred] |
| Public bucket with an unguessable path | Best cache rate | No expiry at all. Not suitable for private corporate content [inferred] |

The shared rotated URL is the right balance for internal training, because the content is rarely personal data [inferred]. The player must catch a failed fetch after rotation, get a fresh URL and resume at `currentTime` [inferred].

**HLS on Supabase:** Storage is a file store, so `.m3u8` and segment files can be stored, but my search found no official Supabase documentation for serving HLS. Each signed URL covers one object, so a private HLS stream would need a rewritten playlist with a signed URL per segment, or a proxy [inferred]. You would also have to build the transcoding yourself. It is the wrong path: if you need HLS, buy it.

**Supabase India reachability:** Section 69A blocking order on 24 February 2026 hit `supabase.co` on JioFiber, Airtel and ACT in New Delhi, with uneven enforcement ([TechCrunch](https://www.techcrunch.com/2026/02/27/india-disrupts-access-to-popular-developer-platform-supabase-with-blocking-order/)). Supabase's statement that access was "fully restored for all users across India" was reported on 4 March 2026 ([AIM](https://analyticsindiamag.com/ai-news/india-restores-access-to-supabase-after-isp-level-block)). I did not test current reachability from Indian networks. The [custom domain](https://supabase.com/docs/guides/platform/custom-domains) add-on serves Storage from your own domain, but the page does not mention TUS.

### 2.3 Cloudflare Stream

- $5/month per 1,000 minutes stored (prepaid), and $1 per 1,000 minutes delivered (post-paid). Ingress and encoding are free, and bandwidth is included ([pricing](https://developers.cloudflare.com/stream/pricing/)).
- Billing rounds web playback to segment length (4 seconds for uploads). Preloading counts, and cached replays do not.
- Direct creator uploads use a one-time URL. Basic POST is for files under 200 MB, and tus is required above that ([docs](https://developers.cloudflare.com/stream/uploading-videos/direct-creator-uploads/)).
- `requireSignedURLs` plus tokens: 1 hour by default and at most 24 hours. A signing key avoids per-token API calls ([docs](https://developers.cloudflare.com/stream/viewing-videos/securing-your-stream/)).
- HLS and DASH manifests work with any compatible player ([docs](https://developers.cloudflare.com/stream/viewing-videos/using-own-player/)).
- The Player SDK exposes `timeupdate`, `ended`, `seeked`, `currentTime`, `played` and `duration` ([docs](https://developers.cloudflare.com/stream/viewing-videos/using-the-stream-player/using-the-player-api/)), so the tracking design in section 5 carries over.

### 2.4 Cloudflare R2

- Standard storage $0.015/GB-month. Class A $4.50 and Class B $0.36 per million. Egress free. Free tier: 10 GB-month, 1 million Class A, 10 million Class B ([pricing](https://developers.cloudflare.com/r2/pricing/)).
- `r2.dev` is rate-limited and for development only. Caching and WAF need a custom domain on a Cloudflare zone ([docs](https://developers.cloudflare.com/r2/buckets/public-buckets/)).
- Presigned URLs work only on the S3 endpoint, not custom domains, so a private video has no edge cache unless you add WAF HMAC validation, which needs a Pro plan or above ([docs](https://developers.cloudflare.com/r2/api/s3/presigned-urls/)).
- Location hints include `apac`. Jurisdictions are `eu`, `fedramp` and `us`, with no India option ([docs](https://developers.cloudflare.com/r2/reference/data-location/)).
- Cloudflare's CDN terms for non-Enterprise plans say paid services must be used to serve video and large files, naming Stream, Images and the Developer Platform as examples, and do not name R2 ([terms](https://www.cloudflare.com/service-specific-terms-application-services/), updated 2026-09-28). R2 is presumably part of the Developer Platform [inferred]. Confirm this before putting an R2 custom domain in front of video.

R2 fixes cost but not quality. It is a useful escape hatch if egress is the only problem.

### 2.5 AWS S3 + CloudFront + MediaConvert

Prices from AWS's public price list for `ap-south-1` and CloudFront, plus the [pay-as-you-go page](https://aws.amazon.com/cloudfront/pricing/pay-as-you-go/):

| Item | Price | Price list published |
|---|---|---|
| S3 Standard, Mumbai, first 50 TB | $0.025/GB-month | [2026-10-15](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonS3/current/ap-south-1/index.json) |
| S3 PUT / GET | $0.005 per 1,000 / $0.0004 per 1,000 | same |
| CloudFront to India, first 1 TB | Free (always-free tier) | [page](https://aws.amazon.com/cloudfront/pricing/pay-as-you-go/) |
| CloudFront to India, up to 10 TB | **$0.109/GB** | [2026-10-19](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonCloudFront/current/index.json) |
| CloudFront to India, next 40 TB | $0.085/GB | same |
| CloudFront HTTPS requests, India | $0.012 per 10,000, first 10 million free | same |
| S3 to CloudFront transfer | Free | [page](https://aws.amazon.com/cloudfront/pricing/pay-as-you-go/) |
| MediaConvert Basic, HD AVC, up to 30 fps, Mumbai | $0.015/output minute | [2026-09-11](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSElementalMediaConvert/current/ap-south-1/index.json) |
| MediaConvert Basic, SD AVC, up to 30 fps, Mumbai | $0.0075/output minute | same |

India's $0.109/GB is the highest delivery rate in this comparison.

**The flat-rate plan changes the picture.** CloudFront Pro is [$15/month with 50 TB of transfer, 10 million requests and 50 GB of S3 credit](https://aws.amazon.com/cloudfront/pricing/), with no overage charges. From the [developer guide](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/flat-rate-pricing-plan.html):
- Signed URLs are included on every tier.
- An AWS WAF web ACL is mandatory.
- Each plan covers one distribution and one apex domain.
- Allowances are not hard limits. Sustained excess may mean traffic is "served from fewer or more distant edge locations".

That guide never mentions India (0 matches), so regional delivery quality is unverified. HLS would still need MediaConvert plus signed cookies or similar for segments [inferred]. This is the cheapest path at high scale, but it means operating a video pipeline.

### 2.6 Mux

- Rates from the [pricing docs](https://www.mux.com/docs/pricing/video): 720p storage $0.0024/min/month for the first 50,000 minutes. 720p delivery $0.0008/min for the first 500,000 minutes after the free allowance. Basic encoding is free.
- First **100,000 delivered minutes each month are free**, and pay-as-you-go accounts get a $20 monthly usage credit ([pricing](https://www.mux.com/pricing)).
- Basic assets have a one-month minimum storage charge, and buffered segments are billed even if unwatched ([pricing docs](https://www.mux.com/docs/pricing/video)).
- Signed playback uses RS256 JWTs with a required `exp`, plus optional referrer restrictions ([docs](https://www.mux.com/docs/guides/secure-video-playback)). Requests after `exp` are denied even mid-playback, so `exp` must outlast the video.
- Mux says it uses multiple CDNs ([blog copy](https://plushcap.com/content/mux/blog/mux-multi-cdn-support-in-mux-video-for-improved-performance-and-reliability), search result). I found no India edge data.
- The docs I opened do not explain how a file is assigned to the 720p tier, beyond [saying a lower capture resolution costs less](https://www.mux.com/docs/guides/control-recording-resolution). Confirm this before relying on 720p rates.

### 2.7 Bunny Stream

- From the [pricing docs](https://bunny.net/docs/stream/pricing): storage $0.01/GB in the default Frankfurt region, plus $0.01 for a second region and $0.005 for each further one. Replication cannot be removed once enabled.
- Standard delivery: **Asia & Oceania $0.030/GB**. India is not named, and I am treating it as Asia [inferred]. Volume tier: $0.005/GB.
- **Do not plan on the Volume rate for India.** [Bunny's network page](https://bunny.net/network/) lists PoPs in Bangalore, Chennai, Kolkata, Mumbai and New Delhi, and marks none as Volume. In Asia only Hong Kong, Singapore and Tokyo are Volume.
- Standard encoding is free. Premium Encoding is $0.05/min at 720p and 1080p. Storage is billed on everything encoding generates, not just the upload. MediaCage Enterprise DRM is $99/month per library plus $0.005 per license. $1 monthly minimum.
- Embed token: `SHA256_HEX(token_security_key + video_id + expiration)` with `token` and `expires` parameters ([docs](https://bunny.net/docs/stream/token-authentication)). CDN token authentication is a separate layer ([docs, search result](https://docs.bunny.net/cdn/security/token-authentication)).
- Storage in Mumbai is listed as "Planned". Singapore, Tokyo and Hong Kong exist ([storage pricing](https://bunny.net/pricing/storage/)).

### 2.8 Vimeo and YouTube

**YouTube unlisted is unsuitable for private corporate training:**
- Anyone with the link can view and reshare, and no Google account is needed ([YouTube Help](https://support.google.com/youtube/answer/157177)). There is no real access control.
- The terms allow viewing for "personal, non-commercial use", and YouTube may show ads and alter or discontinue the service ([terms](https://www.youtube.com/t/terms), effective 2022-01-05). Whether staff training fits that is a legal question, not one I can settle.
- Many offices block YouTube, and an embedded player gives you far less control than your own `<video>` element [inferred].

Acceptable only for public, non-confidential content, such as an external generic explainer.

**Vimeo is not recommended, and I could not verify its pricing.** [vimeo.com/pricing](https://vimeo.com/pricing) and [/upgrade-plan](https://vimeo.com/upgrade-plan) returned no plan content to my fetch, and third-party sources conflict on plans and prices ([search result](https://livid.com/blog/vimeo-price-increase-2026-a-complete-breakdown-of-the-new-plans-and-forced-upgrades/)). It does offer domain restriction on paid plans, up to 50 domains ([Vimeo](https://vimeo.com/product/domain-restricted-video-privacy), [help, search result](https://help.vimeo.com/hc/en-us/articles/30030693052305-How-do-I-set-up-domain-level-privacy)). Third parties report a 2 TB monthly cap on self-serve plans ([search result](https://swarmify.com/blog/vimeo-pricing-bandwidth-limits/)). Domain restriction limits where a video embeds, but it does not tie playback to a specific employee [inferred]. I left it out of the cost model because I have no verified price.

---

## 3. Worked cost model

### 3.1 Assumptions

- 500 employees, 40 videos, 6 minutes each, 720p.
- **1.2 GB/hour**, which is 120 MB per video and 2.67 Mbps (1.2 × 10⁹ × 8 ÷ 3,600). For context, YouTube's recommended 720p SDR upload bitrate is [5 Mbps](https://support.google.com/youtube/answer/1722171?hl=en). 1.2 GB/hour suits talking-head and screen-capture content [inferred].
- Every employee watches everything once a year, plus 20% re-watch.
- USD/INR **₹95**. The market rate was [94.915 on 30 Oct 2026, October average 95.474](https://www.valutafx.com/history/usd-inr-2026). This is a third-party rate, not the RBI reference rate, which I could not find for October.
- Viewing is spread evenly over 12 months for the base case. Section 3.3 shows the more realistic single-month compliance push.
- Adaptive services can deliver less than 720p on weak links. I use 1.2 GB/hour for all, so per-GB options are upper bounds.
- Buffered-but-unwatched data is ignored. Real egress runs somewhat higher [inferred].

### 3.2 Base quantities

| Quantity | Arithmetic | Result |
|---|---|---|
| Library duration | 40 × 6 min | 240 min (4 hours) |
| Stored | 4 hours × 1.2 GB | **4.8 GB** |
| Watched per year, first pass | 240 min × 500 | 120,000 min |
| With 20% re-watch | 120,000 × 1.2 | 144,000 min/year (2,400 hours) |
| Delivered per year | 2,400 hours × 1.2 GB | 2,880 GB/year |
| **Delivered per month** | 2,880 ÷ 12 | **240 GB/month** |
| **Minutes per month** | 144,000 ÷ 12 | **12,000 min/month** |
| Plays per month | 40 × 500 × 1.2 ÷ 12 | 2,000 plays/month |

### 3.3 Monthly cost, one tenant

Supabase figures are marginal cost on a project already paying for Pro.

| Option | Storage | Delivery | Base case (even spread) | Peak (2,880 GB in one month) |
|---|---|---|---|---|
| Supabase Pro, cached | 4.8 GB within 100 GB = $0 | 240 within 250 GB = $0 | **$0** (₹0) | (2,880 − 250) × $0.03 = **$78.90** (₹7,495) |
| Supabase Pro, uncached | $0 | 240 within 250 GB = $0 | **$0** (₹0) | (2,880 − 250) × $0.09 = **$236.70** (₹22,486) |
| Cloudflare R2 | 4.8 within 10 GB free = $0 | $0 egress. About 20,000 Class B requests, within free tier [inferred: 10 requests per play] | **$0** (₹0) | **$0** |
| AWS S3 + CloudFront pay-as-you-go | 4.8 × $0.025 = $0.12 | 240 GB within 1 TB free = $0 | **$0.12** (₹11) | $0.12 + (2,880 − 1,024) × $0.109 = **$202.42** (₹19,230) |
| Mux 720p, before $20 credit | 240 × $0.0024 = $0.58 | 12,000 within 100,000 free = $0 | **$0.58** (₹55) | $0.58 + 44,000 × $0.0008 = **$35.78** (₹3,399) |
| Bunny Stream, Standard, Asia | 9.6 GB × $0.01 = $0.10 [inferred: renditions double storage] | 240 × $0.03 = $7.20 | **$7.30** (₹693) | $0.10 + 2,880 × $0.03 = **$86.50** (₹8,217) |
| CloudFront Pro flat-rate + S3 | 4.8 GB within 50 GB credit | Within 50 TB | **$15.00** (₹1,425) | **$15.00** |
| Cloudflare Stream | 1,000-minute block = $5 | 12,000 ÷ 1,000 × $1 = $12 | **$17.00** (₹1,615) | $5 + 144 = **$149.00** (₹14,155) |

Notes:
- All-in Supabase includes the $25 Pro plan, and compute depends on instance size ([worked examples](https://supabase.com/docs/guides/platform/manage-your-usage/egress)).
- Without the 1 TB always-free tier, CloudFront delivery alone would be 240 × $0.109 = $26.16/month.
- One-time HLS encoding with MediaConvert in Mumbai: a three-rung ladder costs 240 × ($0.015 + $0.0075 + $0.0075) = **$7.20 once** (₹684). That assumes 720p counts as HD and lower rungs as SD [inferred].
- R2 and pay-as-you-go S3 + CloudFront deliver a single MP4 in this model. They have no adaptive bitrate.

### 3.4 Sensitivity: several tenants on one account

Supabase quotas are per organisation, so this is the table that decides the switch. It assumes identical tenants with their own content, base-case spread, and no other egress on the project. That last assumption flatters Supabase, because API traffic also uses the uncached quota.

| Option | 1 tenant | 5 tenants (1.2 TB/mo) | 20 tenants (4.8 TB/mo) |
|---|---|---|---|
| Supabase, cached | $0 | $28.50 | $136.50 |
| Supabase, uncached | $0 | $85.50 | $409.50 |
| Mux 720p | $0.58 | $2.88 | $123.52 |
| Bunny Stream | $7.30 | $36.48 | $145.92 |
| Cloudflare Stream | $17.00 | $70.00 | $265.00 |
| S3 + CloudFront pay-as-you-go | $0.12 | $19.78 | $413.98 |
| CloudFront Pro flat-rate + S3 | $15.00 | $15.00 | $16.15 |
| Cloudflare R2 (no adaptive bitrate) | $0 | $0.21 | $1.29 |

**Delivery normalised to $/GB at 1.2 GB/hour:**

| Option | Effective rate |
|---|---|
| R2 | $0 |
| Bunny, Asia | $0.03 |
| Supabase cached, overage | $0.03 |
| Mux 720p | $0.04 (0.0008 × 60 ÷ 1.2), after the free 100,000 min (about 2 TB) |
| Cloudflare Stream | $0.05 (0.001 × 60 ÷ 1.2) |
| Supabase uncached, overage | $0.09 |
| CloudFront India | $0.109, after 1 TB free |

**Mux vs Bunny crossover:** Mux costs about $10.18 per tenant per month past the free allowance, and Bunny about $7.30. The $80 free allowance is used up at 80 ÷ (10.18 − 7.30) ≈ **28 tenants**, or about 35 with the $20 credit [inferred].

Two findings stand out:
- Supabase cached overage matches Bunny's India rate, so cost alone does not force a move if the cache hit rate is good. The hit rate and the lack of adaptive bitrate do.
- At high volume, a flat-rate CDN beats every per-unit service by a wide margin, at the price of running your own pipeline.

---

## 4. Upload path

### 4.1 Why the browser must upload directly

Vercel Functions cap request and response bodies at **4.5 MB**, and larger requests get `413: FUNCTION_PAYLOAD_TOO_LARGE` ([limits](https://vercel.com/docs/functions/limitations), updated 2026-08-24). Vercel's own advice is to upload directly to storage rather than proxying through a function ([guide](https://vercel.com/kb/guide/how-to-bypass-vercel-body-size-limit-serverless-functions)).

- One 120 MB video is about 27 times that limit.
- Supabase's mandatory 6 MB TUS chunk is itself over 4.5 MB, so you cannot proxy even a single chunk through a Next.js route [inferred].
- A Next.js route should only authorise and issue a token.

### 4.2 TUS with Supabase

From the [resumable uploads guide](https://supabase.com/docs/guides/storage/uploads/resumable-uploads):
- **Endpoint:** `https://<project-id>.storage.supabase.co/storage/v1/upload/resumable`. The direct storage hostname is recommended for large uploads.
- **Chunk size:** must be exactly 6 MB ("for now").
- **Auth:** `authorization: Bearer <access_token>`, plus `apikey` in the Uppy example.
- **Upload URL lifetime:** up to 24 hours, after which the upload restarts.
- **Concurrency:** one client per upload URL, others get `409 Conflict`.

**A signed upload token works with TUS, yes.** Call `createSignedUploadUrl` and send the token in `x-signature`, per the same guide. The guide's tus-js-client sample only shows the Bearer form. The signed form uses a different endpoint with a `/sign` suffix and no `Authorization` header:
- Supabase's acceptance test `uploads through the signed TUS endpoint without an authorization header` in [tus.test.ts](https://github.com/supabase/storage/blob/master/acceptance/specs/tus.test.ts).
- Server allow-list includes `x-signature` in [tus/index.ts](https://github.com/supabase/storage/blob/master/src/http/routes/tus/index.ts).
- Supabase's [signed Uppy example](https://github.com/supabase/supabase/tree/master/examples/storage/resumable-upload-signed-uppy) uses `/storage/v1/upload/resumable/sign` with `x-signature` (read in `index.html`).

Sketch adapted from those sources. I have not run it against a project [inferred]:

```ts
// Server (after your own auth check): createSignedUploadUrl(path) → { token }
const upload = new tus.Upload(file, {
  endpoint: `https://${projectId}.storage.supabase.co/storage/v1/upload/resumable/sign`,
  chunkSize: 6 * 1024 * 1024,
  retryDelays: [0, 3000, 5000, 10000, 20000],
  headers: { 'x-signature': token },
  metadata: { bucketName, objectName, contentType: 'video/mp4', cacheControl: '31536000' },
  removeFingerprintOnSuccess: true,
  uploadDataDuringCreation: true,
})
```

Things to get right:
- Signed upload URLs are [valid for 2 hours](https://supabase.com/docs/reference/javascript/storage-from-createsigneduploadurl). If a slow upload outlives the token, expect to fetch a new one and resume [inferred]. Test it.
- The signed route suits you whether or not end users hold Supabase Auth JWTs, because your server decides who may upload.
- Do not copy the project's allow-all table RLS pattern to this bucket. Keep it private, with a bucket-level size limit and `video/mp4` as the allowed type ([scaling tips](https://supabase.com/docs/guides/storage/production/scaling)) [inferred on the RLS advice].
- Use immutable paths such as `<tenant>/<video-id>/v1.mp4`. Smart CDN invalidates on change, but browsers can keep their own copies, and the docs advise a new path for updated assets ([Smart CDN](https://supabase.com/docs/guides/storage/cdn/smart-cdn)).

---

## 5. Completion tracking

### 5.1 How real systems do it

| System | Approach | Source |
|---|---|---|
| Panopto | 100 segments per video. At least 1 second watched in a segment earns 1%. Highest percentage is kept. LMS grade posts about 3 hours after launch | [U. Alabama](https://bama.atlassian.net/wiki/spaces/CIT/pages/3074392099/How+does+Panopto+grade+the+percentage+of+the+video+the+students+viewed) |
| Panopto SCORM export | A user reports completion fixed at 90% watched, with no setting to change it | [community post, a feature request not documentation](https://community.panopto.com/discussion/2706/scorm-ability-to-change-the-watched-to-gain-completion-in-lms) |
| Kaltura | Per-user completion is total percentage watched across sessions, excluding repetitions. 20 then 30 minutes of the same start of a 1-hour video = 50% | [search result, Kaltura user analytics](https://knowledge.kaltura.com/help/user-analytics) |
| Kaltura | Prevent-seek plugin: forward seek past the furthest point, or all seeking. Drexel's guide warns "No seeking forward might be bypassed by technical means" | [Kaltura, search result](https://knowledge.kaltura.com/help/prevent-forward-seeking), [Drexel](https://support.cci.drexel.edu/remote-conferencing-and-class-capture/recording-video-computer-and-adding-bb-learn-aka-screen-record/kaltura-drexel-streams/kaltura-drexel-streams-quizzes-videos/) |
| Moodle Video Time | Completion on view time, watch percentage or video finish, all Pro-only. "Prevent fast forwarding" option | [completion settings](https://intercom.help/bdecent/en/articles/11137910-completion-conditions-settings-of-the-video-time-activity), [Moodle docs, search result](https://docs.moodle.org/401/en/VideoTime_pro_version_advanced_doc) |
| Moodle FastPix | Coverage of unique seconds, not playhead, default 90%. Optional no-seek. Skipping ahead does not count | [Moodle docs, search result](https://docs.moodle.org/en/mod_fastpix), [vendor blog](https://fastpix.com/blog/video-completion-tracking) |
| Moodle Video Tracker | Percentage and last position, with anti-skip only in Pro | [marketplace](https://marketplace.moodle.com/plugins/mod_videotracker) |
| Plain Moodle page | Completion on view "won't tell you if the user really watched" | [forum, search result](https://moodle.org/mod/forum/discuss.php?d=370362) |
| Cornerstone | I found no public documentation of native video watch-percentage controls. Panopto connects through SCORM, so only completion reaches Cornerstone, and watch time and drop-off stay in Panopto | [Panopto](https://www.panopto.com/integrations/cornerstone/) |

The pattern across products: **unique coverage of the timeline, a threshold near 90%, keep the highest value, and optional forward-seek restriction**.

### 5.2 Recommended design [inferred, built from the sources below]

**Client:**
- Use `video.played`, a [`TimeRanges` of what actually played](https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/played). Unlike `currentTime`, it does not reward scrubbing.
- `timeupdate` fires at [about 4 to 66 Hz depending on load](https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/timeupdate_event), so use it for UI and restrictions, not as a counter.
- Treat `played` as helpful, not perfect. One [Firefox report](https://support.mozilla.org/it/questions/938680) (search result, a single old anecdote) shows it stopping updating after a skip and replay. Merge server-side and keep your own range tracking as a backup.
- Heartbeat every 10 to 15 seconds with session ID, video ID, new ranges, position, `playbackRate` and visibility.
- On `visibilitychange` to hidden, flush with `navigator.sendBeacon`. MDN calls this [the most reliable way](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/sendBeacon) to send end-of-session analytics, and `unload` and `pagehide` are unreliable on mobile. The payload limit is about 64 KiB.
- Timers are [throttled in background tabs, though tabs playing audio are exempt](https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API). So a video can keep running in a hidden tab. Decide on purpose whether to pause when hidden. MDN's own example does exactly that.

**Server (a Next.js route, the only place credit is granted):**
- Store coverage as fixed 5-second buckets per user and video, not one float. Bucket data is idempotent and merges easily across devices.
- On each heartbeat: `credit = min(new unique seconds claimed, (now − last_heartbeat) × max_rate + slack)`.
- Cap `max_rate` at the fastest speed you allow. Reject anything above it. [`playbackRate` is client-controlled](https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/playbackRate).
- Set session rules: one active session per user and video, so one person cannot run parallel tabs for credit.
- Complete when coverage reaches 90% or more, and the server-side wall-clock total is plausible against the stored duration.
- Never lower completion once reached. Write completion once, with timestamp and video version, for the audit trail.
- Store duration server-side, and do not trust a duration sent with a heartbeat.

**Seek restriction:** on `seeking`, if the target is past the furthest watched point plus a small tolerance, snap back. Allow it per course, for compliance content only. Keep this as a UX control, not a security control.

### 5.3 SCORM's limits

- `cmi.progress_measure` (0 to 1) exists only in **SCORM 2004**. There is no `cmi.progress` element, and SCORM 1.2 has no progress measure at all ([reference](https://scorm.com/scorm-explained/technical-scorm/run-time/run-time-reference/)).
- SCORM 1.2 offers `lesson_status`, `session_time`, `lesson_location` (255 characters) and `suspend_data` (4,096). SCORM 2004 3rd and 4th editions allow 64,000 for `suspend_data` (same source).
- All of it is set by JavaScript in the learner's browser. A Storyline thread describes a learner forcing completion and a high score through developer tools, with the poster accepting that absolute prevention may not be possible ([search result](https://community.articulate.com/discussions/exchange/preventing-learners-from-forcing-completionscore-via-browser-developer-tools-in-/1249006)).

A SCORM wrapper around video therefore gives weaker evidence than the server-side design above.

### 5.4 What cannot be proven client-side

- That a person was present, watching, or paying attention. Coverage proves a player ran for long enough, at best [inferred].
- That the client is genuine. A script can send well-formed heartbeats at real-time pace. The wall-clock cap only forces cheating to take as long as watching [inferred].
- That the logged-in employee is the one watching.

For compliance training, say this plainly to buyers: the record shows the video played in that session. Add a short **quiz** and a signed **attestation** at the end, because only those are evidence of understanding or acceptance. Kaltura's quiz features combine no-seek with graded questions ([search result](https://knowledge.kaltura.com/help/kaltura-video-quiz)). Drexel's guide warns that seek blocking can be bypassed and advises "1-3 questions throughout the video that are REQUIRED" ([Drexel](https://support.cci.drexel.edu/remote-conferencing-and-class-capture/recording-video-computer-and-adding-bb-learn-aka-screen-record/kaltura-drexel-streams/kaltura-drexel-streams-quizzes-videos/)).

---

## 6. Poster and duration in the browser, and format rules

### 6.1 Poster and duration: yes, no transcoding service needed

For the admin's file before upload:

1. `video.src = URL.createObjectURL(file)`, `muted`, `playsInline`, `preload="metadata"`.
2. On `loadedmetadata`, read `duration`, `videoWidth` and `videoHeight`. [`duration` is `NaN` until metadata is known](https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/duration).
3. Set `currentTime` to about 1 second or 10% of the duration.
4. On `seeked`, `drawImage` to a canvas. [`drawImage` accepts a video once `readyState` is above 1](https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/drawImage), and MDN's pattern is to draw in the `seeked` handler.
5. `canvas.toBlob()` as JPEG, and upload the poster beside the video.

**CORS:** reading back a canvas that drew cross-origin media without CORS approval [throws `SecurityError`](https://developer.mozilla.org/en-US/docs/Web/HTML/How_to/CORS_enabled_image) in `toBlob`, `toDataURL` and `getImageData`. A blob URL from a local file is same-origin, so this does not apply before upload [inferred]. If you ever capture from a stored file, set `crossOrigin="anonymous"` before `src`. My test showed `access-control-allow-origin: *` on a public Supabase object [tested], but I did not test a signed URL.

**Where this fails:**
- If the browser cannot decode the file, for example HEVC on some machines, you get an `error` event or no `loadedmetadata`. Treat this as a validation failure [inferred].
- `seeked` may show a black or fade-in frame. Let the admin pick another time or upload a poster [inferred].
- [`requestVideoFrameCallback`](https://developer.mozilla.org/en-US/docs/Web/API/HTMLVideoElement/requestVideoFrameCallback) (Baseline 2024) helps with frame timing but needs feature detection and gives no strict guarantees.
- The duration comes from the client, so the upload step could be falsified. An admin is trusted, but consider re-checking at first playback [inferred].

### 6.2 What plays natively

| Format | Support | Source |
|---|---|---|
| **MP4, H.264 + AAC** MDN calls it "a broadly-supported combination" across every major browser | [MDN codecs](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Formats/Video_codecs) |
| WebM, VP9 | VP9 listed for all versions of Chrome, Edge, Firefox, Opera and Safari | same |
| AV1 | Safari only on M3 Macs, iPhone 15 Pro and iPhone 16 onwards | same |
| HEVC (H.265) | Fragmented: hardware and OS conditions, with Windows needing extensions in some browsers | same |
| MOV | MDN lists QuickTime as supported only by older Safari and plugin-era browsers | [MDN containers](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Formats/Containers) |

Firefox's H.264 support depends on OS codecs (MDN codecs). Commercial H.264 use has licensing terms, though the Via LA pool charges no fees for streaming internet video free to end users. Check whether internal paid-SaaS delivery fits (MDN codecs).

### 6.3 What to enforce at upload with no transcoding pipeline

**Enforce:**
- Container MP4, video `avc1` (H.264), audio AAC.
- `moov` before `mdat` (faststart). YouTube's own spec asks for [moov at the front](https://support.google.com/youtube/answer/1722171?hl=en), and without it the browser must fetch the end of the file before it can start [inferred].
- 8-bit 4:2:0, at most 1080p, and a bitrate ceiling near 3 to 5 Mbps. These numbers are my judgement [inferred].
- A file-size guard, for example `duration × 5 Mbps`.

**How to check in the browser:**
- `file.type` is not enough, and [`canPlayType` may answer "maybe"](https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/canPlayType).
- Passing playback on the admin's machine proves little, because Safari may play what Chrome on a learner's PC cannot [inferred].
- Parse the file: [mp4box.js](https://github.com/gpac/mp4box.js) (BSD-3-Clause, active October 2026) or [Mediabunny](https://mediabunny.dev/guide/introduction), which reads the codec directly and only reads what it needs (search result). Reading only the header is cheap.

**The common failure will be iPhones.** Apple [recommends HEIF/HEVC capture](https://support.apple.com/en-us/116944), so a phone video is likely a HEVC `.mov`. Tell the admin exactly what to do: Settings > Camera > Formats > Most Compatible, or export from HandBrake or similar.

**Optional later:** Mediabunny supports [faststart MP4 output](https://mediabunny.dev/guide/introduction) and WebCodecs-based conversion in the browser (search result). That could fix bad files with no server, but it is unproven here.

---

## 7. SCORM and xAPI

**Is SCORM expected of a corporate LMS? Yes, among direct competitors.**
- Zoho People's LMS [supports SCORM 1.2 and 2004 4th Edition](https://help.zoho.com/portal/en/kb/people/administrator-guide/learning-management-system-lms/courses-in-lms/articles/scorm-compliance).
- Keka Learn runs SCORM 1.2 and 2004 ([search result](https://help.keka.com/hc/en-us/articles/44657473285649-LEARN-SCORM-Support-V1-Foundations)), and another Keka article lists xAPI and cmi5 ([search result](https://help.keka.com/hc/en-us/articles/44621482047633-Creating-a-course-using-SCORM)).
- Darwinbox: I found no document confirming native SCORM. Its marketplace lists [LMS integrations including one powered by Docebo](https://marketplace.darwinbox.com/en-US/apps/417537/darwinbox-lms-(powered-by-docebo)), and its blog says an enterprise LMS should support SCORM and xAPI ([search result](https://darwinbox.com/blog/10-best-learning-management-systems-lms-enterprise-hr)).
- Rustici, a SCORM vendor with an interest here, says 1.2 [should be the minimum, and 2004 is less common](https://scorm.com/scorm-explained/scorm-resources/what-to-ask-about-scorm-in-an-rfp).
- Indian POSH vendors sell SCORM packages, including [eLearnPOSH](https://elearnposh.com/) and [CogniSpark](https://www.cognispark.ai/?p=137893) (search results, vendor claims). This is the most likely route for a request to reach EZER [inferred].

**Evidence gaps:** I found **no survey giving a percentage of buyers who require SCORM** in 2025 or 2026. The Learning Guild's [2022 report](https://www.learningguild.com/insights/289/2022-the-state-of-xapi-adoption) is gated.

**Standards usage:**
- SCORM Cloud imports in 2020: SCORM 1.2 56.3%, AICC 31.6%, xAPI 1.4%, cmi5 0.2% ([xAPI.com](https://xapi.com/blog/an-exciting-time-to-watch-xapi-and-cmi5-adoption-numbers/), a vendor's own data from 2020).
- A 2019 Guild survey of 535 said 63% were interested in or experimenting with xAPI ([search result](https://www.learningguild.com/research/2019-the-state-of-xapi-adoption)). Interest is not use.

**Build cost:**
- Runtime: [scorm-again](https://github.com/jcputney/scorm-again) is MIT-licensed, active in October 2026, and covers SCORM 1.2 and 2004 ([search result](https://www.npmjs.com/package/scorm-again) for scope).
- Bought: Rustici Engine has no public pricing. An old forum post quotes $30,000+ per year ([search result](https://forums.livecode.com/viewtopic.php?p=177666), treat as dated). SCORM Cloud is listed from about $40 to $1,100/month ([Capterra, search result](https://www.capterra.com/p/128021/SCORM-Cloud/pricing/)), with sources disagreeing on the entry tier.
- My estimate for SCORM 1.2 import on this stack is **2 to 4 engineer-weeks** [inferred, no published benchmark found]: unzip, parse `imsmanifest.xml`, launch, map `cmi.*` to the database, and test against real packages.

**A specific blocker on this stack:** Supabase Storage deliberately [serves HTML as plain text](https://supabase.com/docs/guides/storage/quickstart), and setting the content type does not change that ([CLI issue, search result](https://github.com/supabase/cli/issues/4396)). Unzipped SCORM courses are HTML, and the content needs access to the LMS API object from its frame. So you cannot just unzip into a bucket. You would need to serve via a proxy route or another host, or use scorm-again's cross-frame option ([search result](https://cdn.jsdelivr.net/npm/scorm-again@3.0.4/README.md)) [inferred on the design].

**Verdict:**

| Item | Value at MVP | Cost | Decision |
|---|---|---|---|
| Native video, quiz, attestation | High | Low | Build now |
| SCORM 1.2 import | Medium, and blocks a deal only when a buyer owns content | 2 to 4 weeks [inferred] | Defer, build on first real demand |
| SCORM 2004 | Low | Extra sequencing work [inferred] | Defer further |
| xAPI / cmi5 | Low | LRS-level work [inferred] | Skip |

Say in sales material: "SCORM import on the roadmap". If a deal depends on it, SCORM Cloud is a stop-gap to evaluate [inferred].

---

## 8. Migration path

Keep the switch cheap by doing these from day one [inferred]:
- Use a native `<video>` element. HLS later runs through [hls.js and MSE, with native HLS in Safari and iOS](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Audio_and_video_delivery/Live_streaming_web_audio_and_video), and `played`, `timeupdate` and `seeking` keep working. All tracking code survives.
- Store `provider`, `provider_asset_id`, `duration_seconds` and `poster_path` on the video row, never a raw URL.
- Hide URL generation behind one server function, `getPlaybackSource(videoId, userId)`.
- Route every playback through a server call, so a per-tenant or per-video provider flag is enough to migrate gradually.
- Log video egress per tenant, so the triggers in section 1 are measured and not guessed. Supabase Logs Explorer shows requests by cache status ([bandwidth docs](https://supabase.com/docs/guides/storage/serving/bandwidth)).

---

## 9. Limits of this research

**Not verified:**
- Live Range behaviour on a signed URL in a private bucket, and on files above 5 MB.
- Whether a cache miss bills whole-object fill or only the bytes returned to the client.
- Current `supabase.co` reachability from Jio and Airtel in November 2026.
- Whether TUS works through a Supabase custom domain.
- Mux's India edge coverage and how its 720p tier is assigned.
- Which Bunny tier a new Stream library starts on.
- Vimeo's current prices.

**Source problems:**
- Pages blocked to my fetch (403 or truncated), so used only through search summaries: Moodle docs, Keka help, Kaltura knowledge base articles, Articulate forums and TrustRadius.
- I discarded a search result citing India mobile speed of 39.94 Mbps as 2026 data. The article turned out to be from June 2023.
- Bunny's storage page is inconsistent on two-region pricing ([page](https://bunny.net/pricing/storage/)). I used the Stream docs' figures.
- Supabase, Mux and Bunny pricing pages carry no last-updated date, so "read on 2026-11-01" is the only date available. Mux states its list rates can change.
