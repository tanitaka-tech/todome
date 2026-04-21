import type { CSSProperties } from "react";

interface Props {
  text: string;
}

export function WaveText({ text }: Props) {
  return (
    <>
      {Array.from(text).map((ch, i) => (
        <span
          key={i}
          className="wave-char"
          style={{ "--wave-i": i } as CSSProperties}
        >
          {ch === " " ? "\u00A0" : ch}
        </span>
      ))}
    </>
  );
}
