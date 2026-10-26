import { createContext, useContext, type ReactNode } from "react";
import { catalogs, type Locale, type MessageKey } from "./generated/catalog";
export { type Locale, type MessageKey };
const LanguageContext = createContext<Locale>("english");
export function LanguageProvider({
  locale,
  children,
}: {
  locale: Locale;
  children: ReactNode;
}) {
  return <LanguageContext value={locale}>{children}</LanguageContext>;
}
export function useI18n() {
  const locale = useContext(LanguageContext);
  return {
    locale,
    t: (key: MessageKey): string => catalogs[locale][key],
    number: (value: number | bigint) =>
      new Intl.NumberFormat(locale === "italian" ? "it-IT" : "en-US").format(
        value,
      ),
    date: (value: number | bigint) =>
      new Intl.DateTimeFormat(locale === "italian" ? "it-IT" : "en-US", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(Number(value) * 1000),
  };
}
