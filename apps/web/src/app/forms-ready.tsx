"use client";

import { useEffect } from "react";

/** Lets forms post, once the page has loaded. The root layout holds them until then. */
export function FormsReady() {
  useEffect(() => {
    Object.assign(window, { __formsReady: true });
  }, []);
  return null;
}
