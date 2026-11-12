import type { Metadata } from "next";
import { Newsreader, Source_Sans_3, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import { AudienceProvider } from "@/contexts/audience";

export const dynamic = "force-dynamic";

const newsreader = Newsreader({
  variable: "--font-newsreader",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  style: ["normal", "italic"],
});

const sourceSans = Source_Sans_3({
  variable: "--font-source-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

const ibmPlexMono = IBM_Plex_Mono({
  variable: "--font-ibm-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

const TITLE = "PACT — Canonical Layer of Agreement · Space, Fabric & Seam";
const DESCRIPTION =
  "Australian intelligence for the world. Cheap, safe, secure, reliable tokens. One protocol and managed service for shared truth, AI routing, qualified capacity, and human authority.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  metadataBase: new URL("https://pact.tailor.au"),
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: "https://pact.tailor.au",
    siteName: "PACT",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,500;0,6..72,600;1,6..72,400&family=Source+Sans+3:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body
        className={`${newsreader.variable} ${sourceSans.variable} ${ibmPlexMono.variable} antialiased`}
        style={{
          margin: 0,
          background: "#FFFFFF",
          color: "#0A0A0A",
          fontFamily: "'Source Sans 3', system-ui, sans-serif",
        }}
      >
        <AudienceProvider>{children}</AudienceProvider>
      </body>
    </html>
  );
}
