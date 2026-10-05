import type { Metadata } from "next";
import { Onest } from "next/font/google";
import type { ReactNode } from "react";

import "./globals.css";

// Czech needs the latin-ext subset (ě, š, č, ř, ž, ů, …).
const onest = Onest({ subsets: ["latin", "latin-ext"], variable: "--font-onest" });

export const metadata: Metadata = {
  title: "Bystro",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="cs" className={onest.variable}>
      <body>{children}</body>
    </html>
  );
}
