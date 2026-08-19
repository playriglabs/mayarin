import { render } from "preact";
import { App } from "./app.tsx";
import { BrandKit } from "./pages/brand-kit.tsx";
import { NotFound } from "./pages/not-found.tsx";
import { PitchDeck } from "./pages/pitch-deck/index.tsx";

const root = document.getElementById("app");

const pathname = window.location.pathname.replace(/\/+$/, "") || "/";
const page =
  pathname === "/" ? (
    <App />
  ) : pathname === "/brand-kit" ? (
    <BrandKit />
  ) : pathname === "/pitch-deck" ? (
    <PitchDeck />
  ) : (
    <NotFound />
  );

if (root) render(page, root);
