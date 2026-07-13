import type { NextConfig } from "next";

// Serve from /conveneai so the root path is free for other services
const BASE_PATH = "/conveneai";

const nextConfig: NextConfig = {
  basePath: BASE_PATH,
  env: {
    // Inlined into client bundles; used by lib/api-path.ts to prefix
    // fetch()/EventSource URLs, which basePath does not rewrite.
    NEXT_PUBLIC_BASE_PATH: BASE_PATH,
  },

  // Flat structure: no src/ directory — App Router reads from app/ at root

  experimental: {
    // The proxy (middleware) buffers request bodies and truncates them at
    // 10MB by default, corrupting large multipart uploads. /api is excluded
    // from the proxy matcher, but keep this aligned with the 500MB upload cap
    // in case the matcher ever widens.
    proxyClientMaxBodySize: "500mb",
  },
};

export default nextConfig;
