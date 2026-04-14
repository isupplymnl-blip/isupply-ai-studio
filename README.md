# iSupply AI Studio

A node-based AI orchestration engine for automated product photography and carousel ad generation — powered by Google Gemini (and compatible proxies), built on Next.js + React Flow, distributed as an Electron desktop app.

---

## Table of Contents

1. [What it does](#what-it-does)
2. [How it works (technical)](#how-it-works-technical)
3. [Prerequisites](#prerequisites)
4. [Option A — Run on localhost:3000](#option-a--run-on-localhost3000)
5. [Option B — Desktop Installer](#option-b--desktop-installer)
6. [AI Providers](#ai-providers)
7. [Getting API Keys](#getting-api-keys)
8. [Using the App](#using-the-app)
9. [Building the Installer from Source](#building-the-installer-from-source)
10. [Environment Variables](#environment-variables)
11. [Troubleshooting](#troubleshooting)
12. [Known Issues & Suggestions](#known-issues--suggestions)

---

## What it does

iSupply AI Studio gives you a visual canvas to build multi-slide product ad campaigns.
Each batch is a React Flow graph of nodes:

| Node | Purpose |
|------|---------|
| **Image Reference** | Upload a product photo used as context for generation |
| **Image Prompt** | Write a prompt; the app auto-matches relevant reference images by tag |
| **Carousel Slide** | Multi-prompt node — one prompt per slide, generates all slides sequentially |
| **Model Creation** | Generates a 4-panel model composite (front / 3/4 / side / rear) |
| **Output** | Receives and displays a generated image; download or export |

Two batch types share the same canvas:

- **Standard Batch** — build freely; mix any node types
- **Automated Batch** — same canvas, with the Carousel Slide node enabled for sequential multi-image runs

---

## How it works (technical)

```
User (Browser / Electron window)
  │
  ├─ React Flow canvas (app/page.tsx)
  │    ├─ UploadNode       → POST /api/upload → saves file to disk (uploads/)
  │    ├─ PromptNode       → click Generate
  │    │    └─ dispatches to active provider route:
  │    │         ├─ POST /api/generate           (Gemini direct)
  │    │         ├─ POST /api/ecco/generate      (EccoAPI proxy)
  │    │         └─ POST /api/pudding/generate   (PuddingAPI proxy, supports SSE streaming)
  │    ├─ CarouselPromptNode → same routes, called sequentially per slide
  │    ├─ ModelCreationNode  → same routes with type=model-creation
  │    └─ OutputNode         → receives imageUrl, displays result
  │
  └─ Batch state persisted in localStorage (nodes, edges, generated images)
       └─ Global image library also persisted in localStorage

API Routes (Next.js server / Electron child process)
  ├─ /api/generate
  │    ├─ Calls lib/tagMatcher.ts → reads data/assets.json → matches reference images by tag
  │    ├─ Resizes each reference image to max 1024px JPEG via sharp
  │    ├─ Sends prompt + reference images to Google Gemini API
  │    │    config: temperature=1.0, thinkingConfig, mediaResolution=high, safetySettings
  │    ├─ Handles 503 overload: retries once, then falls back to Pro model
  │    └─ Saves generated PNG to disk → returns /api/generated/<filename>
  │
  ├─ /api/ecco/generate
  │    ├─ Same tag-matching and image resizing as above
  │    ├─ Sync mode (default): blocks until EccoAPI responds, returns imageUrl directly
  │    └─ Async mode (opt-in): fires job, returns 202 + jobId → client polls /api/ecco/jobs/:id
  │         └─ app/lib/eccoJobStore.ts: in-memory Map (jobId → status/imageUrl)
  │
  ├─ /api/pudding/generate
  │    ├─ Same tag-matching and image resizing
  │    ├─ Supports SSE streaming mode (useStreaming=true) to survive Cloudflare 524 timeouts
  │    │    └─ Sends heartbeat every 15 s; delivers result as an SSE "complete" event
  │    └─ Non-streaming mode also available
  │
  ├─ /api/assets          → CRUD for saved reference images (assets.json)
  ├─ /api/upload          → Receives uploaded reference image, saves to disk
  ├─ /api/config          → Returns active provider + which API keys are set
  ├─ /api/generated/:file → Serves generated images from disk
  └─ /api/uploads/:file   → Serves uploaded reference images from disk

Electron wrapper (electron/main.cjs)
  ├─ Reads API keys from userData/studio-config.json
  ├─ Finds a free port starting at 3000
  ├─ Spawns Next.js standalone server as a child process (fork or spawn)
  ├─ Polls http://127.0.0.1:PORT until server is ready
  └─ Opens BrowserWindow pointing at localhost:PORT
       └─ Setup screen shown on first launch to collect API keys
```

### Provider cycling

The toolbar has a **provider toggle** that cycles: `Gemini → EccoAPI → PuddingAPI → Gemini`.
The active provider is stored in localStorage (`isupply-provider`) and overrides the `AI_PROVIDER` env var.

### Tag-based reference matching

When you tag an uploaded image (e.g. `sneaker`, `red`, `bottle`), those tags are stored in `data/assets.json`.
When you click Generate, the server scans the prompt text for those tag words and automatically attaches the matching reference images — no manual wiring needed. Up to 14 reference images are attached per generation request.

---

## Prerequisites

| Requirement | Version |
|-------------|---------|
| Node.js | 20 LTS or later |
| npm | 10+ (comes with Node 20) |
| At least one API key | See [AI Providers](#ai-providers) |

> The desktop installer bundles its own Node.js runtime — you do **not** need Node.js installed for Option B.

---

## Option A — Run on localhost:3000

### 1. Clone and install dependencies

```bash
git clone <repo-url>
cd isupply-ai-studio
npm install
```

### 2. Create your environment file

```bash
cp .env.local.example .env.local
```

Open `.env.local` and add your key(s):

```env
# Required — at least one of these:
GEMINI_API_KEY=AIzaSy...your-key-here
ECCO_API_KEY=nk_live_...your-key-here
PUDDING_API_KEY=your_pudding_key_here

# Optional — set the default provider at startup (can be overridden in the UI)
AI_PROVIDER=gemini
```

### 3. Start the development server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### 4. (Optional) Production server

```bash
npm run build
npm run start
```

---

## Option B — Desktop Installer

The desktop app is a self-contained Electron wrapper. After installation:

- Double-click the app icon — no terminal needed
- A setup screen prompts for your API key(s) (stored locally, never transmitted except to the respective AI provider)
- The app launches automatically and runs entirely on your machine

### Installing on Windows

1. Download `iSupply-AI-Studio-Setup-x.x.x.exe` from the Releases page
2. Run the installer — it installs per-user to `%LOCALAPPDATA%\Programs\iSupply AI Studio\` (no admin rights needed)
3. A desktop shortcut and Start Menu entry are created automatically
4. Launch **iSupply AI Studio** from the desktop or Start Menu
5. Paste your API key into the setup screen and click **Save & Launch**

### Installing on macOS

1. Download `iSupply-AI-Studio-x.x.x.dmg` from the Releases page
2. Open the DMG and drag the app to your Applications folder
3. Launch from Applications or Spotlight
4. Paste your API key on first run

### Changing the API key later

Go to **iSupply AI Studio → Settings — Change API Key** in the menu bar.

---

## AI Providers

The app supports three AI providers, all backed by Google Gemini models. Toggle between them in the toolbar.

| Provider | What it is | Best for | Key env var |
|----------|-----------|----------|-------------|
| **Gemini** | Direct Google AI API | Maximum reliability, full parameter control | `GEMINI_API_KEY` |
| **EccoAPI** | Third-party Gemini proxy | Lower cost per generation; supports async mode | `ECCO_API_KEY` |
| **PuddingAPI** | Chinese Gemini-compatible proxy | Alternative pricing; SSE streaming to survive long timeouts | `PUDDING_API_KEY` |

All three providers use the same Gemini image models and support:
- Reference image injection
- `thinkingConfig` (reasoning pass for better reference adherence)
- `mediaResolution: high` (high-fidelity reference reading)
- Safety threshold settings

> **Note:** EccoAPI and PuddingAPI are third-party proxies and may not pass all Gemini parameters through. If you see inconsistent reference adherence, switch to the direct Gemini provider.

### Models

| Label | Gemini model | Best for |
|-------|-------------|----------|
| Flash | `gemini-3.1-flash-image-preview` | Fast iteration, most prompts |
| Standard | `gemini-2.5-flash-image` | Balanced quality |
| Pro | `gemini-3-pro-image-preview` | Maximum quality |

---

## Getting API Keys

### Google Gemini (primary)

1. Visit [https://aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey)
2. Sign in with a Google account
3. Click **Create API Key**
4. Copy the key — it starts with `AIza`

The free tier includes a generous daily quota. Image generation requires the Gemini API with image generation enabled; verify at [https://ai.google.dev](https://ai.google.dev).

### EccoAPI (optional proxy)

1. Sign up at [https://eccoapi.com](https://eccoapi.com)
2. Go to your dashboard and create an API key
3. Key format: starts with `nk_live_`

### PuddingAPI (optional proxy)

1. Sign up at the PuddingAPI platform
2. Obtain your API key from the dashboard
3. Optionally set `PUDDING_BASE_URL` if the default endpoint changes

---

## Using the App

### Creating a Batch

Click the **+** button in the left sidebar and choose:

- **Create Batch** — standard, open-ended canvas
- **Create Automated Batch** — same canvas with sequential carousel generation enabled

### Node Types

#### Image Reference Node
- Click **Upload** to add a product photo
- Tag your image (e.g. `sneaker`, `bottle`, `red`) — tags are used to auto-match references to prompts

#### Image Prompt Node
- Write a generation prompt in the textarea
- Matched reference images appear automatically based on shared tags (up to 14 references per call)
- Adjust **Model**, **Aspect Ratio**, **Resolution**, and **Negative Prompt** in the right-side settings panel
- Click **Generate** to produce an image

#### Carousel Slide Node (Automated Batch)
- Created via **+ Carousel Slide** on the canvas toolbar
- A dialog asks how many slides to create (2–20)
- Each slide gets its own prompt textarea; navigate with ← → arrows
- Progress dots: gray = empty, teal = filled, purple = currently editing
- Click **⚡ Generate N Slides** to run all slides sequentially

#### Model Creation Node
- Describe the model (e.g. "Female, 25–30, athletic build, wearing white sneakers")
- Configure style, lighting, and background in the settings panel
- Generates a single 16:9 four-panel composite (front / 3/4 angle / side / rear)
- Supports two-model descriptions (e.g. "male and female models") — auto-detected and generates front + back for each

#### Output Node
- Displays the generated image
- **Download** button saves a PNG to your machine
- **Export Batch** (batch toolbar) packages all outputs as a ZIP

### Switching Batches

Click the batch name in the top bar to open the Batch Switcher. All batches persist in your browser's localStorage.

### Provider Toggle

Click the provider label in the toolbar to cycle through Gemini → EccoAPI → PuddingAPI.
Your selection is saved per-browser in localStorage.

---

## Building the Installer from Source

### Requirements

- Node.js 20+
- Windows: no extra tools needed (NSIS is bundled by electron-builder)
- macOS: Xcode Command Line Tools (`xcode-select --install`)
- Linux: `dpkg`, `fakeroot` for deb; none for AppImage

### Steps

```bash
# 1. Install all dependencies (including Electron)
npm install

# 2. Build for your current platform
npm run electron:build

# 3. Or target a specific platform explicitly
npm run dist:win     # Windows NSIS installer (.exe)
npm run dist:mac     # macOS DMG
npm run dist:linux   # Linux AppImage
```

Output lands in `dist-electron/`.

### What the build script does

1. Runs `next build` → generates `.next/standalone/` (a fully self-contained Node.js server)
2. Copies `.next/static/` and `public/` into the standalone directory
3. Runs `electron-builder` to package Electron + standalone server into an installer

The standalone server is embedded into the installer as `resources/server/` and is launched by the Electron main process using `child_process.fork()` — no separate Node.js installation is required on the end-user's machine.

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `GEMINI_API_KEY` | If using Gemini | Google Gemini API key (starts with `AIza`) |
| `ECCO_API_KEY` | If using EccoAPI | EccoAPI key (starts with `nk_live_`) |
| `PUDDING_API_KEY` | If using PuddingAPI | PuddingAPI key |
| `PUDDING_BASE_URL` | No | Override PuddingAPI endpoint (default: `https://new.apipudding.com`) |
| `AI_PROVIDER` | No | Default provider: `gemini`, `ecco`, or `pudding` (default: `gemini`) |
| `NEXT_PUBLIC_SUPABASE_URL` | No | Unused at runtime (legacy) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | No | Unused at runtime (legacy) |

Create a `.env.local` file in the project root for local development:

```env
GEMINI_API_KEY=AIzaSy...
ECCO_API_KEY=nk_live_...
PUDDING_API_KEY=...
AI_PROVIDER=gemini
```

For the desktop app, all keys are entered through the setup UI and stored in the system user-data folder.

---

## Troubleshooting

### "GEMINI_API_KEY is not set"
- **localhost:** Make sure `.env.local` exists and contains `GEMINI_API_KEY=AIza...`
- **Desktop app:** Open Settings → Change API Key and re-enter your key

### "ECCO_API_KEY is not set" / "PUDDING_API_KEY is not set"
- Make sure you have selected the correct provider in the toolbar, and the matching key is set in `.env.local` (dev) or the setup screen (desktop)

### "Generation returned no image"
Your key may not have image generation access. Verify at [https://ai.google.dev](https://ai.google.dev) that the Gemini API with image generation is enabled for your project.

### EccoAPI: inconsistent or lower-quality output
EccoAPI may not pass all Gemini parameters (e.g. `thinkingConfig`, `mediaResolution`) to the backend. Switch to the **Gemini** provider for maximum reference adherence.

### PuddingAPI: generation hangs or times out
Enable **SSE Streaming** in the node settings panel. This keeps the Cloudflare connection alive with heartbeats while the model generates.

### "Prompt blocked by Gemini text safety filters (SAFETY)"
Rephrase your prompt — avoid overly specific body descriptors, violent language, or other sensitive terms.

### "Generated image rejected by Gemini image safety filters (IMAGE_SAFETY)"
The prompt passed text filtering but the generated image was rejected. Try:
- Simplifying your scene description
- Removing environment or style descriptors
- Switching to a different aspect ratio
- Changing the model (Flash → Standard)

### Server failed to start (desktop app)
Port 3000 may be in use. Quit the app and any other process on port 3000, then relaunch. The app scans for the next available port automatically on each startup.

### Black screen / spinner stuck (desktop app)
The Next.js server is still booting. Wait up to 90 seconds on first launch after installation. Subsequent launches are faster because there is no compilation step.

### macOS — "app is damaged and can't be opened"
```bash
xattr -cr /Applications/iSupply\ AI\ Studio.app
```

### Windows — installer blocked by SmartScreen
Click **More info → Run anyway**. The app is unsigned (no code-signing certificate). To suppress this permanently, a code-signing certificate is required.

---

## Known Issues & Suggestions

### Bugs

| # | File | Issue |
|---|------|-------|
| 1 | `lib/tagMatcher.ts:21` | Reads `process.cwd()/data/assets.json` — ignores `USER_DATA_DIR`. In the packaged Electron app, tag-matching always returns empty because the data file is in `userData/assets.json`, not the app install dir. **Fix:** replace the hardcoded path with `getAssetsDbPath()` from `lib/storage.ts`. |
| 2 | `package.json` | `sharp` is used in all three generation routes but is not listed as a dependency. It works because it was installed manually, but a fresh `npm install` on a CI machine or new clone may not include it. **Fix:** run `npm install sharp` and commit the updated `package.json`. |
| 3 | `app/lib/eccoJobStore.ts` | The async job store is an in-memory `Map`. All pending EccoAPI jobs are lost if the Next.js server restarts. Not an issue for typical desktop use, but would be a silent failure in a hosted/web deployment. **Fix:** persist to a file or use a lightweight database for web deployments. |
| 4 | `app/page.tsx` | Auto-save runs every 3 s. If the user switches batches during the interval, the save writes the new batch's nodes to the old batch ID for up to 3 s. **Fix:** flush save synchronously on batch switch before calling `setActiveBatchId`. |

### Missing Features / Suggestions

| # | Suggestion | Why |
|---|-----------|-----|
| 1 | **`thoughtSignature` reuse** | The `ECCOAPI-FEATURE-REQUEST.md` describes using `thoughtSignature` to keep character/product identity consistent across multi-slide generations. It is not implemented. Adding it to the carousel generation loop would significantly improve slide-to-slide consistency. |
| 2 | **Error boundary** | There is no React error boundary wrapping the canvas. An uncaught error in any node component (e.g. a malformed image URL) will crash the entire studio. A simple `<ErrorBoundary>` wrapper would isolate failures to individual nodes. |
| 3 | **Document the 14-image reference limit** | `app/api/generate/route.ts:285` — `slice(0, 14)`. This limit is not surfaced in the UI or README. Users with more than 14 tagged assets won't know why extra references are ignored. |
| 4 | **Streaming for Gemini direct** | Only PuddingAPI supports SSE streaming. Direct Gemini and EccoAPI sync calls can hit Next.js/Vercel/Cloudflare response timeouts on slow generations. Adding streaming to the Gemini route would improve reliability. |
| 5 | **Per-node provider override** | Currently the provider is global. Allowing per-node provider selection would let users mix Gemini (quality) and EccoAPI (cost) in the same batch. |
| 6 | **Export to Supabase / cloud storage** | The app saves all images locally. For team use, a Supabase storage export option would allow sharing batches. The Supabase client is already a dependency. |
| 7 | **Carousel slide re-ordering** | Slides in the carousel node are generated in fixed order. Drag-to-reorder would be a useful UX improvement. |
