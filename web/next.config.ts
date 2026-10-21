import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  // Compression buffers the log stream (/api/events); Cloudflare compresses anyway.
  compress: false,
}

export default nextConfig
