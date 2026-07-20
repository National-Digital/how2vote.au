import { browser } from "$app/environment";

const KEY = "how2vote:theme";
export type ThemePref = "light" | "dark" | "system";

/**
 * Theme preference. The default is "system" (the CSS honours prefers-color-scheme with no JS), so
 * there is no flash for the common case; an explicit choice stamps data-theme on <html> and wins.
 */
class Theme {
  pref = $state<ThemePref>("system");

  hydrate(): void {
    if (!browser) return;
    const saved = localStorage.getItem(KEY);
    if (saved === "light" || saved === "dark" || saved === "system") this.pref = saved;
    this.apply();
  }

  set(pref: ThemePref): void {
    this.pref = pref;
    if (browser) localStorage.setItem(KEY, pref);
    this.apply();
  }

  toggle(): void {
    const resolved = this.resolved();
    this.set(resolved === "dark" ? "light" : "dark");
  }

  resolved(): "light" | "dark" {
    if (this.pref !== "system") return this.pref;
    if (!browser) return "light";
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }

  private apply(): void {
    if (!browser) return;
    const root = document.documentElement;
    if (this.pref === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", this.pref);
  }
}

export const theme = new Theme();
