import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, HashRouter } from "react-router-dom";
import App from "./App.tsx";
import Auth from "./pages/Auth.tsx";
import { api, type AuthUser } from "./api.ts";
import "@tabler/icons-webfont/dist/tabler-icons.min.css";
import "./styles.css";

// Local dev (base "/") uses BrowserRouter with clean paths — Vite's dev server
// serves index.html for every route. The hosted build lives in a subdirectory
// of a static Cloudflare Pages site (/projects/league-ify/), where there is no
// per-subdirectory SPA fallback, so HashRouter is used instead — deep links and
// refreshes always resolve to the one index.html.
const hosted = import.meta.env.BASE_URL !== "/";
const Router = hosted ? HashRouter : BrowserRouter;

// The auth gate. On load (and after a successful login/signup) it asks the
// server who is signed in; logged out → the login screen, logged in → the app.
function Root() {
  const [state, setState] = useState<"loading" | "in" | "out">("loading");
  const [, setUser] = useState<AuthUser | null>(null);

  function check() {
    api.authMe().then((u) => {
      setUser(u);
      setState(u ? "in" : "out");
    });
  }
  useEffect(check, []);

  if (state === "loading") {
    return (
      <div style={{
        minHeight: "100vh", display: "grid", placeItems: "center",
        background: "var(--bg)", color: "var(--muted)", fontFamily: "var(--font)",
      }}>
        Loading…
      </div>
    );
  }

  return (
    <Router>
      {state === "in" ? <App /> : <Auth onAuthed={check} />}
    </Router>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
);
