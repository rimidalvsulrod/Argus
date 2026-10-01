import type { Metadata, Viewport } from "next";
import "./globals.css";
export const metadata: Metadata = { title: "ARGUS", description: "Hundred-eyed tripwire", robots: { index: false, follow: false } };
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#04060b" };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (<html lang="en"><body>{children}</body></html>);
}
