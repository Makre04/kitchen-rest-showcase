export interface ProviderInvoicePayload {
  type: "TIQUETE" | "FACTURA";
  orderId: string;
  customer?: {
    name: string;
    idType?: "01" | "02" | "03" | "04";
    idNumber?: string;
    email?: string;
  };
  lines: Array<{
    quantity: number;
    description: string;
    unitPrice: number;
    subtotal: number;
    tax: number;
    total: number;
  }>;
  subtotal: number;
  tax: number;
  total: number;
  paymentMethod: string | null;
}

export interface ProviderInvoiceResult {
  key?: string;
  sequence?: number;
  status: "PENDIENTE" | "ACEPTADO" | "RECHAZADO";
  xml?: string;
  responseXml?: string;
  pdfUrl?: string;
  error?: string;
}

export function isProviderConfigured(): boolean {
  return Boolean(process.env.FACTURACION_PROVIDER_API_URL && process.env.FACTURACION_PROVIDER_API_KEY);
}

export async function emitWithFacturacionProvider(
  payload: ProviderInvoicePayload
): Promise<ProviderInvoiceResult | null> {
  if (!isProviderConfigured()) return null;

  const endpoint = process.env.FACTURACION_PROVIDER_API_URL!;
  const apiKey = process.env.FACTURACION_PROVIDER_API_KEY!;

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(payload),
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    return {
      status: "RECHAZADO",
      error: data?.error || data?.message || `Proveedor respondió HTTP ${res.status}`,
    };
  }

  return {
    key: data.key || data.clave || data.haciendaKey,
    sequence: data.sequence || data.consecutivo,
    status: data.status || data.haciendaStatus || "PENDIENTE",
    xml: data.xml || data.xmlSent,
    responseXml: data.responseXml || data.xmlResponse,
    pdfUrl: data.pdfUrl || data.pdf_url,
    error: data.error || null,
  };
}
