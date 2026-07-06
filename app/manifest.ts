import type { MetadataRoute } from "next";

// Enables real "Add to Home Screen" installs (not just a browser bookmark
// shortcut) - see app/apple-icon.tsx for why iOS specifically also needs its
// own apple-touch-icon regardless of this manifest. icon-192.png/icon-512.png
// are pre-generated static crops of public/logo.jpeg (same crop region as
// apple-icon.tsx), checked in rather than generated per-request since they
// never change.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Double K Top",
    short_name: "Double K Top",
    start_url: "/",
    display: "standalone",
    theme_color: "#1e4a6d",
    background_color: "#f7fbfd",
    lang: "he",
    dir: "rtl",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
