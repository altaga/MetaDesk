import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { PwaRegister } from "@/features/pwa/PwaRegister";
import "./globals.css";
import "./landing.css";
import "./desk.css";
import "./setup.css";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: {
    default: "MetaDesk — your board, run by Muse",
    template: "%s · MetaDesk",
  },
  description:
    "MetaDesk is an operator desk whose brain lives on your own board, powered by the Meta Muse model ladder.",
  applicationName: "MetaDesk",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: "/icon.svg",
    apple: "/apple-touch-icon",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "MetaDesk",
  },
  formatDetection: {
    telephone: false,
  },
};

export const viewport: Viewport = {
  themeColor: "#0f1012",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body>
        <PwaRegister />
        {children}
      </body>
    </html>
  );
}
