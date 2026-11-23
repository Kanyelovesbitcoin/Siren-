/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  images: { unoptimized: true },
  // Playbooks are read from disk at runtime; ship them with any traced server output.
  outputFileTracingIncludes: {
    "/api/playbooks": ["./playbooks/**/*.json"],
    "/api/audit": ["./playbooks/**/*.json"],
  },
};

export default nextConfig;
