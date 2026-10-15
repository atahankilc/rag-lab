import { createContext, useCallback, useContext, useMemo, type ReactNode } from "react";
import { useSearchParams } from "react-router";
import { useExperiments } from "../api/hooks";
import type { Experiment } from "../api/types";

// The app's "checkpoint" is the version (experiment). It lives in the URL (?v=v3&ref=baseline),
// so every page shows the same version, scrubbing moves them all, and a link reproduces the view.

export type RefMode = "parent" | "baseline";

interface VersionState {
  experiments: Experiment[];
  current: Experiment | undefined;
  index: number;
  parent: Experiment | undefined;
  baseline: Experiment | undefined;
  /** what deltas compare against: the parent or the pinned baseline (undefined for the root / the baseline itself) */
  reference: Experiment | undefined;
  refMode: RefMode;
  setSlug: (slug: string) => void;
  step: (by: number) => void;
  setRefMode: (mode: RefMode) => void;
  isLoading: boolean;
  error: Error | null;
}

const VersionContext = createContext<VersionState | null>(null);

export function VersionProvider({ children }: { children: ReactNode }) {
  const { data, isLoading, error } = useExperiments();
  const [params, setParams] = useSearchParams();
  const experiments = useMemo(() => data ?? [], [data]);

  const slug = params.get("v");
  const refMode: RefMode = params.get("ref") === "baseline" ? "baseline" : "parent";
  const index = Math.max(0, slug ? experiments.findIndex((e) => e.slug === slug) : experiments.length - 1);
  const current = experiments[index];
  const parent = current?.parent_id != null ? experiments.find((e) => e.id === current.parent_id) : undefined;
  const baseline = experiments.find((e) => e.is_baseline);
  const reference = refMode === "parent" ? parent : baseline && baseline.id !== current?.id ? baseline : undefined;

  const update = useCallback(
    (key: string, value: string) =>
      setParams(
        (p) => {
          const next = new URLSearchParams(p);
          next.set(key, value);
          return next;
        },
        { replace: true },
      ),
    [setParams],
  );

  const setSlug = useCallback((s: string) => update("v", s), [update]);
  const setRefMode = useCallback((m: RefMode) => update("ref", m), [update]);
  const step = useCallback(
    (by: number) => {
      const next = experiments[Math.min(experiments.length - 1, Math.max(0, index + by))];
      if (next) update("v", next.slug);
    },
    [experiments, index, update],
  );

  const value: VersionState = {
    experiments,
    current,
    index,
    parent,
    baseline,
    reference,
    refMode,
    setSlug,
    step,
    setRefMode,
    isLoading,
    error: error as Error | null,
  };
  return <VersionContext.Provider value={value}>{children}</VersionContext.Provider>;
}

export function useVersion(): VersionState {
  const v = useContext(VersionContext);
  if (!v) throw new Error("useVersion must be used inside VersionProvider");
  return v;
}

/** Keep ?v and ?ref (and the Compare pages' ?with) when moving between pages. */
export function useWithSearch() {
  const [params] = useSearchParams();
  return (path: string) => {
    const keep = new URLSearchParams();
    for (const k of ["v", "ref", "with"]) {
      const val = params.get(k);
      if (val) keep.set(k, val);
    }
    const qs = keep.toString();
    return qs ? `${path}?${qs}` : path;
  };
}
