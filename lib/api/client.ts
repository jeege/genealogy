"use client";

import type { AuthUser } from "./types";

const API_BASE = "/api";
const NETWORK_ERROR = "无法连接服务器，请稍后重试";

export async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("accept", "application/json");
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers,
      credentials: "same-origin",
      cache: "no-store",
    });
  } catch {
    throw new Error(NETWORK_ERROR);
  }

  let payload: unknown = null;
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
  }
  if (!response.ok) {
    const message = payload && typeof payload === "object" && "error" in payload
      ? (payload as { error?: unknown }).error
      : null;
    if (response.status === 401 && !path.startsWith("/auth/") && typeof window !== "undefined") {
      window.location.assign("/auth/login/");
    }
    throw new Error(typeof message === "string" && message.trim() ? message : `请求失败（HTTP ${response.status}）`);
  }
  return payload as T;
}

export async function login(email: string, password: string): Promise<AuthUser> {
  const payload = await apiRequest<{ user: AuthUser }>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  return payload.user;
}

export async function signup(email: string, password: string): Promise<AuthUser> {
  const payload = await apiRequest<{ user: AuthUser }>("/auth/signup", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  return payload.user;
}

export async function logout(): Promise<void> {
  await apiRequest<null>("/auth/logout", { method: "POST" });
}

export async function getSession(): Promise<AuthUser | null> {
  try {
    const payload = await apiRequest<{ user: AuthUser }>("/auth/session");
    return payload.user ?? null;
  } catch {
    return null;
  }
}

export async function forgotPassword(email: string): Promise<void> {
  await apiRequest<{ message: string }>("/auth/password/forgot", {
    method: "POST",
    body: JSON.stringify({ email }),
  });
}

export async function resetPassword(token: string, password: string): Promise<void> {
  await apiRequest<null>("/auth/password/reset", {
    method: "POST",
    body: JSON.stringify({ token, password }),
  });
}

export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  await apiRequest<null>("/auth/password/change", {
    method: "POST",
    body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
  });
}
