import { useCallback, useEffect, useState } from "react";

type InstallOutcome = "accepted" | "dismissed";

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{
    outcome: InstallOutcome;
    platform: string;
  }>;
  prompt: () => Promise<void>;
}

const DISMISSED_KEY = "popcornready:pwa-install-prompt-dismissed";
let globalDeferredPrompt: BeforeInstallPromptEvent | null = null;
let globalInstalled = false;
let listenerRegistered = false;
const subscribers = new Set<() => void>();

function storageDismissed(): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  try {
    return window.localStorage.getItem(DISMISSED_KEY) === "true";
  } catch {
    return false;
  }
}

function setStorageDismissed() {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(DISMISSED_KEY, "true");
  } catch {
    // A blocked localStorage write should not prevent the prompt from closing.
  }
}

function isStandaloneDisplay(): boolean {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return false;
  }

  const standaloneNavigator = navigator as Navigator & { standalone?: boolean };

  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    window.matchMedia("(display-mode: fullscreen)").matches ||
    standaloneNavigator.standalone === true
  );
}

function notifySubscribers() {
  subscribers.forEach((callback) => callback());
}

export function initializePwaInstallPrompt() {
  if (
    listenerRegistered ||
    typeof window === "undefined" ||
    typeof navigator === "undefined"
  ) {
    return;
  }

  listenerRegistered = true;
  globalInstalled = isStandaloneDisplay();

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();

    if (!storageDismissed() && !isStandaloneDisplay()) {
      globalDeferredPrompt = event as BeforeInstallPromptEvent;
      notifySubscribers();
    }
  });

  window.addEventListener("appinstalled", () => {
    globalInstalled = true;
    globalDeferredPrompt = null;
    notifySubscribers();
  });
}

export function usePwaInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] =
    useState<BeforeInstallPromptEvent | null>(globalDeferredPrompt);
  const [dismissed, setDismissed] = useState(storageDismissed);
  const [installed, setInstalled] = useState(() => globalInstalled || isStandaloneDisplay());

  useEffect(() => {
    initializePwaInstallPrompt();
    const syncPromptState = () => {
      setDeferredPrompt(globalDeferredPrompt);
      setInstalled(globalInstalled || isStandaloneDisplay());
    };

    syncPromptState();
    subscribers.add(syncPromptState);
    return () => {
      subscribers.delete(syncPromptState);
    };
  }, []);

  const dismiss = useCallback(() => {
    setStorageDismissed();
    setDismissed(true);
    globalDeferredPrompt = null;
    setDeferredPrompt(null);
    notifySubscribers();
  }, []);

  const promptInstall = useCallback(async () => {
    if (!deferredPrompt) {
      return;
    }

    await deferredPrompt.prompt();
    const choice = await deferredPrompt.userChoice;

    globalDeferredPrompt = null;
    setDeferredPrompt(null);
    notifySubscribers();

    if (choice.outcome === "dismissed") {
      dismiss();
    }
  }, [deferredPrompt, dismiss]);

  return {
    dismiss,
    isAvailable: Boolean(deferredPrompt) && !dismissed && !installed,
    promptInstall,
  };
}
