import type { Metadata, Viewport } from "next";
import { Heebo } from "next/font/google";
import "./globals.css";

const heebo = Heebo({
  variable: "--font-heebo",
  subsets: ["hebrew", "latin"],
});

export const metadata: Metadata = {
  title: "Double K Top",
  description: "מערכת לניהול שיבוצי תורנויות יומיים בקורס מדריכי רכיבה - דאבל קיי",
  manifest: "/manifest.webmanifest",
  // capable:true + statusBarStyle is what makes iOS treat a home-screen
  // install as a standalone app (hides Safari's chrome) instead of just
  // opening the bookmarked URL in a normal browser tab.
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Double K Top",
  },
};

// Next 16 requires theme-color in the separate viewport export, not metadata.
export const viewport: Viewport = {
  themeColor: "#1e4a6d",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="he" dir="rtl" className={`${heebo.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-background text-card-foreground">
        {children}
      </body>
    </html>
  );
}
