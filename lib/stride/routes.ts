/** Retired routes have a deliberate destination and no legacy feature reader. */
export function normalizeRoute(route: string): string {
  if (route === 'pages' || route.startsWith('page/')) return 'notes';
  if (route === 'history' || route === 'activity') return 'settings/activity';
  if (
    ['explore', 'databases', 'filters'].includes(route) ||
    route.startsWith('database/') ||
    route.startsWith('filter/')
  )
    return 'today';
  return route;
}
