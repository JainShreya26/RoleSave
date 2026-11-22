import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { FormsReady } from "./forms-ready";
import "./globals.css";

// Install the guard while the browser parses the page. An early native post
// skips confirmation prompts and Next.js rejects it under our Referrer-Policy.
// React treats this markup as opaque, even if it has to recover from hydration.
const formGuardMarkup = `<script>
document.addEventListener("submit", function (event) {
  if (!window.__formsReady) event.preventDefault();
}, true);
</script>`;

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "RoleSave · Application Tracker",
  description: "A private, evidence-backed record of every job application.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body>
        <div hidden dangerouslySetInnerHTML={{ __html: formGuardMarkup }} />
        {children}
        <FormsReady />
      </body>
    </html>
  );
}
