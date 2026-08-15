// The Lucide icons the site uses, imported as raw SVG at build time.
//
// Explicit imports rather than a glob: the list is greppable, and nothing unused ships.

import cornerDownLeft from 'lucide-static/icons/corner-down-left.svg?raw';
import deleteIcon from 'lucide-static/icons/delete.svg?raw';
import arrowBigUp from 'lucide-static/icons/arrow-big-up.svg?raw';
import space from 'lucide-static/icons/space.svg?raw';
import layers from 'lucide-static/icons/layers.svg?raw';
import pointer from 'lucide-static/icons/pointer.svg?raw';
import hand from 'lucide-static/icons/hand.svg?raw';
import maximize from 'lucide-static/icons/maximize.svg?raw';
import x from 'lucide-static/icons/x.svg?raw';
import undo2 from 'lucide-static/icons/undo-2.svg?raw';
import sparkles from 'lucide-static/icons/sparkles.svg?raw';
import mousePointerClick from 'lucide-static/icons/mouse-pointer-click.svg?raw';
import inbox from 'lucide-static/icons/inbox.svg?raw';
import search from 'lucide-static/icons/search.svg?raw';
import archive from 'lucide-static/icons/archive.svg?raw';
import shieldAlert from 'lucide-static/icons/shield-alert.svg?raw';
import trash2 from 'lucide-static/icons/trash-2.svg?raw';
import reply from 'lucide-static/icons/reply.svg?raw';
import send from 'lucide-static/icons/send.svg?raw';
import mouse from 'lucide-static/icons/mouse.svg?raw';

export const icons: Record<string, string> = {
  'corner-down-left': cornerDownLeft,
  delete: deleteIcon,
  'arrow-big-up': arrowBigUp,
  space,
  layers,
  pointer,
  hand,
  maximize,
  x,
  'undo-2': undo2,
  sparkles,
  'mouse-pointer-click': mousePointerClick,
  inbox,
  search,
  archive,
  'shield-alert': shieldAlert,
  'trash-2': trash2,
  reply,
  send,
  mouse,
};

/** The raw Lucide SVG, resized and stripped of the attributes the page should control. */
export function icon(name: string, size = 16): string {
  const raw = icons[name];
  if (!raw) return '';
  return raw
    .replace(/width="[^"]*"/, `width="${size}"`)
    .replace(/height="[^"]*"/, `height="${size}"`)
    .replace(/<svg /, '<svg aria-hidden="true" focusable="false" ');
}
