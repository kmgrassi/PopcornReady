import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App.js";
import { initializePwaInstallPrompt } from "./lib/pwaInstallPrompt";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/utilities.css";
import "./styles/globals.css";
import "./styles/studio-secondary.css";

initializePwaInstallPrompt();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);

function registerShareTargetServiceWorker() {
  void navigator.serviceWorker.register("/share-target-sw.js");
}

if (import.meta.env.PROD && "serviceWorker" in navigator) {
  if (document.readyState === "complete") {
    registerShareTargetServiceWorker();
  } else {
    window.addEventListener("load", registerShareTargetServiceWorker, { once: true });
  }
}
