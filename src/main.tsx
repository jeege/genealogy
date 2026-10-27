import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "./globals.css";
import { App } from "./app";
import { RuntimeConfigProvider } from "@/components/runtime-config-provider";
import { getPublicRuntimeConfig } from "@/lib/runtime-config";
import { ThemeProvider } from "@/components/theme-provider";
import { CalendarProvider } from "@/lib/calendar/calendar-context";

const container = document.getElementById("root");
if (!container) throw new Error("缺少 #root 挂载点");

createRoot(container).render(
  <StrictMode>
    <BrowserRouter>
      <RuntimeConfigProvider initialConfig={getPublicRuntimeConfig()}>
        <ThemeProvider>
          <CalendarProvider>
            <App />
          </CalendarProvider>
        </ThemeProvider>
      </RuntimeConfigProvider>
    </BrowserRouter>
  </StrictMode>,
);
