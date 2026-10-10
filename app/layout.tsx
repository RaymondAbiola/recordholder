import type { Metadata, Viewport } from "next";
import { Source_Serif_4, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

const serif = Source_Serif_4({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-serif",
});

const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
  variable: "--font-mono",
});

// The page has its own light and dark themes. Declaring that tells browsers not to run their
// forced-dark algorithm on top, which otherwise inverts the chart bars to near-black on phones
// with a "dark pages" setting.
export const viewport: Viewport = {
  colorScheme: "light dark",
};

export const metadata: Metadata = {
  metadataBase: new URL("https://recordholder.vercel.app"),
  title: "Recordholder",
  description:
    "The corporate action and dividend record for BEP-677 tokenized stocks on BNB Chain.",
  openGraph: {
    title: "Recordholder",
    description:
      "Tokenized stocks on BNB Chain pay dividends by moving a hidden multiplier. No balance changes and nothing reports it. This reconstructs it.",
    type: "website",
  },
  twitter: { card: "summary_large_image" },
  other: { "darkreader-lock": "true" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${serif.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
