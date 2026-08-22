import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
// The EZER theme: light + dark colour, elevation, and the ground the app sits
// on. Imported as a module so the bundler serves it — a CSS @import inside
// globals.css is not resolved by the Tailwind pipeline and silently 404s.
import "@/lib/ui/theme.css";
import AutoTitleCase from "@/components/AutoTitleCase";
import UiScale from "@/components/UiScale";
import { themeBootScript } from "@/lib/ui/ThemeToggle";
import { eyeComfortBootScript, EyeComfortLayer, EyeComfortOverlay, EyeComfortDock } from "@/lib/ui/EyeComfort";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "EZER HRMS",
  description: "Hiring, people, time and payroll for the Sharma Group.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en-IN"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        {/* Applies the stored theme before first paint. Without it the page
            renders light, then corrects itself once React runs — a white
            flash on every load for anyone using dark. */}
        <script dangerouslySetInnerHTML={{ __html: themeBootScript }} />
        {/* Same reasoning as the theme: someone who turned eye comfort on
            because bright screens hurt should not be shown an unfiltered
            white page for 300ms on every load. */}
        <script dangerouslySetInnerHTML={{ __html: eyeComfortBootScript }} />
      </head>
      <body className="min-h-full flex flex-col">
        <AutoTitleCase />
        <UiScale />
        <EyeComfortLayer />
        {children}
        {/* Last in the body so it composites over everything, including any
            modal or toast. pointer-events:none keeps clicks passing through. */}
        <EyeComfortDock />
        <EyeComfortOverlay />
      </body>
    </html>
  );
}
