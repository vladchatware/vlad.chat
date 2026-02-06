import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { ConvexClientProvider } from "./ConvexContextProvider";
import { ConvexAuthNextjsServerProvider } from "@convex-dev/auth/nextjs/server"

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "Chat with Vlad - Expert Developer",
    template: "%s | Vlad.chat",
  },
  description: "Chat with Vlad, a software developer with over a decade of experience. Get expert answers, technical insights, and personalized assistance for your coding questions. Start your conversation today.",
  openGraph: {
    type: "website",
    locale: "en_US",
    siteName: "Vlad.chat",
    title: "Chat with Vlad - Expert Developer",
    description: "Chat with Vlad, a software developer with over a decade of experience. Get expert answers, technical insights, and personalized assistance for your coding questions. Start your conversation today.",
    images: [
      {
        url: "/opengraph-image",
        width: 1200,
        height: 630,
        alt: "Chat with Vlad - Expert Developer",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Chat with Vlad - Expert Developer",
    description: "Chat with Vlad, a software developer with over a decade of experience. Get expert answers, technical insights, and personalized assistance for your coding questions. Start your conversation today.",
    images: ["/opengraph-image"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ConvexAuthNextjsServerProvider>
      <html lang="en">
        <body
          className={`${geistSans.variable} ${geistMono.variable} antialiased`}
        >
          <ConvexClientProvider>
            {children}
          </ConvexClientProvider>
        </body>
      </html>
    </ConvexAuthNextjsServerProvider>
  );
}
