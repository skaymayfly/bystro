import type { Metadata } from "next";
import { Geist, Roboto_Mono } from "next/font/google";
import type { ReactNode } from "react";

import { THEME_SCRIPT } from "@/lib/theme";

import "./globals.css";

// Czech needs the latin-ext subset (ě, š, č, ř, ž, ů, …).
const geist = Geist({ subsets: ["latin", "latin-ext"], variable: "--font-geist" });
// Small labels, as libraries.dev has them.
const robotoMono = Roboto_Mono({
  subsets: ["latin", "latin-ext"],
  weight: ["400", "500"],
  variable: "--font-roboto-mono",
});

export const metadata: Metadata = {
  title: "Bystro",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    // The theme script may set data-theme before React hydrates.
    <html lang="cs" className={`${geist.variable} ${robotoMono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
