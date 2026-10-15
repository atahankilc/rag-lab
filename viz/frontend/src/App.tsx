import { MutationCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApiError } from "./api/client";
import { createBrowserRouter, RouterProvider } from "react-router";
import { Hud } from "./components/Hud";
import { Log } from "./pages/Log";
import { Compare, CompareConfig } from "./pages/Compare";
import { Pipeline } from "./pages/Pipeline";
import { Providers } from "./pages/Providers";
import { Questions } from "./pages/Questions";
import { Runs } from "./pages/Runs";
import { Space } from "./pages/Space";
import { AuthProvider } from "./state/auth";
import { VersionProvider } from "./state/version";

const queryClient: QueryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
  // a write refused for want of a session (it ended, or was logged out elsewhere): recheck, which locks the UI
  mutationCache: new MutationCache({
    onError: (e) => {
      if (e instanceof ApiError && e.status === 401) queryClient.invalidateQueries({ queryKey: ["session"] });
    },
  }),
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
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </QueryClientProvider>
  );
}
