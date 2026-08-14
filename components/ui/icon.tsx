// A single tiny icon renderer shared by the sidebar, dashboard, and any
// other page that needs a glyph — no icon package added just for a
// handful of shapes; each caller supplies an SVG path (see
// components/icons.ts for the shared dictionary) and this only handles
// the common <svg> wrapper.
export function Icon({ path, className }: { path: string; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d={path} />
    </svg>
  );
}
