import { tableAppearanceStyle, type TableAppearance } from './tableAppearance';
import './tableSurface.css';

/** The still artwork contains only light and material. All game data stays in the DOM. */
export function TableSurface({ portrait, appearance }: { portrait: boolean; appearance?: TableAppearance }) {
  return <div aria-hidden="true" className="tracker-table-surface" data-shape={portrait ? 'portrait' : 'landscape'} style={tableAppearanceStyle(appearance)}>
    <div className="tracker-table-cloth" />
  </div>;
}
