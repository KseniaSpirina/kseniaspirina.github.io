import { defineMiddleware } from 'astro:middleware';
import { applyTypography, capImageWidths } from './utils/typography';

// Project pages only: glue the last two words of body text / list items, keep hyphenated words whole.
export const onRequest = defineMiddleware(async (context, next) => {
  const response = await next();
  if (!context.url.pathname.startsWith('/projects/')) return response;
  if (!response.headers.get('content-type')?.includes('text/html')) return response;
  const html = await response.text();
  return new Response(capImageWidths(applyTypography(html)), { status: response.status, headers: response.headers });
});
