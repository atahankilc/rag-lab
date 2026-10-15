import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createBrowserRouter, RouterProvider } from "react-router";
import { Hud } from "./components/Hud";
import { Log } from "./pages/Log";
import { Compare, CompareConfig } from "./pages/Compare";
import { Pipeline } from "./pages/Pipeline";
import { Providers } from "./pages/Providers";
import { Questions } from "./pages/Questions";
import { Runs } from "./pages/Runs";
import { Space } from "./pages/Space";
import { VersionProvider } from "./state/version";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

function Root() {
  return (
    <VersionProvider>
      <Hud />
    </VersionProvider>
  );
}

const router = createBrowserRouter([
  {
    path: "/",
    element: <Root />,
    children: [
      { index: true, element: <Pipeline /> },
      { path: "space", element: <Space /> },
      { path: "questions", element: <Questions /> },
      { path: "compare", element: <Compare /> },
      { path: "compare/config", element: <CompareConfig /> },
      { path: "runs", element: <Runs /> },
      { path: "providers", element: <Providers /> },
      { path: "log", element: <Log /> },
    ],
  },
]);

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}
