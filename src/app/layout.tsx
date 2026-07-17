import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Reel Engine",
  description: "Generate client reels: script, voice, avatar and B-roll.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // suppressHydrationWarning on <html> and <body> only: browser extensions
    // (password managers, Grammarly, theme switchers) mutate these two elements
    // before React hydrates, which React reports as a mismatch we neither caused
    // nor can prevent. Left alone, that noise trains you to ignore the overlay
    // and hides real hydration bugs. It is one level deep, so genuine mismatches
    // inside the app still surface.
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
