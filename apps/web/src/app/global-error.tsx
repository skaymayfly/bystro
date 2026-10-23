"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

/**
 * Last-resort error screen: replaces the whole page when rendering fails, so it cannot
 * rely on the root layout, the fonts or the design tokens being available.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="cs">
      {/* Its own minimal palette (libraries.dev colours), light and dark by the system. */}
      <style>{`
        .ge{margin:0;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;padding:24px;background:#fdfdfd;color:#0d0d0d;font-family:system-ui,sans-serif;text-align:center}
        .ge p{margin:0;color:#6c6c6c}
        .ge h1{margin:0;font-size:28px;font-weight:500}
        .ge button{border:0;border-radius:24px;padding:0 20px;height:46px;background:#0071fc;color:#fff;font-size:15px;font-weight:600;cursor:pointer}
        @media (prefers-color-scheme: dark){.ge{background:#121212;color:#fff}.ge p{color:rgba(202,202,202,.7)}}
      `}</style>
      <body className="ge">
        <h1>Něco se pokazilo</h1>
        <p>Chyba je na naší straně. Zkus to prosím znovu.</p>
        <button type="button" onClick={reset}>
          Zkusit znovu
        </button>
      </body>
    </html>
  );
}
