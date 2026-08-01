/**
 * OnboardingTour.jsx
 *
 * Reusable first-time-user product tour using Driver.js.
 *
 * INSTALL:
 *   npm install driver.js
 *
 * HOW IT WORKS:
 *   1. Add a `data-tour="stepId"` attribute to any element in your app
 *      you want to highlight (nav item, button, dashboard card, etc.).
 *   2. Define the step order + copy in the `steps` array below.
 *   3. Drop <OnboardingTour /> once near the root of your logged-in app
 *      (e.g. inside your main Dashboard layout, after the user is authenticated).
 *   4. It auto-starts once per user (tracked via localStorage) and can be
 *      re-triggered manually (e.g. from a "Take the tour again" link in settings).
 *
 * The step list below is a starting point for an NRI/expat finance app —
 * edit the `data-tour` selectors and copy to match your real UI.
 */

import { useEffect, useRef } from "react";
import { driver } from "driver.js";
import "driver.js/dist/driver.css";

const STORAGE_KEY = "onboarding_tour_completed_v1";

const steps = [
  {
    element: '[data-tour="dashboard-summary"]',
    popover: {
      title: "Your net worth, always visible",
      description:
        "Your combined balance across every linked account and currency lives here at the bottom of the sidebar.",
      side: "top",
    },
  },
  {
    element: '[data-tour="currency-toggle"]',
    popover: {
      title: "Live exchange rates",
      description:
        "Expand this panel anytime to see up-to-date rates for the currencies you track.",
      side: "bottom",
    },
  },
  {
    element: '[data-tour="add-account"]',
    popover: {
      title: "Link a new account",
      description:
        "Add an NRE, NRO, foreign bank, credit card, or loan account here to start tracking it.",
      side: "right",
    },
  },
  {
    element: '[data-tour="transfer-tracker"]',
    popover: {
      title: "Track transfers home",
      description:
        "Monitor remittance history, exchange rates used, and pending transfers here.",
      side: "right",
    },
  },
  {
    element: '[data-tour="tax-section"]',
    popover: {
      title: "Stay on top of tax status",
      description:
        "Quick view of your residency status and relevant tax flags for the year.",
      side: "right",
    },
  },
];

export function shouldShowOnboarding() {
  if (typeof window === "undefined") return false;
  return !window.localStorage.getItem(STORAGE_KEY);
}

export function resetOnboarding() {
  window.localStorage.removeItem(STORAGE_KEY);
}

export default function OnboardingTour({ autoStart = true, onComplete }) {
  const driverRef = useRef(null);

  useEffect(() => {
    const driverObj = driver({
      showProgress: true,
      steps,
      onDestroyed: () => {
        window.localStorage.setItem(STORAGE_KEY, "true");
        if (onComplete) onComplete();
      },
    });
    driverRef.current = driverObj;

    if (autoStart && shouldShowOnboarding()) {
      // Slight delay ensures target elements are mounted first
      const timer = setTimeout(() => driverObj.drive(), 300);
      return () => clearTimeout(timer);
    }
  }, [autoStart, onComplete]);

  return null;
}

/**
 * Wired into App.jsx's main authenticated layout:
 *   - data-tour="dashboard-summary" → sidebar Net Worth block
 *   - data-tour="currency-toggle"   → Live Rates ticker toggle
 *   - data-tour="add-account"       → Accounts nav item
 *   - data-tour="transfer-tracker"  → Remittances nav item
 *   - data-tour="tax-section"       → Tax Estimator nav item
 *
 * "Replay onboarding tour" lives in Settings via resetOnboarding().
 */
