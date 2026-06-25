interface LogoMarkProps {
  className?: string;
}

const popcornFillStyle = { fill: "currentColor", stroke: "none" };

// Crop-frame mark: capture/studio brackets around a compact popped kernel.
// Geometry is tinted by currentColor via the logo-mark-* classes.
export function LogoMark({ className }: LogoMarkProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 120 120"
      aria-hidden="true"
      focusable="false"
    >
      <g className="logo-mark-body">
        <circle className="logo-mark-popcorn" cx="60" cy="54" r="7.35" />
        <circle className="logo-mark-popcorn" cx="52.65" cy="62.4" r="7.35" />
        <circle className="logo-mark-popcorn" cx="67.35" cy="62.4" r="7.35" />
        <circle className="logo-mark-popcorn" cx="60" cy="67.35" r="6.3" />
      </g>
      <path
        className="logo-mark-highlight logo-mark-popcorn"
        d="M52.5 57.5 C55 50.5 65 50.5 67.5 57.5"
      />
      <g className="logo-mark-shadow">
        <path d="M34 50 L34 34 L50 34" />
        <path d="M86 50 L86 34 L70 34" />
        <path d="M34 70 L34 86 L50 86" />
        <path d="M86 70 L86 86 L70 86" />
        <circle className="logo-mark-popcorn" cx="60" cy="54" r="7.35" style={popcornFillStyle} />
        <circle className="logo-mark-popcorn" cx="52.65" cy="62.4" r="7.35" style={popcornFillStyle} />
        <circle className="logo-mark-popcorn" cx="67.35" cy="62.4" r="7.35" style={popcornFillStyle} />
        <circle className="logo-mark-popcorn" cx="60" cy="67.35" r="6.3" style={popcornFillStyle} />
      </g>
      <g className="logo-mark-fill">
        <path d="M34 50 L34 34 L50 34" />
        <path d="M86 50 L86 34 L70 34" />
        <path d="M34 70 L34 86 L50 86" />
        <path d="M86 70 L86 86 L70 86" />
        <circle className="logo-mark-popcorn" cx="60" cy="54" r="7.35" style={popcornFillStyle} />
        <circle className="logo-mark-popcorn" cx="52.65" cy="62.4" r="7.35" style={popcornFillStyle} />
        <circle className="logo-mark-popcorn" cx="67.35" cy="62.4" r="7.35" style={popcornFillStyle} />
        <circle className="logo-mark-popcorn" cx="60" cy="67.35" r="6.3" style={popcornFillStyle} />
      </g>
    </svg>
  );
}
