/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: { serverComponentsExternalPackages: ["@paypal/agent-toolkit"] },
};
export default nextConfig;
