function isObj(v: unknown): v is Record<string, any> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function mergeConfig(a: any, b: any): any {
  for (const key of Object.keys(b)) {
    if (isObj(a[key]) && isObj(b[key])) mergeConfig(a[key], b[key]);
    else if (Array.isArray(a[key]) && Array.isArray(b[key])) a[key] = a[key].concat(b[key]);
    else a[key] = b[key];
  }
  return a;
}
