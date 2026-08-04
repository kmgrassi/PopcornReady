import { useLayoutEffect, useRef } from "react";
import { Link } from "react-router-dom";
import styles from "./Breadcrumbs.module.css";

export interface BreadcrumbItem {
  label: string;
  to?: string;
}

export function Breadcrumbs({ items }: { items: BreadcrumbItem[] }) {
  const listRef = useRef<HTMLOListElement>(null);
  const contentSignature = JSON.stringify(
    items.map(({ label, to }) => [label, to ?? null]),
  );

  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;

    const mobileQuery = window.matchMedia("(max-width: 760px)");
    const alignCurrentCrumb = () => {
      if (!mobileQuery.matches || list.scrollWidth <= list.clientWidth) return;
      list.scrollLeft = list.scrollWidth - list.clientWidth;
    };

    alignCurrentCrumb();
    mobileQuery.addEventListener("change", alignCurrentCrumb);
    return () => mobileQuery.removeEventListener("change", alignCurrentCrumb);
  }, [contentSignature]);

  if (items.length <= 1) return null;

  return (
    <nav className={styles.breadcrumbs} aria-label="Breadcrumb">
      <ol className={styles.list} ref={listRef}>
        {items.map((item, index) => {
          const isCurrent = index === items.length - 1;
          const key = `${item.label}-${item.to ?? index}`;

          return (
            <li className={styles.item} key={key}>
              {item.to && !isCurrent ? (
                <Link className={styles.link} to={item.to}>
                  {item.label}
                </Link>
              ) : (
                <span className={styles.current} aria-current={isCurrent ? "page" : undefined}>
                  {item.label}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
