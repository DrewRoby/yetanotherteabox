# Photo capture, vision suggestions & auto-intake — design

Status: **draft for review (2026-11-20)**. Nothing here is built yet. It replaces the
"computer-vision stub" in the original build docs with a concrete plan. Read with
root `CLAUDE.md`. The parts that matter most here are the one-active-role rule,
`resolveIntakeAccountId`, the SKU/`itemNumber` invariant and the offline-first
Phase 3 direction.

## 1. What the original docs asked for

From `Docs/InitialBuild/` (the full list of references is in §11):

- A camera is mounted at the intake desk. "Capture Item" takes **three guided photos**:
  front, back, and a close-up of the label or tag (`app_flow_document.md`).
- The photos upload to the **local** server. When the shop is online they're queued for
  **cloud vision**, which suggests brand, style, serial number and other common
  metadata. A notification says when suggestions are ready. The clerk reviews and
  edits them, then saves (`app_flow_document.md`, `tech_stack_document.md`).
- **The cloud is optional.** Vision needs internet in v1, and running it offline is out
  of scope. Anything that needs the cloud is queued and sent later
  (`project_requirements_document.md`, `app_flow_document.md`).
- **Wrong matches get a human review queue** (`project_requirements_document.md` risks).
- **AI price suggestions are out of scope** (`project_requirements_document.md`).
- Suggested provider: Azure Computer Vision or a self-hosted YOLO model. Storage:
  a `photos(item_id, url, source)` table, `POST /api/items/:id/photos`, and
  photos kept in blob storage.

**What's built today** is a placeholder. `server/src/adapters/cv.ts` returns one of
four made-up suggestions at random. The Intake page's "Capture Image" button sends
the string `"local-capture-stub"`, with no camera involved. A `Photo` model exists,
but nothing writes to it except an unused `photoUrl` field on `POST /items`.

## 2. What the real intake data says

These numbers come from the dev DB (`dist-bin/teabox.db`, Hidden Treasures' data
migrated from Liberty), over the last 365 days:

| | |
|---|---|
| Items taken in | **44,748** over 263 intake days, about **170 per day** (peaks are higher) |
| Median tag price | **$6.00** |
| Category | 10 categories in use. **78% are "Other"**, then Antiques & Collectibles 14% and Home Accents 6% |
| Subcategory (the real department) | `LADIES` 50%, `MENS` 9%, then GL, Jewelry, KITCHEN, BO, HO, Decorative, … |
| `brand` field filled | 69%, but it holds the **item type**: "Top", "Pants", "Active Wear", "Slipper" |
| `description` | Usually the **actual brand** plus a short note: "Old Navy, as is", "TALBOTS", "Adidas, pants", "Sea Scape by Linda Abernathy" |
| `size` filled | 65% ("S", "M", "24", "8") |
| `condition` | Never filled |

Three things follow from this, and they shape the whole design:

1. **Speed matters more than detail.** At $6 an item and 170 items a day, a clerk can
   spend about 20–30 seconds per item. Vision is only worth having if it makes intake
   *faster*. Richer data that takes longer to enter is a net loss. The design keeps
   the camera optional, never blocks saving, and never makes a clerk wait for the model.
2. **The shop's field conventions aren't Teabox's field names.** In Liberty, "Brand" was
   a general attribute that clerks used for the item type, and the actual brand went
   in the description. The vision model has to fill in the fields the way *this shop*
   uses them, or every suggestion has to be retyped. §5.3 handles this with a per-store
   field map. Whether to clean up the convention itself is a question for Sherry
   (§10).
3. **The categories are coarse; the subcategory carries the information.** The model
   should choose from the store's actual subcategory list rather than invent a
   taxonomy, and needs to make good guesses for "Other".

## 3. Goals and non-goals

**Goals**

- Real photos at intake, stored locally, shown wherever someone has to identify an
  item: item detail, the tag batch, Print Queues and the **POS cart**. Seeing the
  photo at the register stops tag swapping, which is worth having even without AI.
- Suggestions that pre-fill description, item type, subcategory, category and size,
  plus serial number and condition when they're visible. Delivered without making
  anyone wait, never overwriting what the clerk has typed, and highlighted until
  confirmed.
- **Auto-intake:** photograph a whole drop-off quickly, let suggestions fill in
  in the background, then review, price and save the batch as a grid. Tags print in
  one batch at the end.
- Everything works with no internet connection. Vision is an optional add-on.
- Measured accuracy and cost, so the model choice is based on real items, not guesses.

**Non-goals (for now)**

- Price suggestions from AI (out of scope in the PRD). §8 Phase D proposes a
  *non-AI* price hint based on the shop's own sales history instead.
- Running vision offline on the shop's PC. The adapter interface leaves room for it later.
- Marketplace listings or cross-store photo sync. Photos go to the cloud only through
  the Phase 2 disaster-recovery backup.
- A server-side camera "device adapter". Like the USB barcode scanner, the camera is a
  browser input, so no device integration is needed.

## 4. Capture

### 4.1 Hardware and the browser's secure-context rule

Browsers only allow live camera access (`getUserMedia`) on **secure contexts**:
HTTPS or `localhost`. Teabox serves plain HTTP and binds to `127.0.0.1` by default.
So:

| Setup | Works? | How |
|---|---|---|
| USB webcam on the PC running Teabox | ✅ | `http://localhost` counts as secure, so the live view in the browser works. `BarcodeScanner.tsx` already uses `getUserMedia` the same way. |
| Phone or tablet on the shop Wi-Fi, plain HTTP | ⚠️ no live view | Needs `HOST=0.0.0.0` (or the LAN IP). A **file input with `capture="environment"`** still works over HTTP: it opens the phone's own camera app and returns the photo. This is one tap more per photo, with no in-page viewfinder. |
| Phone or tablet over HTTPS | ✅ | Needs the TLS reverse proxy that `config.env.example` already says is required before exposing Teabox on the LAN. It's an open item on the Phase 0 roadmap. |

**Recommendation:** build one `PhotoCapture` component that uses the live view when
`window.isSecureContext` is true and falls back to `<input type="file"
accept="image/*" capture="environment">` when it isn't. Both paths produce the same
`Blob`, so the rest of the pipeline doesn't care which one was used.

### 4.1a Which camera (decided 2026-11-20, pending a hands-on test)

**A USB camera on the PC that runs Teabox**, so the live view works over `localhost`
with no TLS. If intake happens at a *different* PC than the one running Teabox, the
HTTPS requirement in §4.1 applies again.

- **Prefer a document camera to a face webcam.** Document cameras are the overhead-arm
  cameras teachers use (IPEVO, Elmo and others, ~$100–200). They show up as an
  ordinary UVC webcam, so `getUserMedia` works unchanged.
  - They're built to focus close up on text, which is what reading a care label
    needs. Face webcams such as the Logitech Brio are tuned for a face at arm's length,
    and reviews report autofocus hunting on close objects. The MX Brio does allow
    manual focus, so it's a workable fallback if mounted on a stand.
  - The arm fixes the framing: the same top-down view and distance every time. That
    helps the vision model, and later a local classifier (§5.3a), far more than extra
    resolution.
- **Lighting and background matter more than the camera.** Use two diffused LED
  panels, or a small light tent, and a plain neutral mat. Dim, uneven shop light
  hurts label reading more than anything else in the setup.
- **Test before standardizing.** Buy one camera and photograph ~20 real items,
  labels included. Published specs didn't give minimum focus distances for the
  models looked at, so this has to be checked by hand.
- Items too big for the arm (furniture, lamps, framed art) use the phone or
  file-upload path.
- **Capture stills at full sensor resolution where the browser allows it:**
  `ImageCapture.takePhoto()` in Chromium, falling back to a canvas grab of the video
  frame. Then downscale as in §4.3.

### 4.2 Guided shots

The default is **one shot**, with label and back as optional extras. The docs asked
for three required shots (front, back, label), but at 170 items a day a required back
shot doesn't pay for itself. The **label close-up** is the shot that improves
suggestions (brand, size, material). Each photo gets a role: `FRONT`, `LABEL`, `BACK`,
`DETAIL` (damage, signature, maker's mark) or `OTHER`. Keyboard shortcuts: Space
captures, `L` takes a label shot, Enter goes to the next item. These are needed for
a desk workflow.

### 4.3 Image processing (in the browser, before upload)

- Downscale to **1600 px on the long edge** and save as JPEG at quality ~0.85.
  That's about 200–350 KB per photo, sharp enough to read a care label, and within
  what the model accepts without its own downscaling. Also make a **320 px thumbnail**
  for lists, cart rows and tags.
- Correct the rotation using the photo's EXIF orientation, then strip the EXIF data.
  Phones embed GPS coordinates, and those shouldn't be stored.
- Upload the photo straight away, while the clerk keeps working (§5.1).

## 5. Architecture

```
browser                        teabox server (local)                    optional cloud
───────                        ─────────────────────                    ──────────────
PhotoCapture ──POST /photos──▶ save file → Photo row (itemId null,
                               draftId set)
             ──POST /vision/jobs ▶ VisionJob QUEUED ──worker (in-process)──▶ Claude API
             ◀─GET /vision/jobs/:id (poll 1s)─── DONE: suggestion JSON ◀──── (structured output)
Intake form / Draft grid
             ──POST /items {…, photoIds, visionJobId}──▶ Item + attach photos
                               + record accepted/edited per field
```

### 5.1 Photo storage

- **Files on disk, not in SQLite.** Store them in a `photos/` folder next to
  `teabox.db`, using the same rules as everything else: the portable folder beside
  the `.exe` on Windows, `~/.local/share/teabox/photos/` on Linux,
  `server/var/photos/` in dev. Layout: `photos/<yyyy>/<mm>/<photoId>.jpg` plus
  `…_t.jpg` for the thumbnail. A one-line resolver in `bootstrap.ts` alongside the DB
  path keeps them together.
- **Volume:** about 170 items × ~1.5 photos × ~300 KB ≈ **75 MB per intake day, about
  20 GB a year**. That's fine on local disk. It matters for the Phase 2 backup (§9),
  and it's why a retention policy is one of the open questions (§10).
- Serve photos through `GET /api/photos/:id` (and `?thumb=1`) with **the same
  authorization as the item**: staff, or the owning account for Consignor/Booth Owner
  sessions. Photos taken before the item exists belong to the session's user and
  store until they're attached. Never serve the folder as static files.
- Upload is `POST /api/photos` with a multipart body (`multer`, memory storage, 5 MB
  cap, JPEG/PNG/WebP only, the server re-encodes with `sharp` so nothing the client
  sent is stored as-is). Once photos go through this route, the 5 MB `express.json`
  limit in `index.ts` that was added for base64 photos can go back to normal.

### 5.2 Schema changes

```prisma
model Photo {
  id          String   @id @default(cuid())
  storeId     String
  itemId      String?            // null until the item is saved
  draftId     String?            // auto-intake draft it belongs to
  role        String   @default("FRONT") // FRONT | LABEL | BACK | DETAIL | OTHER
  sortOrder   Int      @default(0)
  path        String             // relative to the photos dir; never a URL
  width       Int
  height      Int
  bytes       Int
  sha256      String
  source      String   @default("CAMERA") // CAMERA | UPLOAD | MIGRATED
  createdById String?
  createdAt   DateTime @default(now())
  @@index([itemId, sortOrder])
  @@index([draftId])
  @@index([storeId, createdAt])
}

model VisionJob {           // one suggestion request = one model call
  id            String   @id @default(cuid())
  storeId       String
  draftId       String?
  itemId        String?           // set when the item is saved from it
  photoIds      String            // JSON array
  status        String            // QUEUED | RUNNING | DONE | FAILED | SKIPPED
  attempts      Int      @default(0)
  provider      String            // "claude" | "local" | "stub" (or "local+claude" when combined)
  model         String?
  suggestion    String?           // JSON (VisionSuggestion), as returned
  outcome       String?           // JSON per field: accepted | edited | cleared | ignored
  inputTokens   Int?
  outputTokens  Int?
  costMicros    Int?              // estimated, for the monthly cap
  error         String?
  createdById   String?
  activeRole    String?
  createdAt     DateTime @default(now())
  finishedAt    DateTime?
  @@index([storeId, status, createdAt])
}

model IntakeDraft {         // auto-intake: an item that hasn't been saved yet
  id          String   @id @default(cuid())
  storeId     String
  accountId   String            // target fixed by resolveIntakeAccountId when the draft is made
  sessionId   String            // groups one drop-off ("batch")
  status      String            // OPEN | SAVED | DISCARDED
  fields      String            // JSON: description, category, …, price (clerk's edits)
  itemId      String?           // after save
  createdById String
  activeRole  String
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  @@index([storeId, sessionId, status])
}
```

Plus three `Store` settings: `visionEnabled Boolean @default(false)`,
`visionModel String?` and `visionMonthlyCapCents Int?`.

**Why drafts are their own table instead of `PENDING` items:** creating an `Item` uses
up an `itemNumber` and an `accountItemNumber` (the "4545-12" tag number). Discarding a
half-reviewed photo would leave gaps in the tag-number sequence and add rows to every
item list and report. A draft becomes an `Item` only on **Save**, through the
existing `POST /items` path (`resolveIntakeAccountId`, `nextItemIdentity`, the
`INTAKE` history entry). The rules that create items stay in one place.

### 5.3 The vision adapter

`server/src/adapters/vision.ts` replaces `cv.ts`. It has the same kind of interface as
the other stubs, so the provider can be swapped out:

```ts
interface VisionProvider {
  name: "claude" | "local" | "stub"; // "local" arrives in Phase E (§5.3a)
  suggest(input: { photos: { role: PhotoRole; jpeg: Buffer }[]; context: VisionContext }):
    Promise<{ suggestion: VisionSuggestion; usage: { inputTokens: number; outputTokens: number; model: string } }>;
}
```

- **`stub`** is the default whenever there's no API key or vision is off. It returns
  an empty suggestion, so the stub never auto-fills fields.
- **`claude`** calls the Claude API from the **server** using `@anthropic-ai/sdk`. The
  API key goes in `config.env` as `ANTHROPIC_API_KEY`, next to `JWT_SECRET`. It never
  reaches the browser and isn't editable in Settings.

`VisionContext` is built per store and **cached** (it's the same for every item, so
prompt caching makes it cheap):

- the store's category and subcategory lists, with counts (`GET /items/categories`
  plus a subcategory equivalent), so the model picks values the shop actually uses;
- a **field map** that says how this shop uses each field. Hidden Treasures' map:
  `description` = "brand, then a few words of note"; `brand` = "garment or item type
  (Top, Pants, Slipper)"; `subcategory` = department. It's stored as store settings
  and defaults to the field names' plain meaning for a new shop;
- around 30 recent real items from the same department as style examples, so the
  model copies how the shop writes descriptions ("Old Navy, as is").

**Output is structured**, using `client.messages.parse` with a Zod schema (the server
already uses Zod), so nothing has to be parsed out of free text:

```ts
const VisionSuggestion = z.object({
  items_in_photo: z.enum(["one", "set", "multiple_separate", "unclear"]),
  description:  z.object({ value: z.string().max(80), confidence: z.number() }),
  itemType:     z.object({ value: z.string().nullable(), confidence: z.number() }),
  brand:        z.object({ value: z.string().nullable(), readFromLabel: z.boolean(), confidence: z.number() }),
  subcategory:  z.object({ value: z.string().nullable(), confidence: z.number() }), // from the store's list
  category:     z.object({ value: z.string(), confidence: z.number() }),            // from the store's list
  size:         z.object({ value: z.string().nullable(), readFromLabel: z.boolean(), confidence: z.number() }),
  serialNumber: z.string().nullable(),
  condition:    z.enum(["new_with_tags", "like_new", "good", "fair", "as_is"]).nullable(),
  flags:        z.array(z.enum(["damage_visible", "possible_recall", "counterfeit_risk",
                                "needs_label_photo", "not_resellable"])),
});
```

The adapter maps semantic fields (true `brand`, `itemType`) onto Teabox columns
through the store's field map, so the clerk sees suggestions in the fields they
already use. If the shop later cleans up its convention, only the map changes.

**Model and settings.** The model is a store setting, `visionModel`. The Phase B eval
(§8) runs Haiku 5.5, Sonnet 5.5 and Opus 5.5 on the same photos, and the cheapest one
that's accurate enough becomes the default. Haiku is the expected choice (§5.3a). Use
low effort: this is a short extraction task, so more effort mostly adds cost and
time. Use the API's server-side refusal fallback (`fallbacks:
"default"`), and if the response is still a refusal, treat it as "no suggestion".

Rough cost per item, assuming ~1.5 photos at 1600 px (~2,400 image tokens each),
~2k cached context and ~1k output and thinking tokens. These are estimates to replace
with measured `usage` numbers:

| Model | per item | at 45k items/year |
|---|---|---|
| `claude-opus-5-5` ($4 / $20 per M tokens) | ~$0.04 | ~$1,800 |
| `claude-sonnet-5-5` ($2 / $10) | ~$0.02 | ~$900 |
| `claude-haiku-5-5` ($0.10 / $0.50) | ~$0.001 | ~$50 |

The 40× spread is why §8 collects real labeled photos *before* picking a model. If
Haiku reads labels about as well as Opus on this shop's items, the cost question goes
away. It's a business decision (Drew and Sherry), not one for the code.
`visionMonthlyCapCents` stops new jobs (they're marked `SKIPPED` with reason
`budget`) once the month's estimated spend reaches the cap.

### 5.3a Other providers considered (2026-11-20)

Every option is priced at Hidden Treasures' volume: ~45k items a year, ~1.5 photos
each. Prices come from vendor pages as of November 2026; recheck them before
committing.

| Option | What it returns | Rough cost/yr | Verdict |
|---|---|---|---|
| Claude Haiku 5.5 | Label text read, store categories chosen, description written in the shop's style: the whole `VisionSuggestion` in one call | ~$50 (estimate) | **Start here**, then try Sonnet or Opus only if the eval shows Haiku falling short |
| Google Cloud Vision (label + text detection) | Generic labels ("Sleeve", "Textile") and raw label text, $1.50 per 1,000 units, 1,000 free a month | ~$180 | Cheap, but we'd write and maintain the code that turns its output into descriptions and categories. No benefit over Haiku |
| Fashion taggers (Ximilar, YesPlz, Syte) | Detailed clothing attributes (neckline, sleeve, color, pattern) for catalog search filters | Ximilar: 15 credits per single-product photo, on a paid plan of ~$59/month (third-party listings disagree on the price) | **Rejected.** They cover clothing only, and 40% of last year's intake wasn't clothing. They don't read care-label brand or size. Their attributes aren't fields this shop records |
| AWS Rekognition Custom Labels (trainable) | Your own model | Billed at $4 per hour per unit **while the model is running**, about $8k a year if it runs during shop hours | **Rejected.** Hourly billing doesn't suit intermittent intake |
| Azure Custom Vision (trainable) | Your own model | — | **Rejected.** Retiring on 2028-09-25 |
| **Local open-source models on the shop PC** | See below | $0; works offline; photos never leave the shop | **Follow-up once Phase A has data** (Phase E in §8) |

**The local path.** It suits Teabox's offline-first design (§9) better than any
cloud service, but it needs training data the shop doesn't have yet: Liberty stored
no photos.

- **Category and item type:** use an open image-embedding model with a small
  classifier trained on the shop's own photos. Candidates: Marqo FashionSigLIP
  (Apache-2.0, trained on fashion) for clothing and a general SigLIP model for
  everything else. Embedding plus a linear classifier runs in well under a second on
  a CPU. **Training data is what Phase A produces:** every photographed intake
  comes with the subcategory and type a clerk entered, which is ~10k examples within
  2–3 months at 170 items a day.
- **Label reading (brand, size):** small local OCR and vision models. Florence-2
  (~230M–770M parameters, fast) for raw text; Qwen3-VL 2B–8B (via Ollama) for
  structured reading. **This is the weak spot.** Small vision-language models are slow
  on a CPU (one laptop benchmark showed Qwen3-VL 8B at ~5 tokens/s) and less
  dependable on wrinkled, curved care labels. Time it on the actual shop PC before
  counting on it.
- **Description wording:** the hardest part to do locally. It's the most likely
  piece to stay on the API.

The likely end state is a **hybrid**: the local classifier always runs, including
offline, and fills category and type instantly. The API is called only to read the
label and write the description, and only when the shop is online and vision is on.
`VisionProvider` already allows this: a `local` provider and a `claude` provider, with
a combining step that takes each field from whichever source the eval shows is more
accurate for it.

### 5.4 Job queue and offline behavior

- An **in-process worker** (like `startAutoDonateTimer`) takes `QUEUED` jobs oldest
  first, runs **2 at a time**, retries up to 3 times with backoff on network errors
  or 429/5xx responses, and on a 4xx or refusal marks the job `FAILED` with no retry.
- **Offline:** a failed connection leaves the job `QUEUED`, and the worker backs off
  up to 5 minutes between tries. The intake form shows "Suggestions offline —
  enter by hand". **Saving is never blocked.** A job that finishes *after* its item
  was saved stores its suggestion and feeds the review list (§6.3) instead of
  changing the item.
- **Polling, not WebSockets:** the browser polls `GET /vision/jobs/:id` every second
  while it has a pending job. That's simplest for a single-shop install, and a job
  takes 3–10 seconds.
- On startup, jobs left `RUNNING` by a crash are reset to `QUEUED`.

## 6. UI flows

### 6.1 Single-item intake (the current page, upgraded)

1. Choose the account (no change).
2. Press Space to capture. The thumbnail appears in a strip, the upload starts, and
   a vision job is queued as soon as the first photo has uploaded. Taking a label
   shot within ~2 seconds is included in the same job; after that, a new photo
   starts a new job that replaces the last one.
3. The clerk can type while the job runs. When the suggestion arrives:
   - **fields the clerk has already typed in are never overwritten**;
   - empty fields fill in with a **gold left border** and a small confidence dot.
     Fields under ~0.5 confidence are shown as a hint underneath the field instead
     of being filled in;
   - `items_in_photo = multiple_separate` and the other flags appear as one-line
     warnings ("Looks like 3 separate items — one tag each?").
4. Price stays manual. Saving works as it does today. The tag batch shows the
   thumbnail next to each queued tag. Saving sends `photoIds` and `visionJobId`, and
   the server attaches the photos and records each field's outcome.

### 6.2 Auto-intake (batch capture → review grid)

This is the throughput feature. It lives on a new tab of the Intake page, "Batch
(photos first)":

1. Choose the account, then **Start drop-off**. This creates a `sessionId`.
2. Capture loop: Space takes a photo, `L` takes a label shot, **Enter starts the next
   item**. Each item becomes an `IntakeDraft` with its photos, and a vision job is
   queued for it. The clerk can photograph a whole bag in a minute or two without
   stopping.
3. **Review grid:** one row per draft. It shows the thumbnail, the suggested fields
   (editable in place, gold until touched), a **price cell that gets focus first**,
   and status (waiting, ready, offline). Tab moves along the row and Enter saves it
   and moves down. Ctrl+Enter saves every row that has a price.
4. Each saved row goes through `POST /items` and lands in the existing **Tag Batch**,
   so a whole drop-off is printed in one go. Discarded drafts delete their photos.
5. Drafts survive a page reload or another workstation picking them up. Open drafts
   older than 7 days are listed for cleanup, never deleted automatically.

Consignor and Booth Owner sessions get the same flow, with the account locked as it
is today. A rate limit on vision jobs per session keeps self-service intake from
running up API costs.

### 6.3 Elsewhere

- **Item detail:** photo gallery with add, remove and reorder (staff). "Run
  suggestions" is shown when vision is on, and a suggestion that arrived late can be
  accepted field by field.
- **POS:** a thumbnail in each cart row and the lookup result, for checking against
  the tag. Items without photos (everything migrated) look as they do today.
- **Reports > Vision** (Manager+): jobs per day, spend this month against the cap,
  and **accuracy per field** (share accepted unchanged / edited / cleared), using the
  `VisionJob.outcome` data. This is the "manual review" the PRD asked for, done as
  measurement rather than a separate queue. Late suggestions are listed here until
  someone accepts or dismisses them.

## 7. Security and privacy

- Photos leave the shop **only** when vision is turned on (Settings > Store,
  Owner/Admin, audited `ENABLE_VISION` / `DISABLE_VISION`), and only for that call.
  Before switching it on, check Anthropic's commercial data-retention terms for the
  account the key belongs to. Phones may catch faces, receipts or envelopes with
  names in the frame. Guidance for clerks: label and item only.
- EXIF data is removed before upload (§4.3). The server re-encodes every image, so
  only well-formed JPEGs are stored or sent.
- The photo routes enforce the same authorization as items. Consignor and Booth Owner
  sessions only see their own account's photos, and the active-role rule applies
  unchanged.
- Audit: `UPLOAD_PHOTO`, `DELETE_PHOTO` and `VISION_JOB` (with model and cost) are
  recorded with `activeRole`, as everywhere else.
- Even a server-side API key leaks easily through logs. Never log request bodies,
  and redact the `Authorization` header in any HTTP debug output.

## 8. Phasing

Each phase ships on its own and is useful without the ones after it.

| Phase | What | Why this order |
|---|---|---|
| **A — Real photos** | `Photo` schema + file storage + upload/serve routes; `PhotoCapture` (live view or file-input fallback); photos on intake, item detail, tag batch and POS cart; delete with the item. No AI. | Useful immediately (checking items at the register, identifying items in Print Queues). **It also builds the eval set:** every item taken in with photos *and* clerk-typed fields is a labeled example of this shop's real goods. |
| **B — Suggestions on single-item intake** | `VisionJob`, the worker, `adapters/vision.ts` (stub + Claude), store settings and spend cap, fill-without-overwrite, outcome tracking, Reports > Vision. Before turning it on: run the ~200–500 Phase A items through each candidate model and compare with what clerks typed. **The model choice comes from that run.** | The eval decides the model and shows whether suggestions are accurate enough to save time. If they aren't, we find out cheaply. |
| **C — Auto-intake** | `IntakeDraft`, batch capture, review grid, draft cleanup. | Only worth building once B shows suggestions are accepted often. Otherwise a grid of suggestions is just a grid of corrections. |
| **E — Local classifier (after a few thousand photographed intakes)** | Train an embedding-plus-linear classifier for subcategory and item type on Phase A/B photos (§5.3a). Run it in-process or as a small local sidecar, and score it on the same eval as the API. If it's accurate enough, it fills category and type offline and instantly, and the API is kept only for reading labels and writing descriptions. Also time local label reading (Florence-2, Qwen3-VL) on the shop PC. | Offline use and keeping photos in the shop, not cost (Haiku is ~$50 a year). It can't start before Phase A has collected training data. |
| **D — Later, separate decisions** | A **price hint** that isn't AI: median price and time to sell for the same subcategory and brand from the shop's own ~850k sales ("similar sold for $5–$8, usually within 3 weeks"). Detecting duplicates and returning items by photo. Running a model on-site. Marketplace listing text. | Pricing stays out of the AI. The shop's own sales history is better evidence than a model's guess. |

Removed as part of A/B: `adapters/cv.ts`, `POST /items/suggest-metadata`, the
`CvSuggestion` UI and the `photoUrl` intake field (replaced by `photoIds`).

## 9. How this fits with sync and backup

- **Phase 2 (disaster-recovery backup):** the backup must include the `photos/`
  folder, not just the database. Photos never change after they're written, so a
  simple sync of new files to object storage works. A restore test should check that
  `Photo.path` → file still resolves.
- **Phase 3 (outbox):** `Photo` rows go into the outbox like any other entity, but
  the **image data doesn't**. Cross-store browsing loads thumbnails from the
  aggregator only once the files have been uploaded, so a missing photo shows as a
  placeholder. `VisionJob` and `IntakeDraft` stay local to the shop and aren't
  synced.
- **liberty-etl:** Liberty has no photos. `sync` should ignore `Photo` and never
  delete one.

## 10. Open questions

For **Sherry**:

1. Is the intake desk the same PC that runs Teabox? The plan is a USB document
   camera there (§4.1a); a separate PC brings back the HTTPS requirement. Is there
   room for an overhead arm and two small lights?
2. On a busy day, how many items come in and how many people do intake? The 170/day
   average hides the peaks.
3. Keep the field convention (description = brand + note, "Brand" field = item type),
   or switch to brand and item type in their own fields from now on? The design
   works either way through the field map. Switching makes the data and later
   marketplace listings clearer.
4. Is she comfortable with photos of items going to a cloud AI service, and what
   monthly spend is acceptable once the per-item cost is measured?
5. How long should photos be kept: forever, or until a set time after the item sells
   or is donated? (About 20 GB a year if kept forever.)

For **Drew**:

6. ~~Phone or tablet capture over the LAN, or a webcam on `localhost`?~~ Decided
   2026-11-20: a USB camera on `localhost`, preferably a document camera. Buy one and
   test it on ~20 real items first (§4.1a).
7. Is the API key per shop (each install pays for itself) or yours, with a cap per
   store?
8. Phase A first, with suggestions only after the eval? That's the recommendation;
   it costs a few weeks before anyone sees AI working.

## 11a. External sources (provider and camera research, 2026-11-20)

- Google Cloud Vision pricing: https://cloud.google.com/vision/pricing
- Ximilar pricing and fashion tagging: https://ximilar.com/pricing/ ·
  https://docs.ximilar.com/services/fashion_tagging
- Rekognition Custom Labels inference-hour billing:
  https://aws.amazon.com/about-aws/whats-new/2022/08/amazon-rekognition-custom-labels-supports-autoscaling-inference-units ·
  https://docs.aws.amazon.com/rekognition/latest/customlabels-dg/running-model.html
- Azure Custom Vision retirement:
  https://learn.microsoft.com/en-us/azure/ai-services/custom-vision-service/migration-options
- Marqo FashionSigLIP: https://huggingface.co/Marqo/marqo-fashionSigLIP
- Local vision models (Florence-2, Qwen-VL):
  https://botmonster.com/ai/run-vision-models-locally-florence-2-qwen-vl/ ·
  https://huggingface.co/blog/ocr-open-models
- Webcam close-focus behavior: https://www.pcgamer.com/logitech-brio-webcam-review ·
  https://www.pcworld.com/article/2503386/4k-webcams-make-you-look-like-a-pro-but-does-that-outweigh-the-cons.html

## 11. References in `Docs/InitialBuild/`

- `project_requirements_document.md`: §1 scope (CV stub, cloud-dependent), out of
  scope (running vision offline; AI price suggestions), §3 daily intake narrative,
  §4 intake module ("photo capture stub"), third-party list (Azure Computer Vision /
  YOLO), risks (latency and false matches → manual review queues).
- `tech_stack_document.md`: external services (Computer Vision API: brand, style,
  serial number suggestions), photo storage in Azure Blob or DO Spaces, why a managed
  API.
- `backend_structure_document.md`: vision as a separate cloud service, `photos`
  table, `POST /api/items/:id/photos`, `GET /api/photos/:id`.
- `app_flow_document.md`: intake flow (three guided photos, local upload, cloud vision
  when online, "suggestions ready" notification, review on "Complete Intake"),
  errors and offline queueing.
- `wireframes/item_intake.html`: Intake Capture panel, live view, "Capture Image",
  "Camera: Online" badge.
- `tasks.json`, `security_guideline_document.md`: nothing specific to vision.
