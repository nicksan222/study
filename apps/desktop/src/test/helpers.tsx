import { render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { LanguageProvider, type Locale } from "../i18n";
import type { ReactNode } from "react";
export function renderPage(node: ReactNode, locale: Locale = "english") {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchInterval: false },
      mutations: { retry: false },
    },
  });
  return {
    ...render(node, {
      wrapper: ({ children }) => (
        <QueryClientProvider client={client}>
          <LanguageProvider locale={locale}>{children}</LanguageProvider>
        </QueryClientProvider>
      ),
    }),
    client,
  };
}
