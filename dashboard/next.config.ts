import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'export',
  basePath: '/reflexive',
  trailingSlash: true,
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
