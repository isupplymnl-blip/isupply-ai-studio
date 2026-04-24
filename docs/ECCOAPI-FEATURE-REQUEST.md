# EccoAPI Feature Request — Missing Gemini Parameters

Hi EccoAPI team,

We are building a professional AI image generation studio that uses your API as a lower-cost
alternative to calling the Google Gemini API directly. We love the product and want to go
all-in on EccoAPI, but we are running into consistency and quality issues that we believe
are caused by missing parameters in your API that the underlying Gemini backend supports.

This document shows exactly what we are trying to do, what parameters your API currently
exposes, what the Google Gemini API exposes that yours does not, and what specific problems
we are experiencing as a result.

---

## 1. What We Are Building

An image generation studio where users:
- Upload **reference images** (product photos, character references)
- Write a text prompt describing the desired output
- Generate images using **NanoBanana Pro** (`gemini-3-pro-image-preview`) or
  **NanoBanana 3.1** (`gemini-3.1-flash-image-preview`)

The critical requirement is **reference image adherence** — the generated image must
consistently reflect the details of the uploaded reference (product design, face, colours,
clothing). This works correctly when we call the Gemini API directly. It is inconsistent
when going through EccoAPI.

---

## 2. Parameters Your API Currently Exposes

From your documentation at https://eccoapi.com/docs, the following parameters are accepted:

### NanoBanana Pro — `POST /api/v1/nanobananapro/generate`
| Parameter       | Type    | Description                                      |
|----------------|---------|--------------------------------------------------|
| `prompt`        | string  | The text prompt                                  |
| `imageSize`     | string  | `"1K"`, `"2K"`, `"4K"`                           |
| `aspectRatio`   | string  | e.g. `"16:9"`, `"1:1"`, `"4:5"`                 |
| `useGoogleSearch` | bool  | Enable real-time search grounding                |
| `imageBase64`   | array   | Reference images as base64                       |
| `imageUrls`     | array   | Reference images as URLs                         |
| `callbackUrl`   | string  | Webhook URL for async mode                       |

### NanoBanana 3.1 — `POST /api/v1/nanobanana31/generate`
Same parameters as above.

**That is the complete list. There are no other documented parameters.**

---

## 3. What the Underlying Gemini API Supports (That You Do Not Expose)

Google's own documentation for `gemini-3-pro-image-preview` and
`gemini-3.1-flash-image-preview` specifies the following additional parameters that
directly affect image quality and reference adherence. None of these are in your docs.

### 3a. `thinkingConfig` — Critical for Reference Adherence

```json
{
  "thinkingConfig": {
    "includeThoughts": true
  }
}
```

**What it does:** Forces the model to perform an internal "reasoning pass" before generating
the image, so it cross-checks the output against the reference image. Google explicitly
states this is required for character/product consistency.

**What happens without it:** The model generates a "generic" image that loosely matches the
prompt but ignores specific details from the reference (wrong colours, wrong product shape,
wrong face features).

**Source:**
https://ai.google.dev/gemini-api/docs/thinking

---

### 3b. `temperature` — Must Be `1.0` for Image Generation

```json
{
  "generationConfig": {
    "temperature": 1.0
  }
}
```

**What it does:** Controls the randomness of the model's generation process. Google's own
documentation for the image preview models explicitly states:

> "Keep temperature at its default of 1.0. Setting it lower for consistency often leads to
> unexpected behavior or degraded reasoning during image synthesis."

**Our current problem:** We had temperature defaulting to `0.7` in our app (a common text
generation setting). When we call your API we have no way to pass `temperature` at all. Your
API does not expose it. If your backend is defaulting to anything other than `1.0` for image
models, this alone would explain our inconsistency.

---

### 3c. `media_resolution` — Required for High-Fidelity Reference Reading

```json
{
  "generationConfig": {
    "media_resolution": "media_resolution_high"
  }
}
```

**What it does:** Allocates more input tokens to the reference image so the model can read
fine details — exact colour shades, small text on product labels, facial features, clothing
stitching. Without this, the reference image is down-sampled before the model even sees it.

**What happens without it:** The model sees a low-detail version of the reference and
produces a generic interpretation. Setting this to `media_resolution_high` is listed by
Google as one of the essential configurations for reference adherence.

**Source:**
https://cloud.google.com/vertex-ai/generative-ai/docs/image/generate-images

---

### 3d. `responseModalities` — Must Explicitly Include Both TEXT and IMAGE

```json
{
  "generationConfig": {
    "responseModalities": ["TEXT", "IMAGE"]
  }
}
```

**What it does:** Tells the model to return both a text explanation and an image. Gemini
image models require this to be explicitly set. If omitted or set to `["IMAGE"]` only, the
model sometimes fails silently or returns a text refusal with no image.

**Status:** We are not sure if you are already setting this on your backend. If not, this
may be causing some of our silent failures.

---

### 3e. `thoughtSignature` — Maintains Consistency Across Multi-Turn Generations

```json
{
  "thinkingConfig": {
    "includeThoughts": true
  },
  "thoughtSignature": "<value from previous response>"
}
```

**What it does:** When you enable `includeThoughts`, the Gemini API returns a
`thoughtSignature` in the response. If you pass this value back in the next generation
request, the model maintains its internal "character anchor" — the mental model it built of
the reference subject — across multiple generations. This is how you keep a character or
product visually consistent across 10+ slides.

**What we need:** Your API to return the `thoughtSignature` from Gemini's response in your
response body, and to accept it as an input parameter to pass back to Gemini on the next
call.

---

### 3f. Safety Threshold Settings

```json
{
  "safetySettings": [
    { "category": "HARM_CATEGORY_HARASSMENT",        "threshold": "BLOCK_ONLY_HIGH" },
    { "category": "HARM_CATEGORY_HATE_SPEECH",       "threshold": "BLOCK_ONLY_HIGH" },
    { "category": "HARM_CATEGORY_SEXUALLY_EXPLICIT", "threshold": "BLOCK_ONLY_HIGH" },
    { "category": "HARM_CATEGORY_DANGEROUS_CONTENT", "threshold": "BLOCK_ONLY_HIGH" }
  ]
}
```

**What it does:** Controls how aggressively the model blocks content. For a professional
product photography use case (clothing, accessories, people modelling clothes), we are
getting false-positive blocks on completely safe commercial images. We need to be able to
set a less aggressive safety threshold.

**Your API:** No safety settings are exposed at all.

---

## 4. Our Current Code (What We Are Sending to Your API)

This is our current EccoAPI generation route (`app/api/ecco/generate/route.ts`):

```typescript
const eccoBody: Record<string, unknown> = {
  prompt:          prompt.trim(),
  aspectRatio:     settings.aspectRatio ?? aspectRatio,
  imageSize:       settings.imageSize   ?? imageSize,
  useGoogleSearch: resolvedSearch,
};
if (imageBase64.length) eccoBody.imageBase64 = imageBase64;
```

We want to send this instead:

```typescript
const eccoBody: Record<string, unknown> = {
  prompt:          prompt.trim(),
  aspectRatio:     settings.aspectRatio ?? aspectRatio,
  imageSize:       settings.imageSize   ?? imageSize,
  useGoogleSearch: resolvedSearch,

  // ── Parameters we want to pass through to Gemini backend ──────────────
  temperature:     1.0,
  thinkingConfig:  { includeThoughts: true },
  mediaResolution: 'media_resolution_high',
  responseModalities: ['TEXT', 'IMAGE'],
  safetySettings: [
    { category: 'HARM_CATEGORY_HARASSMENT',        threshold: 'BLOCK_ONLY_HIGH' },
    { category: 'HARM_CATEGORY_HATE_SPEECH',       threshold: 'BLOCK_ONLY_HIGH' },
    { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_ONLY_HIGH' },
    { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_ONLY_HIGH' },
  ],
};
if (imageBase64.length) eccoBody.imageBase64 = imageBase64;
```

**We do not know if you are currently passing any of these to the Gemini backend.**
We have no way to verify from the API response whether these are being applied.

---

## 5. The Async Mode Problem

Your documentation recommends using async mode (via `callbackUrl`) for production. We
have found that async mode causes serious consistency issues:

- **Reference image stripping:** Some API gateways compress or strip high-resolution
  metadata from reference images to speed up async processing. This means the model
  receives a degraded version of the reference.
- **Model swapping:** In high-traffic async queues, requests may be silently routed to
  a different model (e.g. Flash instead of Pro) if the preferred model's queue is full.
- **Stateless processing:** Async mode may treat each request as a cold start, losing
  any conversation history or seed context.

**Request:** Please confirm whether any of the above occur in your async queue. We would
like to use synchronous (blocking) calls for quality-critical generations. Does your API
support a synchronous mode without a `callbackUrl`? Our tests suggest it does (we get
a `200` response with the image URL when we omit `callbackUrl`), but this is not
documented.

---

## 6. What We Are Asking For

In priority order:

1. **Confirm** whether `temperature`, `thinkingConfig`, `media_resolution`,
   `responseModalities`, and `safetySettings` are being passed through to the Gemini
   backend when included in our request body — or are they silently ignored?

2. **Add** these parameters to your documented API so we can rely on them.

3. **Return** the `thoughtSignature` from Gemini's response in your API response body,
   and **accept** it as an input parameter to pass back on the next request.

4. **Confirm** the synchronous mode behaviour (no `callbackUrl` = blocking response)
   and document it.

5. **Confirm** whether async mode performs any image compression or model swapping.

---

## 7. What Calling Google AI Directly Looks Like (For Reference)

This is how we call the Gemini API directly when using our Google AI provider:

```typescript
const response = await ai.models.generateContent({
  model: 'gemini-3.1-flash-image-preview',
  contents: [
    {
      role: 'user',
      parts: [
        { text: promptText },
        { inlineData: { mimeType: 'image/jpeg', data: base64ReferenceImage } },
      ],
    },
  ],
  config: {
    temperature:        1.0,
    responseModalities: ['TEXT', 'IMAGE'],
    thinkingConfig:     { includeThoughts: true },
    imageConfig: {
      aspectRatio:      '16:9',
      imageSize:        '1K',
      mediaResolution:  'media_resolution_high',
    },
    safetySettings: [
      { category: 'HARM_CATEGORY_HARASSMENT',        threshold: 'BLOCK_ONLY_HIGH' },
      { category: 'HARM_CATEGORY_HATE_SPEECH',       threshold: 'BLOCK_ONLY_HIGH' },
      { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_ONLY_HIGH' },
      { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_ONLY_HIGH' },
    ],
  },
});
```

This produces consistent, high-quality, reference-adherent images. We want the same
quality through your API at your lower cost.

---

Thank you for your time. We are happy to provide more details, share test prompts and
reference images that reproduce the inconsistency, or get on a call to discuss.
