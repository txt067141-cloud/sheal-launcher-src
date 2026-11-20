/**
 * Paisaje de montañas dibujado con SVG + degradados.
 * Se usa en el hero del Inicio, en los banners y en el login,
 * para no depender de imágenes externas (funciona sin internet).
 */
export function MountainArt({
  variant = "hero",
  className = "",
  image,
}: {
  variant?: "hero" | "banner" | "login";
  className?: string;
  image?: string;
}) {
  return (
    <div className={`mountain-art mountain-${variant} ${image ? "has-image" : ""} ${className}`} aria-hidden="true">
      {image ? (
        <>
          <div className="mountain-photo" style={{ backgroundImage: `url("${image}")` }} />
          <div className="mountain-photo-shade" />
        </>
      ) : (
        <>
      <div className="mountain-sky" />
      <div className="mountain-sun" />
      <div className="mountain-haze" />
      <svg
        className="mountain-svg"
        viewBox="0 0 1200 400"
        preserveAspectRatio="xMidYMax slice"
      >
        <path
          className="mtn-back"
          d="M0 270 120 165 205 220 320 105 430 225 545 145 665 245 785 120 900 235 1015 155 1120 245 1200 185 1200 400 0 400Z"
        />
        <path
          className="mtn-mid"
          d="M0 320 110 250 215 305 345 195 465 295 585 225 705 315 835 215 955 305 1080 240 1200 315 1200 400 0 400Z"
        />
        <path
          className="mtn-front"
          d="M0 372 150 322 285 362 425 308 565 366 705 320 855 372 1005 328 1200 375 1200 400 0 400Z"
        />
        <g className="mtn-trees">
          {Array.from({ length: 46 }).map((_, i) => {
            const x = 12 + i * 26 + ((i * 13) % 17);
            const h = 16 + ((i * 7) % 22);
            const base = 392 - ((i * 5) % 10);
            return (
              <path
                key={i}
                d={`M${x} ${base - h} ${x - h * 0.32} ${base} ${x + h * 0.32} ${base}Z`}
              />
            );
          })}
        </g>
      </svg>
      <div className="mountain-shade" />
      <div className="mountain-grain" />
        </>
      )}
    </div>
  );
}
