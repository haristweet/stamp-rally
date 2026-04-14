"use client";

import type { ChainData, VisitRecord } from "./types";

const CHAIN_KEY = "stamp-rally:chain";
const VISITS_KEY = "stamp-rally:visits";

export function loadChain(): ChainData | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(CHAIN_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ChainData;
  } catch {
    return null;
  }
}

export function saveChain(chain: ChainData): void {
  localStorage.setItem(CHAIN_KEY, JSON.stringify(chain));
}

export function clearChain(): void {
  localStorage.removeItem(CHAIN_KEY);
  localStorage.removeItem(VISITS_KEY);
}

export function loadVisits(): VisitRecord[] {
  if (typeof window === "undefined") return [];
  const raw = localStorage.getItem(VISITS_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as VisitRecord[];
  } catch {
    return [];
  }
}

export function saveVisits(visits: VisitRecord[]): void {
  localStorage.setItem(VISITS_KEY, JSON.stringify(visits));
}

export function addVisit(storeId: string): VisitRecord[] {
  const visits = loadVisits();
  if (visits.some((v) => v.storeId === storeId)) return visits;
  const next = [...visits, { storeId, visitedAt: new Date().toISOString() }];
  saveVisits(next);
  return next;
}
