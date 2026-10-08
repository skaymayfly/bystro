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
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 16,
          padding: 24,
          background: "#ffffff",
          color: "#111111",
          fontFamily: "system-ui, sans-serif",
          textAlign: "center",
        }}
      >
        <h1 style={{ margin: 0, fontSize: 28 }}>Něco se pokazilo</h1>
        <p style={{ margin: 0, color: "#71717a" }}>
          Chyba je na naší straně. Zkus to prosím znovu.
        </p>
        <button
          type="button"
          onClick={reset}
          style={{
            border: "none",
            borderRadius: 999,
            padding: "0 20px",
            height: 46,
            background: "#111111",
            color: "#fff",
            fontSize: 15,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Zkusit znovu
        </button>
      </body>
    </html>
  );
}
