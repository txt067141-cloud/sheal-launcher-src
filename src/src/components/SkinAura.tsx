import { useEffect, useRef } from "react";

type Particle = {
  x: number;
  y: number;
  radius: number;
  speed: number;
  drift: number;
  phase: number;
  alpha: number;
};

function hexToRgb(hex: string) {
  const value = hex.replace("#", "");
  const full = value.length === 3 ? value.split("").map((c) => c + c).join("") : value;
  const num = parseInt(full, 16);
  if (Number.isNaN(num)) return { r: 168, g: 85, b: 247 };
  return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
}

/** Partículas + aura animatedas alrededor de una skin (solo en el launcher). */
export function SkinAura({
  color,
  count = 20,
  className = "",
}: {
  color: string;
  count?: number;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const { r, g, b } = hexToRgb(color);
    let width = 0;
    let height = 0;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      width = Math.max(1, rect.width);
      height = Math.max(1, rect.height);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    const particles: Particle[] = Array.from({ length: count }, () => ({
      x: Math.random(),
      y: Math.random(),
      radius: 1 + Math.random() * 2.2,
      speed: 0.0015 + Math.random() * 0.003,
      drift: 0.0008 + Math.random() * 0.002,
      phase: Math.random() * Math.PI * 2,
      alpha: 0.35 + Math.random() * 0.5,
    }));

    let frame = 0;
    let time = 0;

    const draw = () => {
      ctx.clearRect(0, 0, width, height);

      // Aura pulsante detrás del personaje.
      const pulse = 0.5 + Math.sin(time / 900) * 0.12;
      const cx = width / 2;
      const cy = height / 2;
      const auraRadius = Math.min(width, height) * 0.46 * pulse;
      const gradient = ctx.createRadialGradient(cx, cy, auraRadius * 0.15, cx, cy, auraRadius);
      gradient.addColorStop(0, `rgba(${r},${g},${b},0.30)`);
      gradient.addColorStop(0.55, `rgba(${r},${g},${b},0.12)`);
      gradient.addColorStop(1, `rgba(${r},${g},${b},0)`);
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, width, height);

      // Partículas que suben y se balancean.
      for (const particle of particles) {
        if (!reduceMotion) {
          particle.y -= particle.speed;
          particle.phase += particle.drift;
        }
        if (particle.y < -0.05) {
          particle.y = 1.05;
          particle.x = Math.random();
        }
        const px = particle.x * width + Math.sin(particle.phase) * 9;
        const py = particle.y * height;
        const twinkle = reduceMotion ? 1 : 0.65 + Math.sin(particle.phase * 2) * 0.35;
        ctx.beginPath();
        ctx.arc(px, py, particle.radius, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${r},${g},${b},${particle.alpha * twinkle})`;
        ctx.shadowBlur = 10;
        ctx.shadowColor = `rgba(${r},${g},${b},0.9)`;
        ctx.fill();
      }
      ctx.shadowBlur = 0;

      if (!reduceMotion) {
        time += 16;
        frame = requestAnimationFrame(draw);
      }
    };
    draw();

    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [color, count]);

  return <canvas ref={canvasRef} className={`skin-aura-canvas ${className}`} aria-hidden="true" />;
}
