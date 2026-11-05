"use client";

import { useEffect } from "react";

export default function DashboardError({ error, retry }: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="main-content">
      <div className="panel empty-state">
        <h2>Something went wrong</h2>
        <p>That could not finish. Try again, or reload the page if it keeps happening.</p>
        <button className="secondary-button" onClick={() => retry()} type="button">Try again</button>
      </div>
    </main>
  );
}
