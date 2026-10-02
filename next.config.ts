import type { NextConfig } from "next";
const config: NextConfig = {
  turbopack: { resolveAlias: { "@mediapipe/pose": "./src/stubs/mediapipe-pose.js" } },
};
export default config;
