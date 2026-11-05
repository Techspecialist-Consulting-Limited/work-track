import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Geist } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  display: "swap",
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
  themeColor: "#f4f2fa",
  colorScheme: "light",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <html lang="en" className={`${geistSans.variable} h-full`}>
      <body className="min-h-full font-sans text-wt-ink antialiased">{children}</body>
    </html>
  );
}
