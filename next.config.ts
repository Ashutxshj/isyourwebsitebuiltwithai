import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["jsdom", "puppeteer"],
  // Make sure the compressed Chrome binaries ship with the serverless function.
  outputFileTracingIncludes: {
    "/api/analyze": ["./node_modules/@sparticuz/chromium/bin/**/*"],
  },
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
