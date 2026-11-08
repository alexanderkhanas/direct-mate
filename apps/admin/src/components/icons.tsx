import type { ComponentType, SVGProps } from 'react';

import ms_account_circle from '@material-symbols/svg-300/rounded/account_circle.svg?react';
import ms_add from '@material-symbols/svg-300/rounded/add.svg?react';
import ms_add_photo_alternate from '@material-symbols/svg-300/rounded/add_photo_alternate.svg?react';
import ms_add_photo_alternate_fill from '@material-symbols/svg-300/rounded/add_photo_alternate-fill.svg?react';
import ms_apparel from '@material-symbols/svg-300/rounded/apparel.svg?react';
import ms_arrow_back from '@material-symbols/svg-300/rounded/arrow_back.svg?react';
import ms_arrow_forward from '@material-symbols/svg-300/rounded/arrow_forward.svg?react';
import ms_arrow_upward from '@material-symbols/svg-300/rounded/arrow_upward.svg?react';
import ms_bar_chart from '@material-symbols/svg-300/rounded/bar_chart.svg?react';
import ms_bolt from '@material-symbols/svg-300/rounded/bolt.svg?react';
import ms_bookmark from '@material-symbols/svg-300/rounded/bookmark.svg?react';
import ms_call from '@material-symbols/svg-300/rounded/call.svg?react';
import ms_cancel from '@material-symbols/svg-300/rounded/cancel.svg?react';
import ms_chat from '@material-symbols/svg-300/rounded/chat.svg?react';
import ms_chat_fill from '@material-symbols/svg-300/rounded/chat-fill.svg?react';
import ms_chat_bubble from '@material-symbols/svg-300/rounded/chat_bubble.svg?react';
import ms_check from '@material-symbols/svg-300/rounded/check.svg?react';
import ms_check_circle from '@material-symbols/svg-300/rounded/check_circle.svg?react';
import ms_chevron_left from '@material-symbols/svg-300/rounded/chevron_left.svg?react';
import ms_chevron_right from '@material-symbols/svg-300/rounded/chevron_right.svg?react';
import ms_close from '@material-symbols/svg-300/rounded/close.svg?react';
import ms_content_copy from '@material-symbols/svg-300/rounded/content_copy.svg?react';
import ms_crown from '@material-symbols/svg-300/rounded/crown.svg?react';
import ms_dashboard from '@material-symbols/svg-300/rounded/dashboard.svg?react';
import ms_dashboard_fill from '@material-symbols/svg-300/rounded/dashboard-fill.svg?react';
import ms_delete from '@material-symbols/svg-300/rounded/delete.svg?react';
import ms_domain from '@material-symbols/svg-300/rounded/domain.svg?react';
import ms_download from '@material-symbols/svg-300/rounded/download.svg?react';
import ms_error from '@material-symbols/svg-300/rounded/error.svg?react';
import ms_gpp_maybe from '@material-symbols/svg-300/rounded/gpp_maybe.svg?react';
import ms_grid_view from '@material-symbols/svg-300/rounded/grid_view.svg?react';
import ms_image from '@material-symbols/svg-300/rounded/image.svg?react';
import ms_inbox from '@material-symbols/svg-300/rounded/inbox.svg?react';
import ms_info from '@material-symbols/svg-300/rounded/info.svg?react';
import ms_keyboard_arrow_down from '@material-symbols/svg-300/rounded/keyboard_arrow_down.svg?react';
import ms_keyboard_arrow_up from '@material-symbols/svg-300/rounded/keyboard_arrow_up.svg?react';
import ms_language from '@material-symbols/svg-300/rounded/language.svg?react';
import ms_layers from '@material-symbols/svg-300/rounded/layers.svg?react';
import ms_lightbulb from '@material-symbols/svg-300/rounded/lightbulb.svg?react';
import ms_link from '@material-symbols/svg-300/rounded/link.svg?react';
import ms_link_off from '@material-symbols/svg-300/rounded/link_off.svg?react';
import ms_location_on from '@material-symbols/svg-300/rounded/location_on.svg?react';
import ms_logout from '@material-symbols/svg-300/rounded/logout.svg?react';
import ms_menu from '@material-symbols/svg-300/rounded/menu.svg?react';
import ms_monitoring from '@material-symbols/svg-300/rounded/monitoring.svg?react';
import ms_movie from '@material-symbols/svg-300/rounded/movie.svg?react';
import ms_notifications from '@material-symbols/svg-300/rounded/notifications.svg?react';
import ms_notifications_active from '@material-symbols/svg-300/rounded/notifications_active.svg?react';
import ms_open_in_new from '@material-symbols/svg-300/rounded/open_in_new.svg?react';
import ms_package_2 from '@material-symbols/svg-300/rounded/package_2.svg?react';
import ms_package_2_fill from '@material-symbols/svg-300/rounded/package_2-fill.svg?react';
import ms_person from '@material-symbols/svg-300/rounded/person.svg?react';
import ms_photo_camera from '@material-symbols/svg-300/rounded/photo_camera.svg?react';
import ms_play_arrow from '@material-symbols/svg-300/rounded/play_arrow.svg?react';
import ms_play_arrow_fill from '@material-symbols/svg-300/rounded/play_arrow-fill.svg?react';
import ms_play_circle from '@material-symbols/svg-300/rounded/play_circle.svg?react';
import ms_power from '@material-symbols/svg-300/rounded/power.svg?react';
import ms_power_fill from '@material-symbols/svg-300/rounded/power-fill.svg?react';
import ms_power_settings_new from '@material-symbols/svg-300/rounded/power_settings_new.svg?react';
import ms_progress_activity from '@material-symbols/svg-300/rounded/progress_activity.svg?react';
import ms_psychology from '@material-symbols/svg-300/rounded/psychology.svg?react';
import ms_receipt_long from '@material-symbols/svg-300/rounded/receipt_long.svg?react';
import ms_receipt_long_fill from '@material-symbols/svg-300/rounded/receipt_long-fill.svg?react';
import ms_remove from '@material-symbols/svg-300/rounded/remove.svg?react';
import ms_restart_alt from '@material-symbols/svg-300/rounded/restart_alt.svg?react';
import ms_save from '@material-symbols/svg-300/rounded/save.svg?react';
import ms_schedule from '@material-symbols/svg-300/rounded/schedule.svg?react';
import ms_school from '@material-symbols/svg-300/rounded/school.svg?react';
import ms_school_fill from '@material-symbols/svg-300/rounded/school-fill.svg?react';
import ms_search from '@material-symbols/svg-300/rounded/search.svg?react';
import ms_send from '@material-symbols/svg-300/rounded/send.svg?react';
import ms_settings from '@material-symbols/svg-300/rounded/settings.svg?react';
import ms_settings_fill from '@material-symbols/svg-300/rounded/settings-fill.svg?react';
import ms_shield from '@material-symbols/svg-300/rounded/shield.svg?react';
import ms_shopping_bag from '@material-symbols/svg-300/rounded/shopping_bag.svg?react';
import ms_shopping_cart from '@material-symbols/svg-300/rounded/shopping_cart.svg?react';
import ms_shopping_cart_fill from '@material-symbols/svg-300/rounded/shopping_cart-fill.svg?react';
import ms_smart_toy from '@material-symbols/svg-300/rounded/smart_toy.svg?react';
import ms_star from '@material-symbols/svg-300/rounded/star.svg?react';
import ms_star_shine from '@material-symbols/svg-300/rounded/star_shine.svg?react';
import ms_storefront from '@material-symbols/svg-300/rounded/storefront.svg?react';
import ms_straighten from '@material-symbols/svg-300/rounded/straighten.svg?react';
import ms_straighten_fill from '@material-symbols/svg-300/rounded/straighten-fill.svg?react';
import ms_support from '@material-symbols/svg-300/rounded/support.svg?react';
import ms_sync from '@material-symbols/svg-300/rounded/sync.svg?react';
import ms_table from '@material-symbols/svg-300/rounded/table.svg?react';
import ms_table_view from '@material-symbols/svg-300/rounded/table_view.svg?react';
import ms_task from '@material-symbols/svg-300/rounded/task.svg?react';
import ms_trending_up from '@material-symbols/svg-300/rounded/trending_up.svg?react';
import ms_tune from '@material-symbols/svg-300/rounded/tune.svg?react';
import ms_upload from '@material-symbols/svg-300/rounded/upload.svg?react';
import ms_verified_user from '@material-symbols/svg-300/rounded/verified_user.svg?react';
import ms_visibility from '@material-symbols/svg-300/rounded/visibility.svg?react';
import ms_visibility_off from '@material-symbols/svg-300/rounded/visibility_off.svg?react';
import ms_wand_stars from '@material-symbols/svg-300/rounded/wand_stars.svg?react';
import ms_warning from '@material-symbols/svg-300/rounded/warning.svg?react';

/*
 * Every icon in the admin comes from here: Google's Material Symbols, Rounded,
 * weight 300 (@material-symbols/svg-300), plus brand logos Material doesn't have.
 * The export names are our own (several kept from the lucide set this replaced,
 * so call sites didn't change); name new ones plainly. To try another weight,
 * replace `svg-300` in this file and swap the package.
 */

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'ref'> {
  /** Width and height in px when no size class is given. */
  size?: number;
  /** Material's filled variant, for an active state (the sidebar's current page). Only some icons have one. */
  filled?: boolean;
}

export type IconComponent = ComponentType<IconProps>;

type Glyph = ComponentType<SVGProps<SVGSVGElement>>;

/** Decorative unless given an aria-label; coloured by the text colour. */
function material(outline: Glyph, filledGlyph?: Glyph): IconComponent {
  return function MaterialIcon({ size = 24, filled, ...props }: IconProps) {
    const Svg = filled && filledGlyph ? filledGlyph : outline;
    return <Svg width={size} height={size} fill="currentColor" focusable="false" aria-hidden={props['aria-label'] ? undefined : true} {...props} />;
  };
}

/** A single-colour brand logo (Simple Icons, CC0), padded to sit level with the Material glyphs. */
function brand(path: string): IconComponent {
  return function BrandIcon({ size = 24, filled: _filled, ...props }: IconProps) {
    return (
      <svg
        viewBox="-2 -2 28 28"
        width={size}
        height={size}
        fill="currentColor"
        focusable="false"
        aria-hidden={props['aria-label'] ? undefined : true}
        {...props}
      >
        <path d={path} />
      </svg>
    );
  };
}

export const Activity = material(ms_monitoring);
export const AlertCircle = material(ms_error);
export const AlertTriangle = material(ms_warning);
export const ArrowLeft = material(ms_arrow_back);
export const ArrowRight = material(ms_arrow_forward);
export const ArrowUp = material(ms_arrow_upward);
export const BarChart3 = material(ms_bar_chart);
export const Bell = material(ms_notifications);
export const BellRing = material(ms_notifications_active);
export const Bookmark = material(ms_bookmark);
export const Bot = material(ms_smart_toy);
export const Brain = material(ms_psychology);
export const Building2 = material(ms_domain);
export const Camera = material(ms_photo_camera);
export const Check = material(ms_check);
export const CheckCircle = material(ms_check_circle);
export const CheckCircle2 = material(ms_check_circle);
export const ChevronDown = material(ms_keyboard_arrow_down);
export const ChevronLeft = material(ms_chevron_left);
export const ChevronRight = material(ms_chevron_right);
export const ChevronUp = material(ms_keyboard_arrow_up);
export const Clock = material(ms_schedule);
export const Copy = material(ms_content_copy);
export const Crown = material(ms_crown);
export const Download = material(ms_download);
export const ExternalLink = material(ms_open_in_new);
export const Eye = material(ms_visibility);
export const EyeOff = material(ms_visibility_off);
export const FileCheck = material(ms_task);
export const FileSpreadsheet = material(ms_table_view);
export const Film = material(ms_movie);
export const Globe = material(ms_language);
export const GraduationCap = material(ms_school, ms_school_fill);
export const Image = material(ms_image);
export const ImageIcon = material(ms_image);
export const ImagePlus = material(ms_add_photo_alternate, ms_add_photo_alternate_fill);
export const InboxIcon = material(ms_inbox);
export const Info = material(ms_info);
export const Layers = material(ms_layers);
export const LayoutDashboard = material(ms_dashboard, ms_dashboard_fill);
export const LayoutGrid = material(ms_grid_view);
export const LifeBuoy = material(ms_support);
export const Lightbulb = material(ms_lightbulb);
export const Link2 = material(ms_link);
export const Loader2 = material(ms_progress_activity);
export const LogOut = material(ms_logout);
export const MapPin = material(ms_location_on);
export const Menu = material(ms_menu);
export const MessageCircle = material(ms_chat_bubble);
export const MessageSquare = material(ms_chat, ms_chat_fill);
export const Minus = material(ms_remove);
export const Package = material(ms_package_2, ms_package_2_fill);
export const Phone = material(ms_call);
export const Play = material(ms_play_arrow, ms_play_arrow_fill);
export const PlayCircle = material(ms_play_circle);
export const Plug = material(ms_power, ms_power_fill);
export const Plus = material(ms_add);
export const Power = material(ms_power_settings_new);
export const RefreshCw = material(ms_sync);
export const RotateCcw = material(ms_restart_alt);
export const Ruler = material(ms_straighten, ms_straighten_fill);
export const Save = material(ms_save);
export const ScrollText = material(ms_receipt_long, ms_receipt_long_fill);
export const Search = material(ms_search);
export const Send = material(ms_send);
export const Settings = material(ms_settings, ms_settings_fill);
export const Shield = material(ms_shield);
export const ShieldAlert = material(ms_gpp_maybe);
export const ShieldCheck = material(ms_verified_user);
export const Shirt = material(ms_apparel);
export const ShoppingBag = material(ms_shopping_bag);
export const ShoppingCart = material(ms_shopping_cart, ms_shopping_cart_fill);
export const SlidersHorizontal = material(ms_tune);
export const Sparkle = material(ms_star_shine);
export const Sparkles = material(ms_star_shine);
export const Star = material(ms_star);
export const Store = material(ms_storefront);
export const Table = material(ms_table);
export const Trash2 = material(ms_delete);
export const TrendingUp = material(ms_trending_up);
export const Unlink = material(ms_link_off);
export const Upload = material(ms_upload);
export const User = material(ms_person);
export const UserCircle = material(ms_account_circle);
export const Wand2 = material(ms_wand_stars);
export const X = material(ms_close);
export const XCircle = material(ms_cancel);
export const Zap = material(ms_bolt);

// ─── Brand logos ────────────────────────────────────────────

export const Instagram = brand(
  'M7.0301.084c-1.2768.0602-2.1487.264-2.911.5634-.7888.3075-1.4575.72-2.1228 1.3877-.6652.6677-1.075 1.3368-1.3802 2.127-.2954.7638-.4956 1.6365-.552 2.914-.0564 1.2775-.0689 1.6882-.0626 4.947.0062 3.2586.0206 3.6671.0825 4.9473.061 1.2765.264 2.1482.5635 2.9107.308.7889.72 1.4573 1.388 2.1228.6679.6655 1.3365 1.0743 2.1285 1.38.7632.295 1.6361.4961 2.9134.552 1.2773.056 1.6884.069 4.9462.0627 3.2578-.0062 3.668-.0207 4.9478-.0814 1.28-.0607 2.147-.2652 2.9098-.5633.7889-.3086 1.4578-.72 2.1228-1.3881.665-.6682 1.0745-1.3378 1.3795-2.1284.2957-.7632.4966-1.636.552-2.9124.056-1.2809.0692-1.6898.063-4.948-.0063-3.2583-.021-3.6668-.0817-4.9465-.0607-1.2797-.264-2.1487-.5633-2.9117-.3084-.7889-.72-1.4568-1.3876-2.1228C21.2982 1.33 20.628.9208 19.8378.6165 19.074.321 18.2017.1197 16.9244.0645 15.6471.0093 15.236-.005 11.977.0014 8.718.0076 8.31.0215 7.0301.0839m.1402 21.6932c-1.17-.0509-1.8053-.2453-2.2287-.408-.5606-.216-.96-.4771-1.3819-.895-.422-.4178-.6811-.8186-.9-1.378-.1644-.4234-.3624-1.058-.4171-2.228-.0595-1.2645-.072-1.6442-.079-4.848-.007-3.2037.0053-3.583.0607-4.848.05-1.169.2456-1.805.408-2.2282.216-.5613.4762-.96.895-1.3816.4188-.4217.8184-.6814 1.3783-.9003.423-.1651 1.0575-.3614 2.227-.4171 1.2655-.06 1.6447-.072 4.848-.079 3.2033-.007 3.5835.005 4.8495.0608 1.169.0508 1.8053.2445 2.228.408.5608.216.96.4754 1.3816.895.4217.4194.6816.8176.9005 1.3787.1653.4217.3617 1.056.4169 2.2263.0602 1.2655.0739 1.645.0796 4.848.0058 3.203-.0055 3.5834-.061 4.848-.051 1.17-.245 1.8055-.408 2.2294-.216.5604-.4763.96-.8954 1.3814-.419.4215-.8181.6811-1.3783.9-.4224.1649-1.0577.3617-2.2262.4174-1.2656.0595-1.6448.072-4.8493.079-3.2045.007-3.5825-.006-4.848-.0608M16.953 5.5864A1.44 1.44 0 1 0 18.39 4.144a1.44 1.44 0 0 0-1.437 1.4424M5.8385 12.012c.0067 3.4032 2.7706 6.1557 6.173 6.1493 3.4026-.0065 6.157-2.7701 6.1506-6.1733-.0065-3.4032-2.771-6.1565-6.174-6.1498-3.403.0067-6.156 2.771-6.1496 6.1738M8 12.0077a4 4 0 1 1 4.008 3.9921A3.9996 3.9996 0 0 1 8 12.0077',
);
export const Telegram = brand(
  'M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z',
);
export const Shopify = brand(
  'M15.337 23.979l7.216-1.561s-2.604-17.613-2.625-17.73c-.018-.116-.114-.192-.211-.192s-1.929-.136-1.929-.136-1.275-1.274-1.439-1.411c-.045-.037-.075-.057-.121-.074l-.914 21.104h.023zM11.71 11.305s-.81-.424-1.774-.424c-1.447 0-1.504.906-1.504 1.141 0 1.232 3.24 1.715 3.24 4.629 0 2.295-1.44 3.76-3.406 3.76-2.354 0-3.54-1.465-3.54-1.465l.646-2.086s1.245 1.066 2.28 1.066c.675 0 .975-.545.975-.932 0-1.619-2.654-1.694-2.654-4.359-.034-2.237 1.571-4.416 4.827-4.416 1.257 0 1.875.361 1.875.361l-.945 2.715-.02.01zM11.17.83c.136 0 .271.038.405.135-.984.465-2.064 1.639-2.508 3.992-.656.213-1.293.405-1.889.578C7.697 3.75 8.951.84 11.17.84V.83zm1.235 2.949v.135c-.754.232-1.583.484-2.394.736.466-1.777 1.333-2.645 2.085-2.971.193.501.309 1.176.309 2.1zm.539-2.234c.694.074 1.141.867 1.429 1.755-.349.114-.735.231-1.158.366v-.252c0-.752-.096-1.371-.271-1.871v.002zm2.992 1.289c-.02 0-.06.021-.078.021s-.289.075-.714.21c-.423-1.233-1.176-2.37-2.508-2.37h-.115C12.135.209 11.669 0 11.265 0 8.159 0 6.675 3.877 6.21 5.846c-1.194.365-2.063.636-2.16.674-.675.213-.694.232-.772.87-.075.462-1.83 14.063-1.83 14.063L15.009 24l.927-21.166z',
);
export const GoogleSheets = brand(
  'M11.318 12.545H7.91v-1.909h3.41v1.91zM14.728 0v6h6l-6-6zm1.363 10.636h-3.41v1.91h3.41v-1.91zm0 3.273h-3.41v1.91h3.41v-1.91zM20.727 6.5v15.864c0 .904-.732 1.636-1.636 1.636H4.909a1.636 1.636 0 0 1-1.636-1.636V1.636C3.273.732 4.005 0 4.909 0h9.318v6.5h6.5zm-3.273 2.773H6.545v7.909h10.91v-7.91zm-6.136 4.636H7.91v1.91h3.41v-1.91z',
);
