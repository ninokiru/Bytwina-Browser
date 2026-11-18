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
