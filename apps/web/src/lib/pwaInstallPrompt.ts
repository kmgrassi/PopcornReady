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

export function usePwaInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [dismissed, setDismissed] = useState(storageDismissed);
  const [installed, setInstalled] = useState(() => isStandaloneDisplay());

  useEffect(() => {
    function handleBeforeInstallPrompt(event: Event) {
      event.preventDefault();

      if (!dismissed && !isStandaloneDisplay()) {
        setDeferredPrompt(event as BeforeInstallPromptEvent);
      }
    }

    function handleInstalled() {
      setInstalled(true);
      setDeferredPrompt(null);
    }

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    window.addEventListener("appinstalled", handleInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      window.removeEventListener("appinstalled", handleInstalled);
    };
  }, [dismissed]);

  const dismiss = useCallback(() => {
    setStorageDismissed();
    setDismissed(true);
    setDeferredPrompt(null);
  }, []);

  const promptInstall = useCallback(async () => {
    if (!deferredPrompt) {
      return;
    }

    await deferredPrompt.prompt();
    const choice = await deferredPrompt.userChoice;

    setDeferredPrompt(null);

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
