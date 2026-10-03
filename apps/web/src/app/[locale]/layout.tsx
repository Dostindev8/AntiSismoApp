import type { Metadata, Viewport } from "next";
import { Inter, Poppins } from "next/font/google";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import type { ReactNode } from "react";

import tokens from "@antisismo/config/tokens.json";

import { AuthProvider } from "@/components/auth/AuthProvider";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { routing } from "@/i18n/routing";

import "../globals.css";

const inter = Inter({ subsets: ["latin", "latin-ext"], variable: "--font-inter", display: "swap" });
const poppins = Poppins({
  subsets: ["latin", "latin-ext"],
  weight: ["700", "800"],
  variable: "--font-poppins",
  display: "swap",
});

type Props = { children: ReactNode; params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Omit<Props, "children">): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const t = await getTranslations({ locale, namespace: "meta" });
  return {
    title: t("title"),
    description: t("description"),
    applicationName: "AntiSismo",
    icons: { icon: "/brand/favicon.ico", apple: "/brand/apple-touch-icon.png" },
    alternates: {
      languages: Object.fromEntries(routing.locales.map((l) => [l, l === routing.defaultLocale ? "/" : `/${l}`])),
    },
  };
}

export const viewport: Viewport = {
  themeColor: tokens.colors.bgDeep,
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
};

export default async function LocaleLayout({ children, params }: Props) {
  await connection();
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const t = await getTranslations("a11y");

  return (
    <html lang={locale} className={`${inter.variable} ${poppins.variable}`}>
      <body className="font-sans antialiased">
        <NextIntlClientProvider>
          <AuthProvider>
          <a
            href="#contenido"
            className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-light-bg focus:px-4 focus:py-2 focus:text-brand-navy"
          >
            {t("skipToContent")}
          </a>
          <SiteHeader />
          <main id="contenido" tabIndex={-1} className="mx-auto max-w-6xl px-4 py-8 outline-none">
            {children}
          </main>
          <SiteFooter />
          </AuthProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
