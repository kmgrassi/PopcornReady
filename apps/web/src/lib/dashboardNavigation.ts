const CREATE_ROUTE_PREFIX = "/create";
const FULL_VIDEO_CREATION_ROUTE = "/projects/new";

function normalizePathname(pathname: string) {
  return pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
}

export function isCreateNavigationPath(pathname: string) {
  const normalizedPathname = normalizePathname(pathname);
  return (
    normalizedPathname === CREATE_ROUTE_PREFIX ||
    normalizedPathname.startsWith(`${CREATE_ROUTE_PREFIX}/`) ||
    normalizedPathname === FULL_VIDEO_CREATION_ROUTE
  );
}

export function isLibraryNavigationPath(pathname: string) {
  const normalizedPathname = normalizePathname(pathname);
  if (normalizedPathname === FULL_VIDEO_CREATION_ROUTE) return false;
  return ["/library", "/projects", "/assets", "/outputs"].some(
    (path) =>
      normalizedPathname === path || normalizedPathname.startsWith(`${path}/`),
  );
}
