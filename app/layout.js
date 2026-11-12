import Link from "next/link";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export const metadata = {
  title: "DisputeDraft",
  description: "AI co-pilot for PayPal disputes",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={inter.variable}>
      <body>
        <header className="topbar">
          <div className="topbar-inner">
            <Link href="/" className="brand">
              <span className="brand-mark">⚖</span>
              DisputeDraft
            </Link>
            <div className="topbar-meta">
              <span>Fernhill Goods</span>
              <span className="pill-live">PayPal sandbox</span>
            </div>
          </div>
        </header>
        {children}
      </body>
    </html>
  );
}
