import type { Metadata } from "next";
import { Geist } from "next/font/google";
import type { ReactNode } from "react";

import "./globals.css";

// Czech needs the latin-ext subset (ě, š, č, ř, ž, ů, …).
const geist = Geist({ subsets: ["latin", "latin-ext"], variable: "--font-geist" });

export const metadata: Metadata = {
  title: "Bystro",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="cs" className={geist.variable}>
      <body>{children}</body>
    </html>
  );
}
