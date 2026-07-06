import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["jsdom", "puppeteer"],
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
