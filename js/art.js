// Artwork for Lil Chicken: an original chick character and a small icon set.
// Everything is inline SVG, so it is crisp at any size and themes with CSS variables.

/** The Lil Chicken mascot (a girl, with her bow). mood: 'happy' | 'sleepy' */
export function chick(mood = 'happy', cls = '') {
  const eyes = mood === 'sleepy'
    ? `<path d="M41 57q5 4 10 0M69 57q5 4 10 0" stroke="#3B2614" stroke-width="3.2" fill="none" stroke-linecap="round"/>`
    : `<circle cx="46" cy="56" r="5.2" fill="#3B2614"/><circle cx="74" cy="56" r="5.2" fill="#3B2614"/>
       <circle cx="47.8" cy="54.2" r="1.8" fill="#fff"/><circle cx="75.8" cy="54.2" r="1.8" fill="#fff"/>`;
  return `<svg class="chick ${cls}" viewBox="0 0 120 120" aria-hidden="true">
    <path d="M50 26c-3-9 5-15 11-9 2-9 15-9 15 0 8-3 13 6 7 12" fill="var(--comb)"/>
    <ellipse cx="60" cy="108" rx="30" ry="5" fill="var(--shadow-ink)"/>
    <path d="M47 100v8M43 108h8M73 100v8M69 108h8" stroke="var(--beak)" stroke-width="3.4" stroke-linecap="round"/>
    <path d="M60 22c25 0 42 19 42 44 0 23-17 38-42 38S18 89 18 66c0-25 17-44 42-44z" fill="var(--yolk)"/>
    <path d="M60 104c-19 0-31-9-35-23 9 8 21 12 35 12s26-4 35-12c-4 14-16 23-35 23z" fill="var(--yolk-deep)" opacity=".55"/>
    <path d="M22 70c-6-1-10 4-9 10 5 3 13 2 16-4" fill="var(--yolk-deep)"/>
    <path d="M98 70c6-1 10 4 9 10-5 3-13 2-16-4" fill="var(--yolk-deep)"/>
    <ellipse cx="38" cy="68" rx="7" ry="4.5" fill="var(--cheek)" opacity=".7"/>
    <ellipse cx="82" cy="68" rx="7" ry="4.5" fill="var(--cheek)" opacity=".7"/>
    <g transform="rotate(18 86 36)">
      <path d="M86 36c-5-7-15-9-16-2s9 8 16 2z" fill="var(--bow)"/>
      <path d="M86 36c5-7 15-9 16-2s-9 8-16 2z" fill="var(--bow)"/>
      <path d="M78 33c2 1 4 2 5 3M94 33c-2 1-4 2-5 3" stroke="var(--bow-deep)" stroke-width="1.4" stroke-linecap="round" fill="none"/>
      <circle cx="86" cy="36" r="3.6" fill="var(--bow-deep)"/>
    </g>
    ${eyes}
    <path d="M53 64h14c1 0 1.6 1 1 1.8L61.2 73a1.5 1.5 0 0 1-2.4 0L52 65.8c-.6-.8 0-1.8 1-1.8z" fill="var(--beak)"/>
  </svg>`;
}

const I = (d, extra = '') => `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ${extra}>${d}</svg>`;

export const icons = {
  egg: I('<path d="M12 3c3.6 0 7 5.4 7 10.2C19 17.6 16 21 12 21s-7-3.4-7-7.8C5 8.4 8.4 3 12 3z"/>'),
  calendar: I('<rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/>'),
  settings: I('<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2.2"/><circle cx="10" cy="17" r="2.2"/>'),
  drop: I('<path d="M12 3.5s6 6.4 6 10.6A6 6 0 0 1 6 14.1C6 9.9 12 3.5 12 3.5z"/>'),
  dirty: I('<path d="M12 4.5c1.6.6 2.2 1.8 1.8 3.1 2 .3 3.2 1.6 3 3.4 2 .5 3.2 2 3 3.9-.3 2.4-2.5 3.6-5 3.6H9.2c-2.5 0-4.7-1.2-5-3.6-.2-1.9 1-3.4 3-3.9-.2-1.8 1-3.1 3-3.4-.3-1.3.3-2.5 1.8-3.1z"/>'),
  both: I('<path d="M7.5 3.5s4 4.3 4 7.1a4 4 0 0 1-8 0c0-2.8 4-7.1 4-7.1z"/><path d="M16.5 11c1 .4 1.3 1.1 1.1 1.9 1.3.2 2 1 1.9 2.1 1.3.3 2 1.3 1.8 2.4-.2 1.5-1.5 2.1-3 2.1h-3.6c-1.5 0-2.8-.6-3-2.1-.1-1.1.6-2.1 1.8-2.4-.1-1.1.6-1.9 1.9-2.1-.2-.8.1-1.5 1.1-1.9z"/>'),
  bottle: I('<path d="M9 2.8h6M10 2.8v3L8 8.5V19a2.2 2.2 0 0 0 2.2 2.2h3.6A2.2 2.2 0 0 0 16 19V8.5l-2-2.7v-3M8 12h3M8 15.5h3"/>'),
  clock: I('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>'),
  pill: I('<path d="M10.3 20.2a5 5 0 0 1-7-7l6.4-6.4a5 5 0 0 1 7 7z"/><path d="M6.5 10l7.5 7.5"/>'),
  bell: I('<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15zM10 20.5a2.2 2.2 0 0 0 4 0"/>'),
  pump: I('<path d="M6.5 3h11l-3.5 4.5v1.5h-4V7.5z"/><rect x="8" y="9" width="8" height="12" rx="2.2"/><path d="M8 13.5h3M8 16.5h3"/>'),
  check: I('<path d="M5 12.5l4.5 4.5L19 7.5"/>'),
  plus: I('<path d="M12 5v14M5 12h14"/>'),
  chevron: I('<path d="M9 6l6 6-6 6"/>'),
  back: I('<path d="M15 6l-6 6 6 6"/>'),
  heart: I('<path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.3a4.3 4.3 0 0 1 7.5 2.5C19.5 15.4 12 20 12 20z"/>'),
  book: I('<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5zM4 20.5A2.5 2.5 0 0 0 6.5 23H20"/>', 'style="transform:scale(.92);transform-origin:center"'),
  swap: I('<path d="M7 7h11l-3-3M17 17H6l3 3"/>'),
  stop: I('<rect x="7" y="7" width="10" height="10" rx="2.5" fill="currentColor"/>'),
  lock: I('<rect x="5" y="10.5" width="14" height="10" rx="3"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/>'),
  link: I('<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>'),
};
