interface LogoMarkProps {
  className?: string;
}

// Popcorn-box mark (V3): a wireframe carton with a popcorn mound on top. The
// geometry is stroke-based and tinted entirely by currentColor via the
// logo-mark-* classes, so it inherits the active theme/accent color and gains
// its soft fill, drop shadow, and highlight from CSS.
export function LogoMark({ className }: LogoMarkProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 120 120"
      aria-hidden="true"
      focusable="false"
    >
      <g className="logo-mark-body">
        <path d="M27 53 L38 102 L82 102 L93 53 L60 48 Z" />
        <path d="M31 54 C22 50 22 39 31 35 C28 24 43 21 48 29 C52 18 67 18 71 28 C78 21 90 27 86 37 C93 42 90 53 83 54 Z" />
      </g>
      <path
        className="logo-mark-highlight"
        d="M31 35 C28 24 43 21 48 29 C52 18 67 18 71 28 C78 21 90 27 86 37"
      />
      <g className="logo-mark-shadow">
        <path d="M27 53 L38 102 L82 102 L93 53" />
        <path d="M27 53 L60 48 L93 53" />
        <path d="M60 48 L60 102" />
        <path d="M31 54 C22 50 22 39 31 35 C28 24 43 21 48 29 C52 18 67 18 71 28 C78 21 90 27 86 37 C93 42 90 53 83 54" />
      </g>
      <g className="logo-mark-fill">
        <path d="M27 53 L38 102 L82 102 L93 53" />
        <path d="M27 53 L60 48 L93 53" />
        <path d="M60 48 L60 102" />
        <path d="M31 54 C22 50 22 39 31 35 C28 24 43 21 48 29 C52 18 67 18 71 28 C78 21 90 27 86 37 C93 42 90 53 83 54" />
      </g>
    </svg>
  );
}
