import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Produces a minimal, self-contained server (.next/standalone) with only the traced
  // dependencies it actually needs - what apps/web/Dockerfile copies into the runtime image.
  // Has no effect on `next dev` or a non-Docker `next start`.
  output: 'standalone',
};

export default nextConfig;
