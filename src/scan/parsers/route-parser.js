// HTTP route / webhook declaration parser, by filesystem convention
// only (design doc section 2: "HTTP route and webhook declarations").
// This is intentionally narrow: it recognises the two dominant Node
// framework conventions where the route path IS the file path, so no
// source parsing is needed.
//
//   Next.js App Router:  app/**/route.{js,jsx,ts,tsx}
//   Next.js Pages API:   pages/api/**/*.{js,ts}  (excluding _middleware etc.)
//
// A route not expressed by file convention (e.g. `app.get('/x', ...)` in
// a hand-rolled Express server) is not detected here; that is covered
// separately by sdk-import evidence for the framework itself, and is a
// documented gap (see the final report).

const APP_ROUTE_RE = /(^|\/)app\/(.*)\/route\.(js|jsx|ts|tsx)$/;
const PAGES_API_RE = /(^|\/)pages\/api\/(.*)\.(js|jsx|ts|tsx)$/;

function toRoutePath(segment) {
  // Strip Next.js route groups "(group)" and keep dynamic segments
  // "[id]" as-is; collapse to a leading-slash path.
  const parts = segment
    .split('/')
    .filter(p => p && !/^\(.*\)$/.test(p));
  return `/${parts.join('/')}`;
}

function parseRoute(path) {
  const normalised = path.split('\\').join('/');

  const appMatch = APP_ROUTE_RE.exec(normalised);
  if (appMatch) {
    const routePath = toRoutePath(appMatch[2]);
    return [{ kind: 'route', path, line: null, value: routePath || '/' }];
  }

  const pagesMatch = PAGES_API_RE.exec(normalised);
  if (pagesMatch) {
    const base = pagesMatch[2].replace(/\/index$/, '');
    const routePath = `/api${base ? `/${base}` : ''}`;
    return [{ kind: 'route', path, line: null, value: routePath }];
  }

  return [];
}

module.exports = { parseRoute };
