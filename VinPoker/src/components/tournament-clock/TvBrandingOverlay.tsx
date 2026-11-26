import { useRef, type PointerEvent, type KeyboardEvent, type HTMLAttributes } from "react";
import {
  TV_BRANDING_FONT_STACKS,
  isTvBrandingLayoutValid,
  tvBrandingFontSize,
  type TvBrandingLayout,
  type TvBrandingTextBlock,
} from "@/lib/tv/brandingLayout";

type Position = { x: number; y: number };
type EditableProps = HTMLAttributes<HTMLDivElement> & { className: string };

export function TvBrandingOverlay({
  layout,
  logoUrl,
  brandName,
  editing = false,
  onLayoutChange,
}: {
  layout: TvBrandingLayout;
  logoUrl?: string | null;
  brandName?: string | null;
  editing?: boolean;
  onLayoutChange?: (layout: TvBrandingLayout) => void;
}) {
  const dragging = useRef<{ id: string | null; pointerId: number; bounds: DOMRect } | null>(null);
  const move = (id: string | null, position: Position) => {
    if (!onLayoutChange) return;
    const next: TvBrandingLayout = id === null
      ? { ...layout, brandX: position.x, brandY: position.y }
      : {
        ...layout,
        textBlocks: layout.textBlocks.map((block) => block.id === id
          ? { ...block, x: position.x, y: position.y }
          : block),
      };
    if (isTvBrandingLayoutValid(next)) onLayoutChange(next);
  };

  const beginDrag = (event: PointerEvent<HTMLDivElement>, id: string | null) => {
    if (!editing) return;
    const canvas = event.currentTarget.closest<HTMLElement>("[data-tv-branding-canvas]");
    if (!canvas) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragging.current = { id, pointerId: event.pointerId, bounds: canvas.getBoundingClientRect() };
    event.currentTarget.dataset.dragging = "true";
  };

  const continueDrag = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragging.current;
    if (!drag || drag.pointerId !== event.pointerId || drag.bounds.width <= 0 || drag.bounds.height <= 0) return;
    const x = Math.round(((event.clientX - drag.bounds.left) / drag.bounds.width) * 100);
    const y = Math.round(((event.clientY - drag.bounds.top) / drag.bounds.height) * 100);
    move(drag.id, { x, y });
  };

  const endDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (dragging.current?.pointerId !== event.pointerId) return;
    dragging.current = null;
    delete event.currentTarget.dataset.dragging;
  };

  const handlePositionKeys = (event: KeyboardEvent<HTMLElement>, id: string | null, current: Position) => {
    if (!editing) return;
    const step = event.shiftKey ? 5 : 1;
    const delta = event.key === "ArrowLeft" ? { x: -step, y: 0 }
      : event.key === "ArrowRight" ? { x: step, y: 0 }
        : event.key === "ArrowUp" ? { x: 0, y: -step }
          : event.key === "ArrowDown" ? { x: 0, y: step } : null;
    if (!delta) return;
    event.preventDefault();
    move(id, { x: current.x + delta.x, y: current.y + delta.y });
  };

  const editableProps = (id: string | null, position: Position): EditableProps => editing ? {
    role: "group" as const,
    tabIndex: 0,
    "aria-label": id === null ? "Tournament logo. Use arrow keys to position." : "Text block. Use arrow keys to position.",
    onPointerDown: (event: PointerEvent<HTMLDivElement>) => beginDrag(event, id),
    onPointerMove: continueDrag,
    onPointerUp: endDrag,
    onPointerCancel: endDrag,
    onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => handlePositionKeys(event, id, position),
    className: "tv-branding-item tv-branding-item-editable focus-visible:outline focus-visible:outline-2 focus-visible:outline-white focus-visible:outline-offset-1 cursor-move touch-none",
  } : { className: "tv-branding-item" };

  return (
    <>
      <div
        {...editableProps(null, { x: layout.brandX, y: layout.brandY })}
        style={{
          position: "absolute", zIndex: 4, left: `${layout.brandX}%`, top: `${layout.brandY}%`,
          width: "20%", height: "12%", transform: `translate(-50%, -50%) scale(${layout.brandScale / 100})`,
          transformOrigin: "center", display: "flex", alignItems: "center", gap: "2%",
          fontFamily: TV_BRANDING_FONT_STACKS[layout.font], textAlign: "left", pointerEvents: editing ? "auto" : "none",
          cursor: editing ? "move" : undefined,
        }}
      >
        <div className="vpc-chip grid shrink-0 place-items-center overflow-hidden" style={{
          width: "auto", height: `${80 * layout.logoScale / 100}%`, aspectRatio: "1 / 1",
        }} aria-label="Tournament logo">
          {logoUrl ? <img src={logoUrl} alt="" className="h-full w-full rounded-full object-cover" /> : <span aria-hidden="true">♠</span>}
        </div>
        <span className="tv-branding-name" style={{
          minWidth: 0, overflow: "hidden", color: "#ecfff0", fontSize: "var(--tv-brand-label-size, 1vmin)", fontWeight: 900,
          letterSpacing: ".06em", textOverflow: "ellipsis", textShadow: "0 1px 3px #000", whiteSpace: "nowrap",
        }}>{brandName || "VINPOKER"}</span>
      </div>
      {layout.textBlocks.map((block) => (
        <TextBlock key={block.id} block={block} editing={editing} props={editableProps(block.id, block)} />
      ))}
    </>
  );
}

function TextBlock({
  block,
  editing,
  props,
}: {
  block: TvBrandingTextBlock;
  editing: boolean;
  props: EditableProps;
}) {
  const style = block.style;
  return (
    <div
      {...props}
      style={{
        position: "absolute", zIndex: 5, left: `${block.x}%`, top: `${block.y}%`,
        width: `${block.width}%`, height: `${block.height}%`, transform: "translate(-50%, -50%)",
        display: "grid", placeItems: "center", overflow: "hidden", padding: "0 0.5%",
        color: style === "label" ? "#07050a" : style === "outline" ? "#f2ece6" : "#c9a86a",
        background: style === "label" ? "#c9a86a" : "transparent",
        border: style === "outline" ? "1px solid rgba(242,236,230,.9)" : "none",
        borderRadius: style === "label" ? "0.6vmin" : 0,
        fontFamily: TV_BRANDING_FONT_STACKS[block.font],
        // `size` is measured against a 1920px-wide canvas. cqw keeps the editor's
        // preview and the full TV proportional while the box clips long text.
        fontSize: tvBrandingFontSize(block.size),
        fontWeight: style === "plain" ? 500 : 800,
        lineHeight: 1.05, textAlign: "center", textOverflow: "ellipsis", whiteSpace: "nowrap",
        textShadow: style === "outline" ? "0 1px 3px #000" : "0 1px 3px rgba(0,0,0,.85)",
        pointerEvents: editing ? "auto" : "none",
        cursor: editing ? "move" : undefined,
      }}
    >
      {block.text}
    </div>
  );
}
