/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The Context.dev SDK is server-only and must not be bundled for the browser.
  serverExternalPackages: ['context.dev'],
  // Keep the archived FastAPI demo out of the Next.js build.
  outputFileTracingExcludes: {
    '*': ['./legacy/**/*'],
  },
};

export default nextConfig;
