import { RouterProvider } from "react-router-dom";
import { router } from "./router";
import { AppProviders } from "./providers";
import { ErrorBoundary } from "../components/common/ErrorBoundary";

export const App = () => (
  <ErrorBoundary>
    <AppProviders>
      <RouterProvider router={router} />
    </AppProviders>
  </ErrorBoundary>
);
