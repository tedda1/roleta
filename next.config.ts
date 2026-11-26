import type { NextConfig } from "next";

// Export estático: a pasta out/ roda em qualquer servidor local, sem Node e sem internet no dia.
const nextConfig: NextConfig = {
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
  reactStrictMode: true,
};

export default nextConfig;
