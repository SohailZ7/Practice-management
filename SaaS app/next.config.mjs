const isProd = process.env.NODE_ENV === "production";

// Headers that never change per request. The Content-Security-Policy (per-request nonce) and Cache-Control: no-store
// are added in src/middleware.ts.
export const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "no-referrer" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=(), accelerometer=(), gyroscope=(), magnetometer=(), interest-cohort=()",
  },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
  ...(isProd ? [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }] : []),
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  // Nothing uses next/image; turning the optimizer off removes the unauthenticated /_next/image endpoint (F1 exposure check).
  images: { unoptimized: true },
  experimental: {
    serverComponentsExternalPackages: ["exceljs"],
    // src/instrumentation.ts refuses to start production without PHI_ENCRYPTION_KEY.
    instrumentationHook: true,
    // Feedback screenshots arrive with the form: up to 5 images of 3 MB.
    serverActions: { bodySizeLimit: "16mb" },
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
