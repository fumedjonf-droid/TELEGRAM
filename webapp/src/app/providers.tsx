import { PropsWithChildren } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const client = new QueryClient();

export const AppProviders = ({ children }: PropsWithChildren) => (
  <QueryClientProvider client={client}>{children}</QueryClientProvider>
);
