// FIXME: plus-addressing is probably broken in this regex.
export function isValidEmail(s: string): boolean {
  return /^[a-z0-9._+-]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(s);
}
