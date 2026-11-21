// Bộ biểu tượng SVG dùng chung (nét mảnh 1.8px, kế thừa currentColor).
// Không dùng emoji để giao diện đồng nhất giữa các phiên bản Windows.
import type { SVGProps } from "react";

type Props = SVGProps<SVGSVGElement>;

function Icon({ children, ...rest }: Props) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}

export const PlusIcon = (p: Props) => (
  <Icon {...p}>
    <path d="M12 5v14M5 12h14" />
  </Icon>
);

export const CloseIcon = (p: Props) => (
  <Icon {...p}>
    <path d="M6 6l12 12M18 6L6 18" />
  </Icon>
);

export const PinIcon = (p: Props) => (
  <Icon {...p}>
    <path d="M9 4h6l-1 6 3 3v2H7v-2l3-3-1-6Z" />
    <path d="M12 15v5" />
  </Icon>
);

export const StarIcon = (p: Props) => (
  <Icon {...p}>
    <path d="m12 4 2.4 4.9 5.4.8-3.9 3.8.9 5.4L12 16.4 7.2 18.9l.9-5.4L4.2 9.7l5.4-.8L12 4Z" />
  </Icon>
);

export const ClockIcon = (p: Props) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 2" />
  </Icon>
);

export const FileTextIcon = (p: Props) => (
  <Icon {...p}>
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
    <line x1="16" y1="13" x2="8" y2="13" />
    <line x1="16" y1="17" x2="8" y2="17" />
    <line x1="10" y1="9" x2="8" y2="9" />
  </Icon>
);

export const LayersIcon = (p: Props) => (
  <Icon {...p}>
    <polygon points="12 2 2 7 12 12 22 7 12 2" />
    <polyline points="2 17 12 22 22 17" />
    <polyline points="2 12 12 17 22 12" />
  </Icon>
);

export const GridIcon = (p: Props) => (
  <Icon {...p}>
    <rect x="4" y="4" width="7" height="7" rx="2" />
    <rect x="13" y="4" width="7" height="7" rx="2" />
    <rect x="4" y="13" width="7" height="7" rx="2" />
    <rect x="13" y="13" width="7" height="7" rx="2" />
  </Icon>
);

export const BookIcon = (p: Props) => (
  <Icon {...p}>
    <path d="M5 5.5A2.5 2.5 0 0 1 7.5 3H19v15H7.5A2.5 2.5 0 0 0 5 20.5V5.5Z" />
    <path d="M5 18.5V21h12.5" />
  </Icon>
);

export const DownloadIcon = (p: Props) => (
  <Icon {...p}>
    <path d="M12 4v11" />
    <path d="m7.5 10.5 4.5 4.5 4.5-4.5" />
    <path d="M5 20h14" />
  </Icon>
);

export const GlassesIcon = (p: Props) => (
  <Icon {...p}>
    <circle cx="7" cy="14" r="3.2" />
    <circle cx="17" cy="14" r="3.2" />
    <path d="M10.2 14h3.6M4 13 6 8h4M20 13l-2-5h-4" />
  </Icon>
);

export const SettingsIcon = (p: Props) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 13.5a7.7 7.7 0 0 0 0-3l1.7-1.3-1.8-3.1-2 .8a7.5 7.5 0 0 0-2.6-1.5L14.4 3h-3.6l-.3 2.4a7.5 7.5 0 0 0-2.6 1.5l-2-.8L4 9.2l1.6 1.3a7.7 7.7 0 0 0 0 3L4 14.8l1.9 3.1 2-.8a7.5 7.5 0 0 0 2.6 1.5l.3 2.4h3.6l.3-2.4a7.5 7.5 0 0 0 2.6-1.5l2 .8 1.8-3.1-1.7-1.3Z" />
  </Icon>
);

export const ArrowLeftIcon = (p: Props) => (
  <Icon {...p}>
    <path d="M19 12H5" />
    <path d="m11 6-6 6 6 6" />
  </Icon>
);

export const ArrowRightIcon = (p: Props) => (
  <Icon {...p}>
    <path d="M5 12h14" />
    <path d="m13 6 6 6-6 6" />
  </Icon>
);

export const ReloadIcon = (p: Props) => (
  <Icon {...p}>
    <path d="M20 12a8 8 0 1 1-2.3-5.6" />
    <path d="M20 4v4h-4" />
  </Icon>
);

export const StopIcon = (p: Props) => (
  <Icon {...p}>
    <rect x="7" y="7" width="10" height="10" rx="2" />
  </Icon>
);

export const HomeIcon = (p: Props) => (
  <Icon {...p}>
    <path d="m4 10.5 8-6.5 8 6.5" />
    <path d="M6.5 9.5V20h11V9.5" />
  </Icon>
);

export const TagIcon = (p: Props) => (
  <Icon {...p}>
    <path d="M4 4h7l9 9-7 7-9-9V4Z" />
    <circle cx="8" cy="8" r="1.3" />
  </Icon>
);

export const LockIcon = (p: Props) => (
  <Icon {...p}>
    <rect x="5" y="10" width="14" height="10" rx="3" />
    <path d="M8.5 10V7.5a3.5 3.5 0 0 1 7 0V10" />
  </Icon>
);

export const GlobeIcon = (p: Props) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M3.5 12h17M12 3.5c2.5 2.4 2.5 14.6 0 17M12 3.5c-2.5 2.4-2.5 14.6 0 17" />
  </Icon>
);

export const SearchIcon = (p: Props) => (
  <Icon {...p}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m16 16 4 4" />
  </Icon>
);

export const TrashIcon = (p: Props) => (
  <Icon {...p}>
    <path d="M4 7h16M9 7V5h6v2" />
    <path d="M6.5 7 8 20h8l1.5-13" />
  </Icon>
);

export const BookTextIcon = (p: Props) => (
  <Icon {...p}>
    <path d="M5 5.5A2.5 2.5 0 0 1 7.5 3H19v15H7.5A2.5 2.5 0 0 0 5 20.5V5.5Z" />
    <path d="M5 18.5V21h12.5" />
    <path d="M9 7.5h6M9 11h4" />
  </Icon>
);

export const CheckCircleIcon = (p: Props) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="m8.5 12.2 2.4 2.4 4.6-5" />
  </Icon>
);

export const AlertIcon = (p: Props) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5v5.5" />
    <path d="M12 16.4h.01" />
  </Icon>
);

export const BookmarkPlusIcon = (p: Props) => (
  <Icon {...p}>
    <path d="M6 4h9a3 3 0 0 1 3 3v13l-6-3.6L6 20V4Z" />
  </Icon>
);

export const MoreIcon = (p: Props) => (
  <Icon {...p} fill="currentColor" stroke="none">
    <circle cx="12" cy="5" r="1.7" />
    <circle cx="12" cy="12" r="1.7" />
    <circle cx="12" cy="19" r="1.7" />
  </Icon>
);

/// Chia màn hình: khung trang với vách giữa.
export const SplitIcon = (p: Props) => (
  <Icon {...p}>
    <rect x="3" y="4" width="18" height="16" rx="3" />
    <path d="M12 4v16" />
  </Icon>
);

// Bộ icon cho mục lục trang Cài đặt (mục nào cũng có icon như Cốc Cốc/Chrome).
export const UserIcon = (p: Props) => (
  <Icon {...p}>
    <circle cx="12" cy="8" r="3.6" />
    <path d="M5.5 20a6.5 6.5 0 0 1 13 0" />
  </Icon>
);

export const PaletteIcon = (p: Props) => (
  <Icon {...p}>
    <path d="M12 3a9 9 0 1 0 0 18c1.4 0 2-1 2-2 0-1.2-.7-1.4-.7-2.2 0-.7.6-1.3 1.4-1.3H17a4 4 0 0 0 4-4c0-4.5-4-8.5-9-8.5Z" />
    <circle cx="8.5" cy="10.5" r="1" />
    <circle cx="12" cy="7.5" r="1" />
    <circle cx="15.5" cy="10.5" r="1" />
  </Icon>
);

export const PowerIcon = (p: Props) => (
  <Icon {...p}>
    <path d="M12 4v8" />
    <path d="M7.5 7a6.5 6.5 0 1 0 9 0" />
  </Icon>
);

export const ShieldIcon = (p: Props) => (
  <Icon {...p}>
    <path d="M12 3.5 19 6v5.5c0 4.2-2.9 7.4-7 9-4.1-1.6-7-4.8-7-9V6l7-2.5Z" />
  </Icon>
);

export const BoltIcon = (p: Props) => (
  <Icon {...p}>
    <path d="M13 3 6 13.5h5L10 21l7-10.5h-5L13 3Z" />
  </Icon>
);

export const TranslateIcon = (p: Props) => (
  <Icon {...p}>
    <path d="M4 6h9M8.5 4v2M11 6c-.8 4-3.6 7.5-7 9M7 11c1.2 2.4 3.4 4.2 6 5" />
    <path d="M13 20l4.5-10L22 20M15 17h5" />
  </Icon>
);

export const EyeIcon = (p: Props) => (
  <Icon {...p}>
    <path d="M3.5 12S7 6.5 12 6.5 20.5 12 20.5 12 17 17.5 12 17.5 3.5 12 3.5 12Z" />
    <circle cx="12" cy="12" r="2.8" />
  </Icon>
);

export const CopyIcon = (p: Props) => (
  <Icon {...p}>
    <rect x="9" y="9" width="11" height="11" rx="2.5" />
    <path d="M15 9V6.5A2.5 2.5 0 0 0 12.5 4H6.5A2.5 2.5 0 0 0 4 6.5v6A2.5 2.5 0 0 0 6.5 15H9" />
  </Icon>
);

export const KeyIcon = (p: Props) => (
  <Icon {...p}>
    <circle cx="8" cy="12" r="3.5" />
    <path d="M11.5 12H20M17 12v3.5M20 12v2.5" />
  </Icon>
);

// Mũi tên vào mục con, như hàng "đã đăng nhập" trong menu Cốc Cốc.
export const ChevronRightIcon = (p: Props) => (
  <Icon {...p}>
    <path d="M9 6l6 6-6 6" />
  </Icon>
);

// Đĩa + mũi tên: mục sao lưu trong Cài đặt.
export const BackupIcon = (p: Props) => (
  <Icon {...p}>
    <ellipse cx="12" cy="6" rx="7" ry="3" />
    <path d="M5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6" />
    <path d="M12 11v6M9.5 14.5 12 17l2.5-2.5" />
  </Icon>
);
