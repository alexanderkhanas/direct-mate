/** Site-wide constants: addresses and the navigation. */

export const SITE_URL = 'https://directmate.app';
export const SITE_NAME = 'DirectMate';
export const CONTACT_EMAIL = 'hello@directmate.app';

/** The admin. Sign-in and sign-up links go there. */
export const PLATFORM_URL: string =
  import.meta.env.PUBLIC_PLATFORM_URL ?? (import.meta.env.DEV ? 'http://localhost:5173' : 'https://platform.directmate.app');

export const platform = (path: string): string => `${PLATFORM_URL}${path}`;
export const REGISTER_URL = platform('/register');
export const LOGIN_URL = platform('/login');
/** The admin's how-to for setting the AI agent up from Claude. */
export const CLAUDE_SETUP_URL = platform('/claude');

/** «Інша CMS чи CRM? Підключимо.» until there is a form. */
export const INTEGRATION_REQUEST_URL = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent('Підключення каталогу')}`;

export interface NavItem {
  label: string;
  href: string;
}

export const MAIN_NAV: NavItem[] = [
  { label: 'Як це працює', href: '/how-it-works' },
  { label: 'Можливості', href: '/features/instagram-content' },
  { label: 'Ціни', href: '/pricing' },
  { label: 'Порівняння', href: '/compare/manychat' },
  { label: 'Демо', href: '/#demo' },
];

export const FOOTER_NAV: Array<{ title: string; items: NavItem[] }> = [
  {
    title: 'Продукт',
    items: [
      { label: 'Як це працює', href: '/how-it-works' },
      { label: 'Сторіз, дописи, Reels', href: '/features/instagram-content' },
      { label: 'Ціни', href: '/pricing' },
      { label: 'Демо', href: '/#demo' },
    ],
  },
  {
    title: 'Порівняння',
    items: [
      { label: 'DirectMate чи ManyChat', href: '/compare/manychat' },
      { label: 'Налаштування з Claude', href: CLAUDE_SETUP_URL },
    ],
  },
  {
    title: 'Компанія',
    items: [
      { label: 'Політика конфіденційності', href: '/privacy' },
      { label: 'Умови використання', href: '/terms' },
      { label: 'Видалення даних', href: '/data-deletion' },
      { label: CONTACT_EMAIL, href: `mailto:${CONTACT_EMAIL}` },
    ],
  },
];
