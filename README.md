# iSupply AI Studio

A node-based AI orchestration engine for automated product photography and carousel ad generation — powered by Google Gemini, built on Next.js + React Flow.

---

## Table of Contents

1. [What it does](#what-it-does)
2. [Prerequisites](#prerequisites)
3. [Option A — Run on localhost:3000](#option-a--run-on-localhost3000)
4. [Option B — Desktop Installer](#option-b--desktop-installer)
5. [Getting a Gemini API Key](#getting-a-gemini-api-key)
6. [Using the App](#using-the-app)
7. [Building the Installer from Source](#building-the-installer-from-source)
8. [Environment Variables](#environment-variables)
9. [Troubleshooting](#troubleshooting)

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

## Prerequisites

| Requirement | Version |
|-------------|---------|
| Node.js | 20 LTS or later |
| npm | 10+ (comes with Node 20) |
| Google Gemini API key | Free tier works for testing |

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

Open `.env.local` and add your Gemini API key:

```env
GEMINI_API_KEY=AIzaSy...your-key-here
```

The Supabase variables in `.env.example` are optional — the app uses local filesystem storage and does not require Supabase at runtime.

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

The production server also runs on [http://localhost:3000](http://localhost:3000) by default.

---

## Option B — Desktop Installer

The desktop app is a self-contained Electron wrapper. After installation:

- Double-click the app icon — no terminal needed
- A setup screen prompts for your Gemini API key (stored locally, never transmitted except to Google's API)
- The app launches automatically and runs entirely on your machine

### Installing on Windows

1. Download `iSupply-AI-Studio-Setup-x.x.x.exe` from the Releases page
2. Run the installer — it installs per-user to `%LOCALAPPDATA%\Programs\iSupply AI Studio\` (no admin rights needed)
3. A desktop shortcut and Start Menu entry are created automatically
4. Launch **iSupply AI Studio** from the desktop or Start Menu
5. Paste your Gemini API key into the setup screen and click **Save & Launch**

### Installing on macOS

1. Download `iSupply-AI-Studio-x.x.x.dmg` from the Releases page
2. Open the DMG and drag the app to your Applications folder
3. Launch from Applications or Spotlight
4. Paste your Gemini API key on first run

### Changing the API key later

Go to **iSupply AI Studio → Settings — Change API Key** in the menu bar.

---

## Getting a Gemini API Key

1. Visit [https://aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey)
2. Sign in with a Google account
3. Click **Create API Key**
4. Copy the key — it starts with `AIza`

The free tier includes a generous daily quota sufficient for typical use. Image generation (`gemini-3.1-flash-image-preview`) requires a project with the Gemini API enabled; if you see access errors, verify image generation is enabled in your Google Cloud project at [https://ai.google.dev](https://ai.google.dev).

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
- Matched reference images appear automatically based on shared tags
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

#### Output Node
- Displays the generated image
- **Download** button saves a PNG to your machine
- **Export Batch** (batch toolbar) packages all outputs as a ZIP

### Switching Batches

Click the batch name in the top bar to open the Batch Switcher. All batches persist in your browser's localStorage.

### Models

| Label | Gemini Model | Best for |
|-------|-------------|----------|
| Flash | `gemini-3.1-flash-image-preview` | Fast iteration, most prompts |
| Standard | `gemini-2.5-flash-image` | Balanced quality |
| Pro | `gemini-3-pro-image-preview` | Maximum quality |

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
| `GEMINI_API_KEY` | **Yes** | Google Gemini API key |
| `NEXT_PUBLIC_SUPABASE_URL` | No | Unused at runtime (legacy) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | No | Unused at runtime (legacy) |

Create a `.env.local` file in the project root for local development:

```env
GEMINI_API_KEY=AIzaSy...
```

For the desktop app, the API key is entered through the setup UI and stored in the system user-data folder — no `.env.local` file is needed.

---

## Troubleshooting

### "GEMINI_API_KEY is not set"
- **localhost:** Make sure `.env.local` exists and contains `GEMINI_API_KEY=AIza...`
- **Desktop app:** Open Settings → Change API Key and re-enter your key

### "Generation returned no image"
Your key may not have image generation access. Verify at [https://ai.google.dev](https://ai.google.dev) that the Gemini API with image generation (`gemini-3.1-flash-image-preview`) is enabled for your project.

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
Run in Terminal:
```bash
xattr -cr /Applications/iSupply\ AI\ Studio.app
```

### Windows — installer blocked by SmartScreen
Click **More info → Run anyway**. The app is unsigned (no code-signing certificate). To suppress this permanently, a code-signing certificate is required.
