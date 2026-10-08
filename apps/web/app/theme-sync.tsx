"use client";

import { useEffect } from "react";

export function ThemeSync() {
  useEffect(() => {
    try {
      const saved = localStorage.getItem("enough-theme");
      document.documentElement.dataset.theme =
        saved === "light" || saved === "dark" ? saved : "system";
    } catch {
      document.documentElement.dataset.theme = "system";
    }
  }, []);

  return null;
}
