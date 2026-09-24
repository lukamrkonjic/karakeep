/**
 * Fork: vrana's logo — a crow ("vrana" is Croatian for crow) on a rounded
 * square in the theme's blue. The crow takes the page's background colour,
 * so in the light theme this is the app icon (public/icons/: beige on klein
 * blue) and in the dark theme a charcoal crow on the softer blue. The crow is
 * drawn on a 64 grid; the icons were generated from these paths.
 */
export const CROW_PATH =
  "M 62 25.2 C 58.6 19 53.6 15.2 46.4 13.6 C 43.4 10.2 37.6 9.6 33.4 12.2 C 27.6 15.8 24.4 22.6 21.4 29.4 C 18.6 35.6 14.4 40.8 10 45.6 L 1.8 52.6 L 5.6 56.8 L 20.2 48.8 C 30.6 48.8 40.6 45.4 44.8 37.2 C 45.8 35 46.2 32.6 46.4 30.6 C 47.6 29.2 47.6 27.6 47 26.2 C 51.8 25.2 56.8 24.9 62 25.2 Z M 42.4 17.2 a 1.6 1.6 0 1 0 0.01 0 Z";
export const CROW_LEGS = "M 28.6 48.6 L 29.4 56 M 34.2 47.4 L 35.2 56";

export function VranaMark(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true" {...props}>
      <rect width="64" height="64" rx="14.4" className="fill-primary" />
      {/* The crow 70% of the tile's width, centred — as in the icons. */}
      <g transform="translate(8.236 6.723) scale(0.7454)">
        <path className="fill-background" fillRule="evenodd" d={CROW_PATH} />
        <path
          fill="none"
          className="stroke-background"
          strokeWidth={2.6}
          strokeLinecap="round"
          d={CROW_LEGS}
        />
      </g>
    </svg>
  );
}
