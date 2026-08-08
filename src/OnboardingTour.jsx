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

// Guided walkthrough of the app's key features for a first-time user. Each step
// highlights a real element (see the data-tour anchors in App.jsx). Steps whose
// element is missing are skipped automatically, so the tour is resilient.
const steps = [
  {
    // No element → a centered welcome dialog.
    popover: {
      title: "Welcome! 👋 Let's take a quick tour",
      description:
        "A 60-second walkthrough of the main features. You can skip anytime, and replay it later from Settings → Replay Onboarding Tour.",
    },
  },
  {
    element: '[data-tour="nav-accounts"]',
    popover: {
      title: "1. Add your accounts 🏦",
      description:
        "Start here. Add your bank accounts (NRE/NRO, foreign salary, savings) and credit cards to track balances across currencies.",
      side: "right",
    },
  },
  {
    element: '[data-tour="nav-transactions"]',
    popover: {
      title: "2. Import transactions ↕",
      description:
        "Upload a bank statement (PDF, Excel, CSV, or a photo) and the AI extracts and categorises every transaction for you. Or add them manually.",
      side: "right",
    },
  },
  {
    element: '[data-tour="nav-remittances"]',
    popover: {
      title: "3. Track money sent home ✈️",
      description:
        "Log remittances with the exchange rate you got, and see how efficient your transfers are over time.",
      side: "right",
    },
  },
  {
    element: '[data-tour="nav-bills"]',
    popover: {
      title: "4. Never miss a bill 📋",
      description:
        "Add recurring bills and due dates so upcoming payments always show on your dashboard.",
      side: "right",
    },
  },
  {
    element: '[data-tour="nav-goals"]',
    popover: {
      title: "5. Set savings goals 🎯",
      description:
        "Create goals (emergency fund, home down payment, education) and track progress as you contribute.",
      side: "right",
    },
  },
  {
    element: '[data-tour="nav-budget"]',
    popover: {
      title: "6. Plan your budget 📊",
      description:
        "Set monthly limits per category for both your working and home countries, and see actual vs planned.",
      side: "right",
    },
  },
  {
    element: '[data-tour="nav-tax"]',
    popover: {
      title: "7. Estimate your tax 🧾",
      description:
        "A worldwide tax estimator covering 13 countries — handy for NRIs and expats planning across borders.",
      side: "right",
    },
  },
  {
    element: '[data-tour="nav-advisor"]',
    popover: {
      title: "8. Meet Estelle, your AI advisor 💅",
      description:
        "Ask Estelle anything about your finances — 'Can I afford this?', 'How am I doing this month?' — she uses your real data to answer.",
      side: "right",
    },
  },
  {
    element: '[data-tour="dashboard-summary"]',
    popover: {
      title: "Your net worth, always visible",
      description:
        "Your combined balance across every account and currency lives here. That's the tour — enjoy! 🎉",
      side: "top",
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

// An element is a usable tour target only if it's actually rendered AND visible.
// The sidebar (and its nav items) is display:none on mobile and collapsed on
// tablet, so a step pointing at a hidden nav item would leave Driver.js with
// nowhere to anchor the popover — the tour would appear to "not show". We filter
// those out so only visible steps run; element-less steps (welcome) always keep.
function isVisible(selector) {
  const el = document.querySelector(selector);
  if (!el) return false;
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return false;
  const style = window.getComputedStyle(el);
  return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
}

function buildRunnableSteps() {
  return steps.filter((s) => !s.element || isVisible(s.element));
}

export default function OnboardingTour({ autoStart = true, onComplete }) {
  const driverRef = useRef(null);

  useEffect(() => {
    if (!(autoStart && shouldShowOnboarding())) return;

    // Wait until the layout is painted, then build the step list from what's
    // actually visible right now (handles the responsive sidebar).
    const start = () => {
      const runnable = buildRunnableSteps();
      // If literally nothing is anchorable (shouldn't happen — welcome + net
      // worth are element-light), still show the welcome so the user gets a hello.
      const driverObj = driver({
        showProgress: true,
        allowClose: true,
        overlayColor: "rgba(0,0,0,0.65)",
        // Compact popover styling that matches the app's font scale (see the
        // .nri-tour rules in index.css).
        popoverClass: "nri-tour",
        steps: runnable.length ? runnable : steps.filter((s) => !s.element),
        onDestroyed: () => {
          window.localStorage.setItem(STORAGE_KEY, "true");
          if (onComplete) onComplete();
        },
      });
      driverRef.current = driverObj;
      driverObj.drive();
    };

    // Longer delay so the sidebar/nav and dashboard have mounted & painted.
    const timer = setTimeout(start, 700);
    return () => clearTimeout(timer);
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
