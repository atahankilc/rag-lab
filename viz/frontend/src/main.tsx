import "@fontsource-variable/mona-sans/wdth.css";
import "./styles/tokens.css";
import "./styles/extend.css";
import "./styles/base.css";
import "./styles/hud.css";
import "./styles/page.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
