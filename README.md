# ARGUS — hundred-eyed tripwire

Turn an Android phone into a camera tripwire. Detects **humans, movement, light changes, sound, any scene change, and unknown faces** (learns faces you teach it). Alerts hit a **Console** on your viewing device with an alarm sound, vibration and snapshot. All detection runs on the phone; models are bundled in `public/models`.

## Deploy (Vercel)
1. Import this repo in Vercel.
2. **Storage → Marketplace → Upstash Redis** → connect to the project (adds `KV_REST_API_URL` / `KV_REST_API_TOKEN`).
3. Add env var **`ARGUS_KEY`** = your secret access key.
4. Deploy. (Without Redis it falls back to server memory, which is unreliable on serverless.)

## Use
- **Camera phone** (Android Chrome): open the site → enter key → *Sentry* → Activate. Allow camera + mic. Prop it up, plug it in, keep the screen on (it holds a wake-lock; *Stealth screen* blacks it out).
- **Viewing device**: open site → *Console* → Engage (unlocks alarm audio). Toggle detections, sensitivity, cooldown, arm delay, arm/disarm remotely.
- **Faces**: on the Sentry page type a name and *Learn face*, or tap an "unknown face" alert in the Console and name it. Unknown-face alerts fire for anyone not learned.

## Notes
- Requires HTTPS (Vercel provides it) for camera/mic. Background tabs and locked screens throttle browsers — keep Sentry in the foreground.
- Console polls every 4s while visible (1 Redis command per poll); Sentry heartbeats every 15s.
- Local dev: `npm i && npm run dev` (access key defaults to `argus`).

_Deployed on Vercel._
