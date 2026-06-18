import { useEffect, useRef, type ReactNode } from "react";

/**
 * Reveal — fades + lifts its children into view the first time they scroll
 * near the viewport, then disconnects. Pure presentation: the content is in the
 * DOM from the start (good for SEO/accessibility); only the entrance is gated.
 * The matching .lp-reveal styles disable the effect under prefers-reduced-motion.
 */
export function Reveal({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      el.classList.add("is-visible");
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          el.classList.add("is-visible");
          observer.disconnect();
        }
      },
      { threshold: 0.12, rootMargin: "0px 0px -8% 0px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={ref} className={`lp-reveal${className ? ` ${className}` : ""}`}>
      {children}
    </div>
  );
}
