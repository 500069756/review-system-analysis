import { useEffect, useState } from "react";

type Theme = "dark" | "light";

function getStoredTheme(): Theme {
  if (typeof window === "undefined") return "dark";
  try {
    const stored = localStorage.getItem("trust-layer-theme");
    if (stored === "light" || stored === "dark") return stored;
  } catch {}
  return "dark";
}

function setHtmlTheme(theme: Theme) {
  if (typeof document === "undefined") return;
  const html = document.documentElement;
  if (theme === "light") {
    html.classList.add("light");
  } else {
    html.classList.remove("light");
  }
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>("dark");

  useEffect(() => {
    const initial = getStoredTheme();
    setThemeState(initial);
    setHtmlTheme(initial);
  }, []);

  const setTheme = (t: Theme) => {
    setThemeState(t);
    setHtmlTheme(t);
    try {
      localStorage.setItem("trust-layer-theme", t);
    } catch {}
  };

  const toggle = () => setTheme(theme === "dark" ? "light" : "dark");

  return { theme, setTheme, toggle };
}
