export const IVA_RATE = 0.13;

export function formatCRC(amount: string | number): string {
  const num = typeof amount === "string" ? parseFloat(amount) : amount;
  return `₡${num.toLocaleString("es-CR", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}
