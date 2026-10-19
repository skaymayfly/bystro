import "./mascot.css";

import { mascotDimensions, mascotLabel, type MascotMood, type MascotSize } from "@/lib/mascot";
import { cn } from "@/lib/utils";

/** Four-pointed spark of the "joy" state. */
const SPARK = "M0 -10C1 -3 3 -1 10 0C3 1 1 3 0 10C-1 3 -3 1 -10 0C-3 -1 -1 -3 0 -10Z";
/** A "z" of the "sleep" state. */
const ZED = "M0 0H9L0 10H9";

/**
 * Bystrouš: the black square of the logo with eyes, arms and legs, the slash as a tuft of
 * hair. One drawing; the state is a class that the stylesheet (taken from the design)
 * animates. Animations stop when the user asks for reduced motion.
 */
export function Mascot({
  mood = "idle",
  size = "md",
  className,
}: {
  mood?: MascotMood;
  size?: MascotSize;
  className?: string;
}) {
  const { width, height } = mascotDimensions(size);
  return (
    <svg
      className={cn("masc flex-none", `m-${mood}`, className)}
      viewBox="0 0 200 220"
      width={width}
      height={height}
      role="img"
      aria-label={mascotLabel(mood)}
      data-mood={mood}
    >
      <ellipse className="sh" cx="100" cy="205" rx="50" ry="6" />
      <g className="all">
        <path className="ln" d="M80 166V195H71" />
        <path className="ln" d="M120 166V195H129" />
        <g className="armL">
          <line className="ln" x1="46" y1="118" x2="24" y2="138" />
        </g>
        <g className="armR">
          <line className="ln" x1="154" y1="118" x2="176" y2="138" />
        </g>
        <g className="bd">
          <line className="ln tuft" x1="100" y1="56" x2="111" y2="31" />
          <rect className="ink" x="40" y="52" width="120" height="118" rx="32" />
          <g className="eyes">
            <g className="eye">
              <ellipse className="wh" cx="78" cy="98" rx="15" ry="18" />
              <g className="pp">
                <circle className="ink" cx="81" cy="100" r="7.5" />
                <circle className="wh" cx="84" cy="96.5" r="2.5" />
              </g>
            </g>
            <g className="eye">
              <ellipse className="wh" cx="122" cy="98" rx="15" ry="18" />
              <g className="pp">
                <circle className="ink" cx="125" cy="100" r="7.5" />
                <circle className="wh" cx="128" cy="96.5" r="2.5" />
              </g>
            </g>
          </g>
          <path className="mo alt arc-up" d="M66 101Q78 85 90 101M110 101Q122 85 134 101" />
          <path className="mo alt arc-dn" d="M66 97Q78 109 90 97M110 97Q122 109 134 97" />
          <path className="mo mo-smile" d="M89 128Q100 138 111 128" />
          <path className="wh alt mo-open" d="M87 125H113Q113 142 100 142Q87 142 87 125Z" />
          <path className="mo alt mo-sad" d="M90 136Q100 127 110 136" />
          <path className="mo alt mo-flat" d="M92 132H108" />
          <ellipse className="mo alt mo-o" cx="100" cy="132" rx="5" ry="6" />
        </g>
      </g>
      <g className="fx" aria-hidden="true">
        <g className="fx-spark">
          <g transform="translate(24 60)">
            <path className="sp gr" d={SPARK} />
          </g>
          <g transform="translate(178 42)">
            <path className="sp sp2 gr" d={SPARK} />
          </g>
          <g transform="translate(174 112) scale(.65)">
            <path className="sp sp3 gr" d={SPARK} />
          </g>
        </g>
        <g className="fx-dots">
          <circle className="dt gy" cx="166" cy="46" r="4" />
          <circle className="dt d2 gy" cx="178" cy="31" r="5.5" />
          <circle className="dt d3 gy" cx="192" cy="14" r="7" />
        </g>
        <g className="fx-badge">
          <g className="bdg">
            <circle className="rd" cx="172" cy="40" r="16" />
            <path className="bx" d="M172 31V42" />
            <circle className="wh" cx="172" cy="48.5" r="2.4" />
          </g>
        </g>
        <g className="fx-zz">
          {["zz", "zz z2", "zz z3"].map((name) => (
            <g key={name} transform="translate(150 40)">
              <path className={`zl ${name}`} d={ZED} />
            </g>
          ))}
        </g>
        <g className="fx-conf">
          {(
            [
              [22, 10, "cf ink"],
              [52, 0, "cf c2 gr"],
              [84, 6, "cf c3 gy"],
              [118, 0, "cf c4 ink"],
              [150, 8, "cf c5 gr"],
              [178, 2, "cf c6 gy"],
            ] as const
          ).map(([x, y, name]) => (
            <g key={name} transform={`translate(${x} ${y})`}>
              <rect className={name} width="8" height="8" rx="2" />
            </g>
          ))}
        </g>
      </g>
    </svg>
  );
}
