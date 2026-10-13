import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
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
    <html
      lang="en"
      style={{ colorScheme: "dark" }}
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
