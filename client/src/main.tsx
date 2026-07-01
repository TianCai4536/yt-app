import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
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

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <DialogProvider>
      <BrowserRouter basename="/yt-app">
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
      </BrowserRouter>
    </DialogProvider>
  </React.StrictMode>
);
