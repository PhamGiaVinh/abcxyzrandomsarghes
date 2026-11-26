import { useId } from 'react';
import { DEFAULT_TABLE_APPEARANCE, tableAppearanceStyle, type TableAppearance } from './tableAppearance';
import './tableSurface.css';

/** The still artwork contains only light and material. All game data stays in the DOM. */
export function usesCatKhoi(appearance = DEFAULT_TABLE_APPEARANCE) {
  return appearance.feltColor.toLowerCase() === DEFAULT_TABLE_APPEARANCE.feltColor
    && appearance.railColor.toLowerCase() === DEFAULT_TABLE_APPEARANCE.railColor;
}

/** The still artwork contains only light and material. All game data stays in the DOM. */
export function TableSurface({ portrait, appearance }: { portrait: boolean; appearance?: TableAppearance }) {
  const id = useId().replace(/:/g, '');
  const defaultGreen = (appearance?.feltColor ?? DEFAULT_TABLE_APPEARANCE.feltColor).toLowerCase() === DEFAULT_TABLE_APPEARANCE.feltColor;
  const smoke = usesCatKhoi(appearance);
  return <div aria-hidden="true" className="tracker-table-surface" data-shape={portrait ? 'portrait' : 'landscape'}
    data-cat-khoi={smoke || undefined} data-default-green={defaultGreen || undefined} style={tableAppearanceStyle(appearance)}>
    {smoke ? null : portrait ? <div className="tracker-table-cloth" /> : <svg className="table-rail-art" viewBox="0 0 1200 560" preserveAspectRatio="none" focusable="false">
      <defs>
        <linearGradient id={id + 'wood'} x1="0" y1="0" x2=".28" y2="1" gradientUnits="objectBoundingBox">
          <stop stopColor="#e1c4a6" /><stop offset=".12" stopColor="#9c785e" /><stop offset=".46" stopColor="#503e36" />
          <stop offset=".74" stopColor="#8f6b52" /><stop offset=".93" stopColor="#c5a17c" /><stop offset="1" stopColor="#73513c" />
        </linearGradient>
        <radialGradient id={id + 'light'} cx=".39" cy=".33" r=".82">
          <stop stopColor="#b2e4a4" stopOpacity=".19" /><stop offset=".67" stopColor="#3a844e" stopOpacity=".04" /><stop offset="1" stopColor="#031810" stopOpacity=".52" />
        </radialGradient>
        <pattern id={id + 'grain'} width="96" height="11" patternUnits="userSpaceOnUse" patternTransform="rotate(-3)">
          <path d="M-1 2q25-2 48 0t50 0m-73 3q14-2 35 0m-62 4q24 1 40-1t62 0" fill="none" stroke="#40251b" strokeWidth=".8" strokeOpacity=".22" />
        </pattern>
        <pattern id={id + 'weave'} width="6" height="5" patternUnits="userSpaceOnUse">
          <path d="M0 1l2 1m1 2 1 .5" stroke="#c9e2ba" strokeOpacity=".11" strokeWidth=".65" />
          <path d="M2 0l1 1m1 2 2 1" stroke="#061b10" strokeOpacity=".17" strokeWidth=".7" />
        </pattern>
        <path id={id + 'rim'} d="M600 5C929 5 1188 81 1188 272S962 544 600 544 12 467 12 272 271 5 600 5Z" />
        <path id={id + 'felt'} d="M600 24C923 24 1163 99 1163 270S939 518 600 518 37 443 37 270 277 24 600 24Z" />
      </defs>
      <use href={'#' + id + 'rim'} transform="translate(0 9)" fill="#30241e" stroke="#1b1715" strokeWidth="3" />
      <use href={'#' + id + 'rim'} fill={'url(#' + id + 'wood)'} stroke="#ad9584" strokeWidth="1.6" />
      <use href={'#' + id + 'rim'} fill="var(--table-rail)" opacity=".15" />
      <use href={'#' + id + 'rim'} fill={'url(#' + id + 'grain)'} />
      <use href={'#' + id + 'felt'} stroke="#594634" strokeWidth="7" fill="var(--table-felt)" />
      <use href={'#' + id + 'felt'} fill={'url(#' + id + 'light)'} />
      <use href={'#' + id + 'felt'} fill={'url(#' + id + 'weave)'} />
      <use href={'#' + id + 'felt'} transform="translate(600 270) scale(.949 .926) translate(-600 -270)" fill="none" stroke="#d9d6a0" strokeOpacity=".20" strokeWidth="1.3" />
      {[ [185,86,-24], [394,26,-9], [600,15,0], [806,26,9], [1015,86,24], [1149,177,55], [1166,353,-55], [1023,462,-25], [808,520,-8], [600,532,0], [392,520,8], [177,462,25], [34,353,55], [51,177,-55] ].map(([x,y,r]) =>
        <path key={x + '-' + y} d="M-3 0 0-4 3 0 0 4Z" transform={`translate(${x} ${y}) rotate(${r})`} fill="#f4e5ce" opacity=".68" />)}
    </svg>}
  </div>;
}
