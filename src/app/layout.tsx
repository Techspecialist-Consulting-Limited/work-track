import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { DM_Sans } from "next/font/google";
import "./globals.css";

const dmSans = DM_Sans({
  variable: "--font-dm-sans",
  subsets: ["latin"],
  display: "swap",
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: {
    default: "WorkTrack",
    template: "%s · WorkTrack",
  },
  description:
    "WorkTrack is a calm, always-available companion for reporting work activity, taking breaks and keeping your workday on track.",
  applicationName: "WorkTrack",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#f4f2fa",
  colorScheme: "light",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <html lang="en" className={`${dmSans.variable} h-full`}>
      <body className="min-h-full text-wt-ink antialiased">{children}</body>
    </html>
  );
}
