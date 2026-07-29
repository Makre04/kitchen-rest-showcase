// Costa Rica Hacienda electronic invoicing service
// Implements: Factura Electrónica v4.3 / Tiquete Electrónico v4.3
// API: https://api.comprobanteselectronicos.go.cr/recepcion/v1/

const HACIENDA_API_PROD = "https://api.comprobanteselectronicos.go.cr/recepcion/v1";
const HACIENDA_API_SANDBOX = "https://api-sandbox.comprobanteselectronicos.go.cr/recepcion/v1";
const IDP_PROD = "https://idp.comprobanteselectronicos.go.cr/auth/realms/rut/protocol/openid-connect/token";
const IDP_SANDBOX = "https://idp.comprobanteselectronicos.go.cr/auth/realms/rut-stag/protocol/openid-connect/token";

export interface HaciendaConfig {
  cedula: string;
  nombre: string;
  nombreComercial?: string;
  codigoActividad: string;
  email: string;
  telefono: string;
  provincia: string;
  canton: string;
  distrito: string;
  direccion: string;
  usuario: string;
  password: string;
  pin: string;
  sandbox: boolean;
}

export interface InvoiceLine {
  quantity: number;
  description: string;
  unitPrice: number;
  subtotal: number;
  tax: number;
  total: number;
}

export interface InvoiceData {
  type: "TIQUETE" | "FACTURA";
  sequence: number;
  emitterConfig: HaciendaConfig;
  receiver?: {
    name: string;
    idType: "01" | "02" | "03" | "04"; // 01=Física, 02=Jurídica, 03=DIMEX, 04=NITE
    idNumber: string;
    email?: string;
  };
  lines: InvoiceLine[];
  subtotal: number;
  tax: number;
  total: number;
  paymentMethod: "01" | "02" | "03" | "04" | "99"; // 01=Efectivo, 02=Tarjeta, 03=Cheque, 04=Transferencia, 99=Otros
  saleCondition: "01" | "02" | "03"; // 01=Contado, 02=Crédito, 03=Consignación
}

// Genera la clave numérica de 50 dígitos para Hacienda
export function generateClaveNumerica(
  cedula: string,
  consecutivo: string,
  situacion: "1" | "2" | "3", // 1=Normal, 2=Contingencia, 3=Sin internet
  codigoSeguridad: string
): string {
  const now = new Date();
  const pais = "506";
  const dia = String(now.getDate()).padStart(2, "0");
  const mes = String(now.getMonth() + 1).padStart(2, "0");
  const anio = String(now.getFullYear()).slice(-2);
  const cedulaPadded = cedula.replace(/[^0-9]/g, "").padStart(12, "0");
  const consecutivoPadded = consecutivo.padStart(20, "0");
  const seguridadPadded = codigoSeguridad.padStart(8, "0");

  return `${pais}${dia}${mes}${anio}${cedulaPadded}${consecutivoPadded}${situacion}${seguridadPadded}`;
}

// Genera el consecutivo de 20 dígitos
// Formato: TT-SSS-CCCC-NNNNNNNNNN
// TT = tipo sede (01), SSS = terminal (00001), CCCC = tipo doc, N = consecutivo
export function generateConsecutivo(
  type: "TIQUETE" | "FACTURA" | "NOTA_CREDITO" | "NOTA_DEBITO",
  sequence: number
): string {
  const sede = "001";
  const terminal = "00001";
  const tipoMap: Record<string, string> = {
    FACTURA: "01",
    NOTA_DEBITO: "02",
    NOTA_CREDITO: "03",
    TIQUETE: "04",
  };
  const tipo = tipoMap[type] || "04";
  const numero = String(sequence).padStart(10, "0");
  return `${sede}${terminal}${tipo}${numero}`;
}

// Genera código de seguridad aleatorio de 8 dígitos
export function generateCodigoSeguridad(): string {
  return String(Math.floor(10000000 + Math.random() * 90000000));
}

// Mapea método de pago interno a código de Hacienda
export type HaciendaPaymentCode = "01" | "02" | "03" | "04" | "99";

export function mapPaymentMethod(method: string | null): HaciendaPaymentCode {
  const map: Record<string, HaciendaPaymentCode> = {
    EFECTIVO: "01",
    TARJETA: "02",
    SINPE: "04", // Transferencia/depósito bancario
    MIXTO: "99",
  };
  return map[method || "EFECTIVO"] || "99";
}

// Genera XML para Factura Electrónica o Tiquete Electrónico
export function generateInvoiceXml(
  clave: string,
  data: InvoiceData
): string {
  const { type, emitterConfig, receiver, lines, subtotal, tax, total, paymentMethod, saleCondition } = data;

  const rootTag = type === "FACTURA" ? "FacturaElectronica" : "TiqueteElectronico";
  const ns = "https://cdn.comprobanteselectronicos.go.cr/xml-schemas/v4.3/";

  const now = new Date().toISOString();
  const consecutivo = clave.substring(21, 41);

  const linesXml = lines
    .map(
      (line, i) => `
    <LineaDetalle>
      <NumeroLinea>${i + 1}</NumeroLinea>
      <Codigo>${String(i + 1).padStart(4, "0")}</Codigo>
      <CodigoComercial>
        <Tipo>04</Tipo>
        <Codigo>${String(i + 1).padStart(4, "0")}</Codigo>
      </CodigoComercial>
      <Cantidad>${line.quantity.toFixed(3)}</Cantidad>
      <UnidadMedida>Unid</UnidadMedida>
      <Detalle>${escapeXml(line.description)}</Detalle>
      <PrecioUnitario>${line.unitPrice.toFixed(5)}</PrecioUnitario>
      <MontoTotal>${line.subtotal.toFixed(5)}</MontoTotal>
      <Impuesto>
        <Codigo>01</Codigo>
        <CodigoTarifa>08</CodigoTarifa>
        <Tarifa>13.00</Tarifa>
        <Monto>${line.tax.toFixed(5)}</Monto>
      </Impuesto>
      <ImpuestoNeto>${line.tax.toFixed(5)}</ImpuestoNeto>
      <MontoTotalLinea>${line.total.toFixed(5)}</MontoTotalLinea>
    </LineaDetalle>`
    )
    .join("");

  const receiverXml =
    type === "FACTURA" && receiver
      ? `
  <Receptor>
    <Nombre>${escapeXml(receiver.name)}</Nombre>
    <Identificacion>
      <Tipo>${receiver.idType}</Tipo>
      <Numero>${receiver.idNumber.replace(/[^0-9]/g, "")}</Numero>
    </Identificacion>
    ${receiver.email ? `<CorreoElectronico>${escapeXml(receiver.email)}</CorreoElectronico>` : ""}
  </Receptor>`
      : "";

  return `<?xml version="1.0" encoding="utf-8"?>
<${rootTag} xmlns="${ns}" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="${ns} ${ns}${rootTag === "FacturaElectronica" ? "FacturaElectronica_V4.3.xsd" : "TiqueteElectronico_V4.3.xsd"}">
  <Clave>${clave}</Clave>
  <CodigoActividad>${emitterConfig.codigoActividad}</CodigoActividad>
  <NumeroConsecutivo>${consecutivo}</NumeroConsecutivo>
  <FechaEmision>${now}</FechaEmision>
  <Emisor>
    <Nombre>${escapeXml(emitterConfig.nombre)}</Nombre>
    ${emitterConfig.nombreComercial ? `<NombreComercial>${escapeXml(emitterConfig.nombreComercial)}</NombreComercial>` : ""}
    <Identificacion>
      <Tipo>02</Tipo>
      <Numero>${emitterConfig.cedula.replace(/[^0-9]/g, "")}</Numero>
    </Identificacion>
    <Ubicacion>
      <Provincia>${emitterConfig.provincia}</Provincia>
      <Canton>${emitterConfig.canton.padStart(2, "0")}</Canton>
      <Distrito>${emitterConfig.distrito.padStart(2, "0")}</Distrito>
      <OtrasSenas>${escapeXml(emitterConfig.direccion)}</OtrasSenas>
    </Ubicacion>
    <Telefono>
      <CodigoPais>506</CodigoPais>
      <NumTelefono>${emitterConfig.telefono.replace(/[^0-9]/g, "")}</NumTelefono>
    </Telefono>
    <CorreoElectronico>${escapeXml(emitterConfig.email)}</CorreoElectronico>
  </Emisor>${receiverXml}
  <CondicionVenta>${saleCondition}</CondicionVenta>
  <MedioPago>${paymentMethod}</MedioPago>
  <DetalleServicio>${linesXml}
  </DetalleServicio>
  <ResumenFactura>
    <CodigoTipoMoneda>
      <CodigoMoneda>CRC</CodigoMoneda>
      <TipoCambio>1.00000</TipoCambio>
    </CodigoTipoMoneda>
    <TotalServGravados>${subtotal.toFixed(5)}</TotalServGravados>
    <TotalServExentos>0.00000</TotalServExentos>
    <TotalGravado>${subtotal.toFixed(5)}</TotalGravado>
    <TotalExento>0.00000</TotalExento>
    <TotalVenta>${subtotal.toFixed(5)}</TotalVenta>
    <TotalDescuentos>0.00000</TotalDescuentos>
    <TotalVentaNeta>${subtotal.toFixed(5)}</TotalVentaNeta>
    <TotalImpuesto>${tax.toFixed(5)}</TotalImpuesto>
    <TotalComprobante>${total.toFixed(5)}</TotalComprobante>
  </ResumenFactura>
</${rootTag}>`;
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// Obtener token de autenticación de Hacienda
export async function getHaciendaToken(config: HaciendaConfig): Promise<string> {
  const idpUrl = config.sandbox ? IDP_SANDBOX : IDP_PROD;

  const body = new URLSearchParams({
    grant_type: "password",
    client_id: "api-stag",
    username: config.usuario,
    password: config.password,
  });

  const res = await fetch(idpUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!res.ok) {
    throw new Error(`Error autenticando con Hacienda: ${res.status}`);
  }

  const data = await res.json();
  return data.access_token;
}

// Enviar comprobante a Hacienda
export async function sendToHacienda(
  xml: string,
  clave: string,
  config: HaciendaConfig
): Promise<{ status: number; body: any }> {
  const apiUrl = config.sandbox ? HACIENDA_API_SANDBOX : HACIENDA_API_PROD;
  const token = await getHaciendaToken(config);

  const xmlBase64 = Buffer.from(xml, "utf-8").toString("base64");

  const payload = {
    clave,
    fecha: new Date().toISOString(),
    emisor: {
      tipoIdentificacion: "02",
      numeroIdentificacion: config.cedula.replace(/[^0-9]/g, ""),
    },
    comprobanteXml: xmlBase64,
  };

  const res = await fetch(`${apiUrl}/recepcion`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });

  let body = null;
  try {
    body = await res.json();
  } catch {
    body = await res.text();
  }

  return { status: res.status, body };
}

// Consultar estado de comprobante en Hacienda
export async function checkHaciendaStatus(
  clave: string,
  config: HaciendaConfig
): Promise<{ status: string; xml?: string; error?: string }> {
  const apiUrl = config.sandbox ? HACIENDA_API_SANDBOX : HACIENDA_API_PROD;
  const token = await getHaciendaToken(config);

  const res = await fetch(`${apiUrl}/recepcion/${clave}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    return { status: "ERROR", error: `HTTP ${res.status}` };
  }

  const data = await res.json();

  // ind-estado: "aceptado", "rechazado", "procesando"
  const estado = data["ind-estado"] || "procesando";
  const responseXml = data["respuesta-xml"]
    ? Buffer.from(data["respuesta-xml"], "base64").toString("utf-8")
    : undefined;

  return {
    status: estado === "aceptado" ? "ACEPTADO" : estado === "rechazado" ? "RECHAZADO" : "PENDIENTE",
    xml: responseXml,
    error: estado === "rechazado" ? "Comprobante rechazado por Hacienda" : undefined,
  };
}
