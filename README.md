# ARGUS — hundred-eyed tripwire

Turn an Android phone into a camera tripwire. Detects **humans (MoveNet skeleton tracking), movement, light changes, sound, unknown faces** (learns faces you teach it) and **deviation from a calibrated zero point**. The **Console** shows the live feed with a tracking overlay and raises alerts with an alarm sound, vibration and annotated snapshot. All detection runs on the phone; models are bundled in `public/models`.

Live video is peer-to-peer WebRTC (PeerJS cloud signalling, no video through the backend). If a direct link can't be made, the Console falls back to a relay frame refreshed every 15s. Optional self-hosted PeerJS server: set `NEXT_PUBLIC_PEER_HOST` / `NEXT_PUBLIC_PEER_PORT` / `NEXT_PUBLIC_PEER_PATH`.

## Deploy (Vercel)
1. Import this repo in Vercel.
2. **Storage → Marketplace → Upstash Redis** → connect to the project (adds `KV_REST_API_URL` / `KV_REST_API_TOKEN`).
3. Optional: set env var **`ARGUS_KEY`** to override the default access key (`123`).
4. Deploy. (Without Redis it falls back to server memory, which is unreliable on serverless.)

## Use
- **Camera phone** (Android Chrome): open the site → enter key → *Sentry* → Activate. Allow camera + mic. Prop it up, plug it in, keep the screen on (it holds a wake-lock; *Stealth screen* blacks it out).
- **Viewing device**: open site → *Console* → Engage (unlocks alarm audio). Live feed, alerts, detection settings, arm/disarm.
- **Calibrate**: Console → Live → *Set zero* with the room as it should be. The gauge shows % deviation from zero; crossing the trip point alerts.
- **Faces**: on the Sentry page type a name and *Learn face*, or tap an "unknown face" alert in the Console and name it. Unknown-face alerts fire for anyone not learned.

## Notes
- Requires HTTPS (Vercel provides it) for camera/mic. Background tabs and locked screens throttle browsers — keep Sentry in the foreground.
- Console polls every 4s while visible (1 Redis command per poll); Sentry heartbeats every 15s.
- Local dev: `npm i && npm run dev` (access key defaults to `123`).

_Deployed on Vercel._
