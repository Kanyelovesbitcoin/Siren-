import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Siren · Local AI Security Bench",
  description: "Stress-test your localhost AI endpoints against the OWASP Top 10 for LLM Applications.",
  icons: { icon: "/siren.svg" },
};

export const viewport: Viewport = {
  themeColor: "#0b0b0e",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
