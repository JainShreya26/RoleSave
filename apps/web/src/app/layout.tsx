import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { FormsReady } from "./forms-ready";
import "./globals.css";

// A click before the page has loaded would post its form natively. Next.js refuses
// that with an error page (see Referrer-Policy in next.config.ts), and the post
// would skip any confirmation prompt, so a click that early does nothing instead.
const holdFormsUntilReady = `document.addEventListener("submit",function(event){if(!window.__formsReady)event.preventDefault()},true)`;

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "RoleSave · Application Tracker",
  description: "A private, evidence-backed record of every job application.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`}><body><script dangerouslySetInnerHTML={{ __html: holdFormsUntilReady }} />{children}<FormsReady /></body></html>;
}
