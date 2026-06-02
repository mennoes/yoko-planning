import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Aggressieve cache-headers voor static assets — Vercel's default is
  // max-age=0 voor /public/, wat betekent dat /team/menno.jpg en de
  // fonts bij elke page-load opnieuw via de edge gestreamd worden.
  // Met immutable-cache van 1 jaar haalt de browser ze één keer en
  // herhaalt-ie ze niet, scheelt veel Fast Origin Transfer-quota.
  //
  // Wijzigingen aan een asset? Geef de file een andere naam (bv.
  // menno-v2.jpg) — dan downloadt de browser 'm wel weer omdat de
  // URL nieuw is.
  async headers() {
    return [
      {
        source: '/team/:path*',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
        ],
      },
      {
        source: '/fonts/:path*',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
        ],
      },
    ]
  },
};

export default nextConfig;
