import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Serve from /conveneai so the root path is free for other services
  basePath: '/conveneai',

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
