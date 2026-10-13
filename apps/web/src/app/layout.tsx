import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { THEME_INIT_SCRIPT } from "@/lib/theme";
import "./globals.css";

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
    default: "SocialPush — Social Media Scheduler",
    template: "%s · SocialPush",
  },
  description:
    "Write once, publish everywhere. SocialPush schedules and publishes posts, reels and videos to YouTube, Instagram, Facebook, Threads, LinkedIn, Pinterest and more, with AI captions, a content calendar, analytics and a unified comments inbox.",
  applicationName: "SocialPush",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // The inline script below sets `class="dark"` / color-scheme from the saved theme before first paint,
    // so the server-rendered attributes may differ from the DOM on hydration.
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-full flex flex-col bg-canvas text-fg">{children}</body>
    </html>
  );
}
