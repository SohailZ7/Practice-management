import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "@fontsource-variable/dm-sans";
import "@fontsource/instrument-serif/400.css";
import "./styles.css";
import { applyTheme, loadTheme } from "./lib/theme";

applyTheme(loadTheme());

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
