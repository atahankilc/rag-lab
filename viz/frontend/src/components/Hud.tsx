import { Cpu, ScrollText } from "lucide-react";
import { Fragment, useLayoutEffect, useRef, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router";
import { useVersion, useWithSearch } from "../state/version";
import { Dock } from "./Dock";
import { Centered, ErrorNote, Loading } from "./Loading";
import { LoginDialog } from "./LoginDialog";
import { Logo } from "./Logo";
import { Timeline } from "./Timeline";
import { AccountMenu, ThemeMenu } from "./Utilities";

interface Tab {
  path: string;
  label: string;
  subs?: { path: string; label: string }[];
}

// Text tabs with one blue underline that glides to the open section. A section with subpages shows
// them on a quieter row underneath, centred under its tab.
export const TABS: Tab[] = [
  { path: "/", label: "Pipeline" },
  { path: "/space", label: "Space" },
  { path: "/questions", label: "Questions" },
  {
    path: "/compare",
    label: "Compare",
    subs: [
      { path: "/compare", label: "Metrics" },
      { path: "/compare/config", label: "Config" },
    ],
  },
  { path: "/runs", label: "Runs" },
];

const inSection = (pathname: string, t: Tab) =>
  t.path === "/" ? pathname === "/" : pathname === t.path || pathname.startsWith(`${t.path}/`);

// Pages about one version: the timeline picks that version. Runs, Providers and Log span all
// versions, so the timeline would do nothing there and is left out.
const VERSIONED = new Set(["/", "/space", "/questions", "/compare", "/compare/config"]);

/** The fixed corner instruments around a full-bleed page. */
export function Hud() {
  const withSearch = useWithSearch();
  const { pathname } = useLocation();
  const { isLoading, error, experiments } = useVersion();
  const versioned = VERSIONED.has(pathname);
  const section = TABS.find((t) => inSection(pathname, t));

  // where the underline sits: under the open section's tab (measured, so it can glide between tabs)
  const tabsRef = useRef<HTMLDivElement>(null);
  const [under, setUnder] = useState<{ left: number; width: number } | null>(null);
  useLayoutEffect(() => {
    const place = () => {
      const el = tabsRef.current?.querySelector<HTMLElement>(".nav-tab[aria-current='page']");
      setUnder(el ? { left: el.offsetLeft, width: el.offsetWidth } : null);
    };
    place();
    document.fonts?.ready.then(place);
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [pathname]);

  return (
    <div className={`hud ${versioned ? "" : "no-timeline"} ${section?.subs ? "has-subs" : ""}`}>
      <main className="stage" id="main">
        {error ? (
          <Centered>
            <ErrorNote error={error} />
          </Centered>
        ) : isLoading ? (
          <Centered>
            <Loading label="Loading versions" />
          </Centered>
        ) : experiments.length === 0 && versioned ? (
          <Centered>
            <div className="empty-state">
              <p className="section-head">No versions yet</p>
              <p className="lede">
                A version appears here when a RAG spike registers one. It follows the steps in{" "}
                <code>viz/docs/backend-contract.md</code>: register the corpus, chunks and vectors, declare the
                version's steps, then run it. Runs, Providers and Log already work.
              </p>
            </div>
          </Centered>
        ) : (
          <Outlet />
        )}
      </main>

      <nav className="top-nav" aria-label="Pages">
        <NavLink to={withSearch("/")} className="wordmark" aria-label="RAG Lab home">
          <Logo />
          <span>RAG Lab</span>
        </NavLink>
        <div className="nav-tabs" ref={tabsRef}>
          {TABS.map((t) => (
            <NavLink
              key={t.path}
              to={withSearch(t.path)}
              end={t.path === "/"}
              className="nav-tab"
              aria-current={section === t ? "page" : undefined}
            >
              {t.label}
            </NavLink>
          ))}
          <span
            className={`nav-under ${under ? "" : "off"}`}
            aria-hidden
            style={under ? { transform: `translateX(${under.left}px)`, width: under.width } : undefined}
          />
          {section?.subs && under ? (
            <span
              className="nav-subs"
              role="group"
              aria-label={`${section.label} pages`}
              style={{ left: under.left + under.width / 2 }}
            >
              {section.subs.map((sub, i) => (
                <Fragment key={sub.path}>
                  {i > 0 ? (
                    <span className="nav-dot" aria-hidden>
                      ·
                    </span>
                  ) : null}
                  <NavLink
                    to={withSearch(sub.path)}
                    end
                    className="nav-sub"
                    aria-current={pathname === sub.path ? "page" : undefined}
                  >
                    {sub.label}
                  </NavLink>
                </Fragment>
              ))}
            </span>
          ) : null}
        </div>
      </nav>

      <div className="top-right">
        <NavLink
          to={withSearch("/providers")}
          className="nav-link"
          aria-label="Providers"
          aria-current={pathname === "/providers" ? "page" : undefined}
        >
          <Cpu /> <span className="pill-text">Providers</span>
        </NavLink>
        <NavLink
          to={withSearch("/log")}
          className="nav-link"
          aria-label="Log"
          aria-current={pathname === "/log" ? "page" : undefined}
        >
          <ScrollText /> <span className="pill-text">Log</span>
        </NavLink>
        <ThemeMenu />
        <AccountMenu />
      </div>

      <LoginDialog />

      {experiments.length ? (
        <>
          {/* the Run panel repeats the Runs page, so it isn't offered there */}
          <Dock showRun={pathname !== "/runs"} />
          {versioned ? <Timeline /> : null}
        </>
      ) : null}
    </div>
  );
}
