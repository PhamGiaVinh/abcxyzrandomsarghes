import { useState, type CSSProperties, type ReactNode } from "react";

type PortraitProps = {
  name: string;
  photo?: string | null;
  seat: number;
  style?: CSSProperties;
  children?: ReactNode;
};

/** The seat follows its physical number. A player photo always takes priority over initials. */
export function PlayerSeatPortrait({ name, photo, seat, style, children }: PortraitProps) {
  const [failed, setFailed] = useState<string | null>(null);
  const words = name.trim().split(/\s+/);
  const initials = (words[0]?.charAt(0) || "") + (words.length > 1 ? words[words.length - 1].charAt(0) : "");
  return <div className="tracker-seat-avatar">
    <div className="tracker-seat-medallion" style={style} aria-hidden="true">
      {photo && failed !== photo
        ? <img src={photo} alt="" onError={() => setFailed(photo)} />
        : <span>{initials.toLocaleUpperCase() || seat}</span>}
    </div>
    {children}
  </div>;
}

export function PlayerSeatPlate({ seat, name, title, children, onClick }: {
  seat: number; name: string; title: string; children: ReactNode; onClick?: () => void;
}) {
  if (onClick) return <button type="button" className="tracker-seat-plate cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
    title={title} aria-label={name + " · Chip / BB"} onClick={onClick}>
    <div className="tracker-seat-name"><span className="tracker-seat-number">{seat}</span>{name}</div>
    {children}
  </button>;
  return <div className="tracker-seat-plate" title={title}>
    <div className="tracker-seat-name"><span className="tracker-seat-number">{seat}</span>{name}</div>
    {children}
  </div>;
}
