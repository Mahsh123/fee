import Link from 'next/link';

interface BreadcrumbItem { href: string; label: string; section: string }

interface BreadcrumbsProps {
  pathname: string;
  workspaceName: string;
  items: readonly BreadcrumbItem[];
  onNavigate?: React.MouseEventHandler<HTMLAnchorElement>;
}

/** Route-derived hierarchy for deep links and nested records. */
export default function Breadcrumbs({ pathname, workspaceName, items, onNavigate }: BreadcrumbsProps) {
  const platform = pathname === '/platform' || pathname.startsWith('/platform/');
  const rootHref = platform ? '/platform' : '/';
  const rootLabel = platform ? 'Wasl' : workspaceName;
  const routeItems = [...items].sort((left, right) => right.href.length - left.href.length);
  const match = routeItems.find((item) => item.href === pathname || (item.href !== '/' && pathname.startsWith(`${item.href}/`)));
  let crumbs: Array<{ href?: string; label: string }>;

  if (pathname === '/platform') {
    crumbs = [{ label: 'Platform overview' }];
  } else if (pathname === '/') {
    crumbs = [{ label: 'Overview' }];
  } else if (pathname.startsWith('/platform/tenants/') && pathname !== '/platform/tenants') {
    crumbs = [
      { href: '/platform', label: 'Platform' },
      { href: '/platform/tenants', label: 'Organisations' },
      { label: 'Tenant details' },
    ];
  } else if (match && pathname !== match.href) {
    crumbs = [
      { href: rootHref, label: rootLabel },
      { href: match.href, label: match.label },
      { label: nestedPageLabel(pathname) },
    ];
  } else if (match) {
    const groupLabel = breadcrumbGroupLabel(match.section);
    crumbs = [
      { href: rootHref, label: rootLabel },
      ...(groupLabel ? [{ label: groupLabel }] : []),
      { label: match.label },
    ];
  } else {
    crumbs = [{ href: rootHref, label: rootLabel }, { label: nestedPageLabel(pathname) }];
  }

  return <nav className="breadcrumbs" aria-label="Breadcrumb"><ol>{crumbs.map((crumb, index) => <li key={`${crumb.label}-${index}`}>
    {index > 0 && <span className="breadcrumb-separator" aria-hidden="true">/</span>}
    {crumb.href && index !== crumbs.length - 1
      ? <Link href={crumb.href} onClick={onNavigate}>{crumb.label}</Link>
      : <span aria-current="page">{crumb.label}</span>}
  </li>)}</ol></nav>;
}

function breadcrumbGroupLabel(section: string): string | null {
  const labels: Record<string, string> = {
    'ORGANIZATION & ACCESS': 'Organization',
    OPERATIONS: 'Operations',
    ADMISSIONS: 'Admissions',
    FEES: 'Fees',
    PAYMENTS: 'Payments',
    ACCOUNT: 'Account',
    WORKSPACES: 'Workspaces',
    COMMERCIAL: 'Commercial',
    'PLATFORM ACCESS': 'Platform access',
  };
  return labels[section] ?? null;
}

function nestedPageLabel(pathname: string): string {
  const last = pathname.split('/').filter(Boolean).at(-1) ?? 'Details';
  if (last.length > 36 || /^[a-z0-9]{20,}$/i.test(last)) return pathname.startsWith('/platform/tenants/') ? 'Tenant details' : 'Record details';
  return last.replace(/[-_]/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}
