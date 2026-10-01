/** "1,8 detik": seconds in Indonesian style (decimal comma), without a pointless ",0". */
export function formatSeconds(seconds: number): string {
  const rounded = Math.round(seconds * 10) / 10;
  const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1).replace(".", ",");
  return `${text} detik`;
}
