export function BrandMark({ size = 22 }: { size?: number }) {
  return (
    <svg className="brand-mark" width={size} height={size} viewBox="16 16 224 224" aria-hidden="true">
      <g fill="none" stroke="currentColor" strokeWidth="16" strokeLinecap="round" strokeLinejoin="round">
        <path d="M32 76V42a10 10 0 0 1 10-10H76" />
        <path d="M180 32H214a10 10 0 0 1 10 10V76" />
        <path d="M224 180V214a10 10 0 0 1-10 10H180" />
        <path d="M76 224H42a10 10 0 0 1-10-10V180" />
      </g>
      <circle cx="128" cy="128" r="40" fill="none" stroke="#E8A33D" strokeWidth="14" />
      <circle cx="128" cy="128" r="18" fill="#0F1512" />
      <circle cx="121" cy="121" r="5" fill="currentColor" />
    </svg>
  );
}
