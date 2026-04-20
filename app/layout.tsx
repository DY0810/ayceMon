import type { Metadata, Viewport } from "next";
import { Inter, Space_Grotesk } from "next/font/google";
import "./globals.css";
import { GuestMigrationEffect } from "@/components/guest-migration-effect";
import { NavServer } from "@/components/nav-server";

const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
});

const spaceGrotesk = Space_Grotesk({
  variable: "--font-display",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "ayceMon — make your money worth at AYCE",
  description:
    "Track buffet items, get high-value combo suggestions, and find out if you beat the all-you-can-eat price.",
  icons: {
    icon: "/favicon.svg",
    apple: "/logo.svg",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${spaceGrotesk.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <NavServer />
        <GuestMigrationEffect />
        <div className="flex-1">{children}</div>
      </body>
    </html>
  );
}
