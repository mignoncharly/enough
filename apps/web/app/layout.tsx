import type { Metadata } from "next";
import "./globals.css";
import { ThemeSync } from "./theme-sync";

export const metadata: Metadata = {
  title: "Enough",
  description: "Earn your next coding session by getting market signal.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <ThemeSync />
        {children}
      </body>
    </html>
  );
}
