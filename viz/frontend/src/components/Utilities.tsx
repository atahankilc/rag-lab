import { LogIn, LogOut, Moon, Sun, UserRound } from "lucide-react";
import { useRef, useState } from "react";
import { shortDate } from "../lib/format";
import { useAuth } from "../state/auth";
import { setThemePref, type ThemePref, useTheme } from "../state/theme";
import { Popover } from "./Popover";
import { Segmented } from "./Segmented";

const THEMES: { value: ThemePref; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

/** Top right: light or dark, picked from a small popover. */
export function ThemeMenu() {
  const { pref, theme } = useTheme();
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  return (
    <span className="util-wrap">
      <button ref={anchor} type="button" className="nav-link" aria-label="Theme" aria-expanded={open}
              aria-pressed={open} onClick={() => setOpen(!open)}>
        {theme === "light" ? <Sun /> : <Moon />}
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchor={anchor} label="Theme" className="util-pop">
        <p className="section-head">Theme</p>
        <Segmented ariaLabel="Theme" value={pref} options={THEMES} onChange={setThemePref} />
        <p className="label">{pref === "system" ? `Follows the system: ${theme} now.` : "Kept in this browser."}</p>
      </Popover>
    </span>
  );
}

/** Top right: "Log in", or who is logged in with a way out. */
export function AccountMenu() {
  const { username, expiresAt, ask, logout, checking } = useAuth();
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  if (checking) return null;
  if (!username) {
    return (
      <button type="button" className="nav-link" aria-label="Log in" onClick={ask}>
        <LogIn /> <span className="pill-text">Log in</span>
      </button>
    );
  }
  return (
    <span className="util-wrap">
      <button ref={anchor} type="button" className="nav-link" aria-label={`Logged in as ${username}`}
              aria-expanded={open} aria-pressed={open} onClick={() => setOpen(!open)}>
        <UserRound /> <span className="pill-text">{username}</span>
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchor={anchor} label="Account" className="util-pop">
        <p className="section-head">Logged in</p>
        <p className="util-user">{username}</p>
        {expiresAt ? <p className="label">Until {shortDate(expiresAt)}, then log in again.</p> : null}
        <button type="button" className="pill small" onClick={() => { setOpen(false); logout(); }}>
          <LogOut /> Log out
        </button>
      </Popover>
    </span>
  );
}
