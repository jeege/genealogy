import type { Metadata } from "next";
import { Geist, Noto_Serif_SC } from "next/font/google";
import { ThemeProvider } from "next-themes";
import { Analytics } from "@vercel/analytics/next";
import NextTopLoader from "nextjs-toploader";
import "./globals.css";
import { getPublicRuntimeConfig } from "@/lib/runtime-config";
import { RuntimeConfigProvider } from "@/components/runtime-config-provider";

export const metadata: Metadata = {
  title: "族谱管理系统",
  description: "基于 Go + PostgreSQL 构建的家族族谱管理系统",
};

const geistSans = Geist({
  variable: "--font-geist-sans",
  display: "swap",
  subsets: ["latin"],
});

const notoSerifSC = Noto_Serif_SC({
  variable: "--font-noto-serif-sc",
  weight: ["200", "300", "400", "500", "600", "700", "900"],
  subsets: ["latin"],
  display: "swap",
});

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const initialConfig = getPublicRuntimeConfig();
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body className={`${geistSans.variable} ${notoSerifSC.variable} font-serif antialiased`}>
        <RuntimeConfigProvider initialConfig={initialConfig}>
          <NextTopLoader color="#2A6E4D" showSpinner={false} shadow="0 0 10px #2A6E4D,0 0 5px #2A6E4D" />
          <ThemeProvider
            attribute="class"
            defaultTheme="system"
            enableSystem
            disableTransitionOnChange
          >
            {children}
          </ThemeProvider>
          {process.env.VERCEL === "1" && <Analytics />}
        </RuntimeConfigProvider>
      </body>
    </html>
  );
}
