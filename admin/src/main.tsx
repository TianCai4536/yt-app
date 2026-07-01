import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { adminApi } from "./lib/api";
import { LoginPage } from "./pages/LoginPage";
import { DashboardPage } from "./pages/DashboardPage";
import { UsersPage } from "./pages/UsersPage";
import { ModelsPage } from "./pages/ModelsPage";
import { AccountPage } from "./pages/AccountPage";
import { SettingsPage } from "./pages/SettingsPage";
import { Layout } from "./pages/Layout";
import { DialogProvider } from "./lib/dialog";
import "./lib/themeStore";
import "./styles.css";

function Guard({ children }: { children: React.ReactNode }) {
  if (!adminApi.isLoggedIn()) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <DialogProvider>
      <BrowserRouter basename="/ai-app_admin">
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route
            path="/"
            element={
              <Guard>
                <Layout />
              </Guard>
            }
          >
            <Route index element={<DashboardPage />} />
            <Route path="users" element={<UsersPage />} />
            <Route path="models" element={<ModelsPage />} />
            <Route path="account" element={<AccountPage />} />
            <Route path="settings" element={<SettingsPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </DialogProvider>
  </React.StrictMode>
);
