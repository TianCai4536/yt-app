import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, HashRouter, Routes, Route, Navigate } from "react-router-dom";
import { LoginPage } from "./pages/LoginPage";
import { WorkbenchPage } from "./pages/WorkbenchPage";
import { api } from "./lib/api";
import { DialogProvider } from "./lib/dialog";
import "highlight.js/styles/github-dark.css";
import "./styles.css";

function RequireAuth({ children }: { children: React.ReactNode }) {
  if (!api.isLoggedIn()) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

// 桌面版(Tauri)加载自 tauri://localhost/ 根路径 → 用 HashRouter、无 basename；
// Web 版部署在 /yt-app/ 子路径 → 用 BrowserRouter + basename
const IS_TAURI =
  typeof (window as any).__TAURI_INTERNALS__ !== "undefined" ||
  typeof (window as any).__TAURI__ !== "undefined";

const RouterInner = (
  <Routes>
    <Route path="/login" element={<LoginPage />} />
    <Route
      path="/"
      element={
        <RequireAuth>
          <WorkbenchPage />
        </RequireAuth>
      }
    />
    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes>
);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <DialogProvider>
      {IS_TAURI ? (
        <HashRouter>{RouterInner}</HashRouter>
      ) : (
        <BrowserRouter basename="/yt-app">{RouterInner}</BrowserRouter>
      )}
    </DialogProvider>
  </React.StrictMode>
);
