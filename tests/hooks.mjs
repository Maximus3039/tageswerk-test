const mockUrl = new URL('./supabase-mock.mjs', import.meta.url).href;

export async function resolve(specifier, context, nextResolve) {
 if (specifier.startsWith('https://cdn.jsdelivr.net/npm/@supabase/supabase-js')) {
  return {url: mockUrl, shortCircuit: true};
 }
 return nextResolve(specifier, context);
}
