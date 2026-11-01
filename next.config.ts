import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Every dashboard page is per-merchant and dynamic, so Cache Components'
  // static prerendering brings no benefit here; plain dynamic rendering is simpler.
  cacheComponents: false,
  experimental: {
    serverActions: {
      // CSV uploads up to 10 MB, plus multipart overhead.
      bodySizeLimit: "11mb",
    },
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
