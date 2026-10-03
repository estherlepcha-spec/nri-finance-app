export const STORAGE_KEY = "onboarding_tour_completed_v1";

export function shouldShowOnboarding() {
  if (typeof window === "undefined") return false;
  return !window.localStorage.getItem(STORAGE_KEY);
}

export function resetOnboarding() {
  window.localStorage.removeItem(STORAGE_KEY);
}
