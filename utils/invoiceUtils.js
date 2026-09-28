const fs = require('fs');
const PDFDocument = require('pdfkit');
const nodemailer = require('nodemailer');
const { invoiceProfile } = require('../config/invoiceConfig');
const { uploadBuffer } = require('./cloudinaryUtils');
const Payment = require('../models/paymentModel');

let mailTransport;
const INVOICE_TEMPLATE_VERSION = 'bw-tax-invoice-v4';

const PAGE = {
  left: 32,
  right: 563,
  width: 531,
  top: 28,
  bottom: 808,
};

const BLACK = '#151515';
const MUTED = BLACK;
const LIGHT = '#FFF7EC';
const BRAND_ORANGE = '#F59A00';
const MILK_CHOCOLATE = '#7A4A2A';

const money = (value) => `INR ${new Intl.NumberFormat('en-IN', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
}).format(Number(value || 0))}`;

const titleCase = (value) => String(value || '')
  .toLowerCase()
  .replace(/\b[a-z]/g, (character) => character.toUpperCase());

const SMALL_NUMBERS = [
  'Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
  'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen',
];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

const integerInWords = (input) => {
  const value = Math.floor(Math.abs(Number(input) || 0));
  if (value < 20) return SMALL_NUMBERS[value];
  if (value < 100) {
    return `${TENS[Math.floor(value / 10)]}${value % 10 ? ` ${SMALL_NUMBERS[value % 10]}` : ''}`;
  }
  const groups = [
    [10000000, 'Crore'],
    [100000, 'Lakh'],
    [1000, 'Thousand'],
    [100, 'Hundred'],
  ];
  for (const [size, label] of groups) {
    if (value >= size) {
      const leading = Math.floor(value / size);
      const remainder = value % size;
      return `${integerInWords(leading)} ${label}${remainder ? ` ${integerInWords(remainder)}` : ''}`;
    }
  }
  return '';
};

const amountInWords = (amount) => {
  const totalPaise = Math.max(0, Math.round(Number(amount || 0) * 100));
  const rupees = Math.floor(totalPaise / 100);
  const paise = totalPaise % 100;
  return `INR ${integerInWords(rupees)} Rupees${paise ? ` and ${integerInWords(paise)} Paise` : ''} Only`;
};

const formatDate = (value) => new Intl.DateTimeFormat('en-IN', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
}).format(new Date(value || Date.now()));

const paymentMethodLabel = (method, status) => {
  const labels = {
    hdfcCard: 'HDFC Credit / Debit Card',
    hdfcNetBanking: 'HDFC NetBanking',
    hdfcUpi: 'HDFC UPI',
    hdfcWallet: 'HDFC Wallet',
    cod: 'Cash on Delivery',
  };
  const paymentStatus = titleCase(status || 'pending');
  return `${labels[method] || titleCase(method || 'Online Payment')} - ${paymentStatus}`;
};

const resolveInvoicePayment = async (order) => {
  const attachedPayment = order.invoicePayment || order.paymentDetails || order.payment;
  if (attachedPayment && typeof attachedPayment === 'object') return attachedPayment;
  if (!order?._id) return null;
  return Payment.findOne({ order: order._id })
    .select('paymentReference gatewayOrderId transactionId bankReferenceNumber method status capturedAt')
    .sort({ capturedAt: -1, createdAt: -1 })
    .lean();
};

const getMailTransport = () => {
  if (mailTransport) return mailTransport;
  const required = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASSWORD', 'SMTP_FROM_EMAIL'];
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length) throw new Error(`Missing SMTP configuration: ${missing.join(', ')}`);
  mailTransport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT),
    secure: process.env.SMTP_SECURE === 'true',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD },
    pool: true,
    maxConnections: 5,
  });
  return mailTransport;
};

const addressLines = (address = {}) => [
  address.recipientName,
  address.line1,
  address.line2,
  address.landmark,
  [address.city, address.state, address.postalCode].filter(Boolean).join(', '),
  address.country,
].filter(Boolean);

const text = (document, value, x, y, options = {}) => {
  const {
    width,
    size = 7.5,
    bold = false,
    color = BLACK,
    align = 'left',
    lineGap = 1,
  } = options;
  document.fillColor(color).font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(size);
  document.text(String(value ?? ''), x, y, { width, align, lineGap });
};

const box = (document, x, y, width, height, options = {}) => {
  document.save();
  if (options.fill) document.rect(x, y, width, height).fill(options.fill);
  document.lineWidth(options.lineWidth || 0.65).strokeColor(options.color || BRAND_ORANGE).rect(x, y, width, height).stroke();
  document.restore();
};

const horizontalLine = (document, x, y, width, color = BRAND_ORANGE) => {
  document.save().lineWidth(0.6).strokeColor(color).moveTo(x, y).lineTo(x + width, y).stroke().restore();
};

const verticalLine = (document, x, y, height, color = BRAND_ORANGE) => {
  document.save().lineWidth(0.6).strokeColor(color).moveTo(x, y).lineTo(x, y + height).stroke().restore();
};

const cellText = (document, value, x, y, width, height, options = {}) => {
  const size = options.size || 7;
  document.font(options.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(size);
  const availableWidth = Math.max(1, width - 8);
  const measured = document.heightOfString(String(value ?? ''), { width: availableWidth, lineGap: 0.5 });
  const top = y + Math.max(3, (height - measured) / 2);
  text(document, value, x + 4, top, {
    width: availableWidth,
    size,
    bold: options.bold,
    align: options.align || 'left',
    color: options.color || BLACK,
    lineGap: 0.5,
  });
};

const drawTitle = (document, suffix = '') => {
  const y = PAGE.top;
  box(document, PAGE.left, y, PAGE.width, 18, { fill: LIGHT });
  text(document, `TAX INVOICE${suffix}`, PAGE.left, y + 4, {
    width: PAGE.width,
    size: 10,
    bold: true,
    color: MILK_CHOCOLATE,
    align: 'center',
  });
  return y + 18;
};

const drawSellerAndMeta = (document, order, profile, startY) => {
  const sellerWidth = 286;
  const metaWidth = PAGE.width - sellerWidth;
  const height = 108;
  box(document, PAGE.left, startY, sellerWidth, height);
  box(document, PAGE.left + sellerWidth, startY, metaWidth, height);

  const logoWidth = 78;
  if (profile.logoPath && fs.existsSync(profile.logoPath)) {
    document.image(profile.logoPath, PAGE.left + 8, startY + 18, { fit: [logoWidth, 62], align: 'center', valign: 'center' });
  }
  const detailsX = PAGE.left + 94;
  const detailsWidth = sellerWidth - 100;
  let detailsY = startY + 6;
  text(document, profile.companyName, detailsX, detailsY, { width: detailsWidth, size: 8.2, bold: true });
  document.font('Helvetica-Bold').fontSize(8.2);
  detailsY += document.heightOfString(profile.companyName, { width: detailsWidth }) + 2;
  const sellerAddress = profile.addressLines.join('\n');
  text(document, sellerAddress, detailsX, detailsY, { width: detailsWidth, size: 6.2, lineGap: 0.2 });
  document.font('Helvetica').fontSize(6.2);
  detailsY += document.heightOfString(sellerAddress, { width: detailsWidth, lineGap: 0.2 }) + 2;
  [
    `GSTIN/UIN: ${profile.gstin}`,
    `State: ${profile.stateName}, Code: ${profile.stateCode}`,
    `Email: ${profile.email}`,
    `Contact: ${profile.phone}`,
    `CIN: ${profile.cin}`,
    `Udyam: ${profile.udyamNumber}`,
  ].forEach((line) => {
    text(document, line, detailsX, detailsY, { width: detailsWidth, size: 6.1 });
    detailsY += 8.2;
  });

  const metaX = PAGE.left + sellerWidth;
  const half = metaWidth / 2;
  horizontalLine(document, metaX, startY + 34, metaWidth);
  horizontalLine(document, metaX, startY + 63, metaWidth);
  verticalLine(document, metaX + half, startY, 34);
  text(document, 'Invoice No.', metaX + 5, startY + 4, { width: half - 10, size: 6.5, color: MUTED });
  text(document, order.invoiceNumber || order.orderNumber, metaX + 5, startY + 15, { width: half - 10, size: 7.4, bold: true });
  text(document, 'Date', metaX + half + 5, startY + 4, { width: half - 10, size: 6.5, color: MUTED });
  text(document, formatDate(order.createdAt), metaX + half + 5, startY + 15, { width: half - 10, size: 7.4, bold: true });
  text(document, 'Mode / Terms of Payment', metaX + 5, startY + 39, { width: metaWidth - 10, size: 6.5, color: MUTED });
  text(document, paymentMethodLabel(order.paymentMethod, order.paymentStatus), metaX + 5, startY + 50, { width: metaWidth - 10, size: 7.2, bold: true });
  text(document, 'Terms of Delivery', metaX + 5, startY + 68, { width: metaWidth - 10, size: 6.5, color: MUTED });
  text(document, profile.termsOfDelivery, metaX + 5, startY + 79, { width: metaWidth - 10, size: 7 });
  return startY + height;
};

const drawBuyerAndPayment = (document, order, payment, startY) => {
  const buyerWidth = 286;
  const paymentWidth = PAGE.width - buyerWidth;
  const height = 92;
  box(document, PAGE.left, startY, buyerWidth, height);
  box(document, PAGE.left + buyerWidth, startY, paymentWidth, height);
  horizontalLine(document, PAGE.left, startY + 15, buyerWidth);
  horizontalLine(document, PAGE.left + buyerWidth, startY + 15, paymentWidth);
  text(document, 'Buyer (Bill to)', PAGE.left + 5, startY + 4, { width: buyerWidth - 10, size: 7, bold: true });
  const billing = order.billingAddress || {};
  text(document, addressLines(billing).join('\n'), PAGE.left + 5, startY + 20, { width: buyerWidth - 10, size: 6.7, lineGap: 0.4 });
  text(document, `Contact: ${billing.phone || '-'}`, PAGE.left + 5, startY + 69, { width: buyerWidth - 10, size: 6.5 });
  text(document, `Email: ${billing.email || '-'}`, PAGE.left + 5, startY + 80, { width: buyerWidth - 10, size: 6.5 });

  const paymentX = PAGE.left + buyerWidth;
  const orderId = order.orderNumber || String(order._id || '-');
  const transactionId = payment?.transactionId || '-';
  const paymentReference = payment?.paymentReference || payment?.gatewayOrderId || '-';
  text(document, 'Order & Payment Details', paymentX + 5, startY + 4, { width: paymentWidth - 10, size: 7, bold: true });
  text(document, `Order ID: ${orderId}`, paymentX + 5, startY + 21, { width: paymentWidth - 10, size: 6.7, bold: true });
  text(document, `Transaction ID: ${transactionId}`, paymentX + 5, startY + 33, { width: paymentWidth - 10, size: 6.7, bold: true });
  text(document, `Payment Reference: ${paymentReference}`, paymentX + 5, startY + 45, { width: paymentWidth - 10, size: 6.7 });
  text(document, `Place of Supply: ${orderPlaceOfSupply(order)}`, paymentX + 5, startY + 57, { width: paymentWidth - 10, size: 6.7 });
  text(document, `Tax Type: ${orderTaxMode(order) === 'interState' ? 'Inter-State (IGST)' : 'Intra-State (CGST + SGST)'}`, paymentX + 5, startY + 69, { width: paymentWidth - 10, size: 6.7 });
  return startY + height;
};

const ITEM_COLUMNS = [
  { key: 'serial', label: 'Sr.\nNo.', width: 28, align: 'center' },
  { key: 'particulars', label: 'Particulars', width: 246 },
  { key: 'hsnCode', label: 'HSN/SAC', width: 47, align: 'center' },
  { key: 'quantity', label: 'Qty', width: 34, align: 'center' },
  { key: 'unitPrice', label: 'Rate', width: 65, align: 'right' },
  { key: 'per', label: 'Per', width: 32, align: 'center' },
  { key: 'amount', label: 'Amount', width: 79, align: 'right' },
];

const drawItemHeader = (document, startY) => {
  const height = 24;
  let x = PAGE.left;
  for (const column of ITEM_COLUMNS) {
    box(document, x, startY, column.width, height, { fill: LIGHT });
    cellText(document, column.label, x, startY, column.width, height, { size: 6.7, bold: true, align: column.align || 'center' });
    x += column.width;
  }
  return startY + height;
};

const itemParticulars = (item) => {
  const attributes = (item.attributes || [])
    .filter((attribute) => attribute?.name && attribute?.value)
    .map((attribute) => `${attribute.name}: ${attribute.value}`)
    .join(', ');
  const details = [item.name, attributes, `SKU: ${item.sku}`];
  if (Number(item.discount) > 0) details.push(`Discount: ${money(item.discount)}`);
  return details.filter(Boolean).join('\n');
};

const drawItemRow = (document, item, serial, startY) => {
  document.font('Helvetica').fontSize(6.8);
  const particulars = itemParticulars(item);
  const rowHeight = Math.max(34, document.heightOfString(particulars, { width: ITEM_COLUMNS[1].width - 8, lineGap: 0.5 }) + 9);
  const values = {
    serial,
    particulars,
    hsnCode: item.hsnCode || '-',
    quantity: Number(item.quantity).toFixed(2),
    unitPrice: money(item.unitPrice),
    per: 'pcs',
    amount: money(item.taxableAmount),
  };
  let x = PAGE.left;
  for (const column of ITEM_COLUMNS) {
    box(document, x, startY, column.width, rowHeight);
    cellText(document, values[column.key], x, startY, column.width, rowHeight, {
      size: column.key === 'particulars' ? 6.7 : 6.5,
      align: column.align,
    });
    x += column.width;
  }
  return startY + rowHeight;
};

const addContinuationPage = (document, order) => {
  document.addPage();
  let y = drawTitle(document, ' - CONTINUED');
  text(document, `Invoice: ${order.invoiceNumber || order.orderNumber}`, PAGE.left + 5, y + 5, { width: PAGE.width - 10, size: 7, bold: true });
  box(document, PAGE.left, y, PAGE.width, 20);
  y += 20;
  return y;
};

const drawItems = (document, order, startY) => {
  let y = drawItemHeader(document, startY);
  order.items.forEach((item, index) => {
    document.font('Helvetica').fontSize(6.8);
    const anticipatedHeight = Math.max(34, document.heightOfString(itemParticulars(item), { width: ITEM_COLUMNS[1].width - 8 }) + 10);
    if (y + anticipatedHeight > 690) {
      y = addContinuationPage(document, order);
      y = drawItemHeader(document, y);
    }
    y = drawItemRow(document, item, index + 1, y);
  });
  return y;
};

const orderMetadataValue = (order, key) => (
  order.metadata?.get ? order.metadata.get(key) : order.metadata?.[key]
);

const orderTaxMode = (order) => {
  if (['intraState', 'interState'].includes(order.taxMode)) return order.taxMode;
  const metadataMode = orderMetadataValue(order, 'taxMode');
  if (['intraState', 'interState'].includes(metadataMode)) return metadataMode;
  if (metadataMode === 'exclusive') return 'intraState';
  if (Number(order.igst || 0) > 0) return 'interState';
  return 'intraState';
};

const orderPlaceOfSupply = (order) => (
  order.placeOfSupplyState
  || orderMetadataValue(order, 'placeOfSupplyState')
  || order.shippingAddress?.state
  || order.billingAddress?.state
  || '-'
);

const taxRateLabel = (order, field, label) => {
  const rates = [...new Set((order.items || [])
    .map((item) => Number(item[field] || 0))
    .filter((rate) => rate > 0))];
  return rates.length === 1 ? `${label} (${rates[0]}%)` : label;
};

const drawTotals = (document, order, startY) => {
  const taxMode = orderTaxMode(order);
  const rows = [
    ['Subtotal', order.subtotal],
    ...(Number(order.discount) > 0 ? [['Discount', -Number(order.discount)]] : []),
    ['Taxable amount', Number(order.subtotal) - Number(order.discount || 0)],
    ...(taxMode === 'interState'
      ? [[taxRateLabel(order, 'igstRate', 'IGST'), order.igst]]
      : [
        [taxRateLabel(order, 'cgstRate', 'CGST'), order.cgst],
        [taxRateLabel(order, 'sgstRate', 'SGST'), order.sgst],
      ]),
    ...(Number(order.shippingCharge) > 0 ? [['Shipping', order.shippingCharge]] : []),
    ...(Number(order.insuranceCharge) > 0 ? [['Insurance', order.insuranceCharge]] : []),
    ...(Number(order.roundOff) !== 0 ? [['Round off', order.roundOff]] : []),
    ['Grand total', order.grandTotal, true],
  ];
  const labelX = PAGE.left + 310;
  const labelWidth = 130;
  const amountWidth = PAGE.right - labelX - labelWidth;
  let y = startY;
  for (const [label, value, bold] of rows) {
    box(document, PAGE.left, y, 310, 17);
    box(document, labelX, y, labelWidth, 17, { fill: bold ? LIGHT : undefined });
    box(document, labelX + labelWidth, y, amountWidth, 17, { fill: bold ? LIGHT : undefined });
    cellText(document, label, labelX, y, labelWidth, 17, { size: bold ? 7.5 : 6.7, bold, align: 'right' });
    cellText(document, money(value), labelX + labelWidth, y, amountWidth, 17, { size: bold ? 7.5 : 6.7, bold, align: 'right' });
    y += 17;
  }
  return y;
};

const drawAmountWords = (document, order, startY) => {
  const height = 38;
  box(document, PAGE.left, startY, PAGE.width, height);
  text(document, 'Amount Chargeable (in words)', PAGE.left + 5, startY + 4, { width: PAGE.width - 10, size: 6.5, color: MUTED });
  text(document, amountInWords(order.grandTotal), PAGE.left + 5, startY + 17, { width: PAGE.width - 70, size: 7.2, bold: true });
  text(document, 'E. & O.E.', PAGE.right - 60, startY + 4, { width: 55, size: 6.3, align: 'right' });
  return startY + height;
};

const taxSummary = (order) => {
  const groups = new Map();
  for (const item of order.items) {
    const hsnCode = item.hsnCode || '-';
    const key = [
      hsnCode,
      Number(item.cgstRate || 0),
      Number(item.sgstRate || 0),
      Number(item.igstRate || 0),
    ].join(':');
    const current = groups.get(key) || {
      hsnCode,
      taxableAmount: 0,
      cgstRate: Number(item.cgstRate || 0),
      cgstAmount: 0,
      sgstRate: Number(item.sgstRate || 0),
      sgstAmount: 0,
      igstRate: Number(item.igstRate || 0),
      igstAmount: 0,
    };
    current.taxableAmount += Number(item.taxableAmount || 0);
    current.cgstAmount += Number(item.cgstAmount || 0);
    current.sgstAmount += Number(item.sgstAmount || 0);
    current.igstAmount += Number(item.igstAmount || 0);
    groups.set(key, current);
  }
  return [...groups.values()];
};

const INTRA_STATE_TAX_COLUMNS = [
  { key: 'hsnCode', width: 222 },
  { key: 'taxableAmount', width: 79, align: 'right' },
  { key: 'cgstRate', width: 48, align: 'center' },
  { key: 'cgstAmount', width: 55, align: 'right' },
  { key: 'sgstRate', width: 48, align: 'center' },
  { key: 'sgstAmount', width: 79, align: 'right' },
];

const INTER_STATE_TAX_COLUMNS = [
  { key: 'hsnCode', width: 222 },
  { key: 'taxableAmount', width: 109, align: 'right' },
  { key: 'igstRate', width: 80, align: 'center' },
  { key: 'igstAmount', width: 120, align: 'right' },
];

const drawTaxSummary = (document, order, startY) => {
  const rows = taxSummary(order);
  const isInterState = orderTaxMode(order) === 'interState';
  const columns = isInterState ? INTER_STATE_TAX_COLUMNS : INTRA_STATE_TAX_COLUMNS;
  let y = startY;
  const topHeaderHeight = 17;
  const secondHeaderHeight = 15;
  box(document, PAGE.left, y, 222, topHeaderHeight + secondHeaderHeight, { fill: LIGHT });
  cellText(document, 'HSN/SAC', PAGE.left, y, 222, 32, { size: 6.5, bold: true });
  if (isInterState) {
    box(document, PAGE.left + 222, y, 109, topHeaderHeight + secondHeaderHeight, { fill: LIGHT });
    box(document, PAGE.left + 331, y, 200, topHeaderHeight, { fill: LIGHT });
    box(document, PAGE.left + 331, y + topHeaderHeight, 80, secondHeaderHeight, { fill: LIGHT });
    box(document, PAGE.left + 411, y + topHeaderHeight, 120, secondHeaderHeight, { fill: LIGHT });
    cellText(document, 'Taxable amount', PAGE.left + 222, y, 109, 32, { size: 6.5, bold: true, align: 'center' });
    cellText(document, 'IGST', PAGE.left + 331, y, 200, topHeaderHeight, { size: 6.5, bold: true, align: 'center' });
    cellText(document, 'Rate', PAGE.left + 331, y + 17, 80, 15, { size: 6.2, align: 'center' });
    cellText(document, 'Amount', PAGE.left + 411, y + 17, 120, 15, { size: 6.2, align: 'center' });
  } else {
    box(document, PAGE.left + 222, y, 79, topHeaderHeight + secondHeaderHeight, { fill: LIGHT });
    box(document, PAGE.left + 301, y, 103, topHeaderHeight, { fill: LIGHT });
    box(document, PAGE.left + 404, y, 127, topHeaderHeight, { fill: LIGHT });
    box(document, PAGE.left + 301, y + topHeaderHeight, 48, secondHeaderHeight, { fill: LIGHT });
    box(document, PAGE.left + 349, y + topHeaderHeight, 55, secondHeaderHeight, { fill: LIGHT });
    box(document, PAGE.left + 404, y + topHeaderHeight, 48, secondHeaderHeight, { fill: LIGHT });
    box(document, PAGE.left + 452, y + topHeaderHeight, 79, secondHeaderHeight, { fill: LIGHT });
    cellText(document, 'Taxable amount', PAGE.left + 222, y, 79, 32, { size: 6.5, bold: true, align: 'center' });
    cellText(document, 'CGST', PAGE.left + 301, y, 103, topHeaderHeight, { size: 6.5, bold: true, align: 'center' });
    cellText(document, 'SGST', PAGE.left + 404, y, 127, topHeaderHeight, { size: 6.5, bold: true, align: 'center' });
    cellText(document, 'Rate', PAGE.left + 301, y + 17, 48, 15, { size: 6.2, align: 'center' });
    cellText(document, 'Amount', PAGE.left + 349, y + 17, 55, 15, { size: 6.2, align: 'center' });
    cellText(document, 'Rate', PAGE.left + 404, y + 17, 48, 15, { size: 6.2, align: 'center' });
    cellText(document, 'Amount', PAGE.left + 452, y + 17, 79, 15, { size: 6.2, align: 'center' });
  }
  y += topHeaderHeight + secondHeaderHeight;

  for (const row of rows) {
    const values = {
      ...row,
      taxableAmount: money(row.taxableAmount),
      cgstRate: `${row.cgstRate}%`,
      cgstAmount: money(row.cgstAmount),
      sgstRate: `${row.sgstRate}%`,
      sgstAmount: money(row.sgstAmount),
      igstRate: `${row.igstRate}%`,
      igstAmount: money(row.igstAmount),
    };
    let x = PAGE.left;
    for (const column of columns) {
      box(document, x, y, column.width, 17);
      cellText(document, values[column.key], x, y, column.width, 17, { size: 6.2, align: column.align });
      x += column.width;
    }
    y += 17;
  }

  const totalTaxable = rows.reduce((sum, row) => sum + row.taxableAmount, 0);
  const totalCgst = rows.reduce((sum, row) => sum + row.cgstAmount, 0);
  const totalSgst = rows.reduce((sum, row) => sum + row.sgstAmount, 0);
  const totalIgst = rows.reduce((sum, row) => sum + row.igstAmount, 0);
  const totals = isInterState
    ? ['Total', money(totalTaxable), '', money(totalIgst)]
    : ['Total', money(totalTaxable), '', money(totalCgst), '', money(totalSgst)];
  let x = PAGE.left;
  columns.forEach((column, index) => {
    box(document, x, y, column.width, 18, { fill: LIGHT });
    cellText(document, totals[index], x, y, column.width, 18, { size: 6.5, bold: true, align: index === 0 ? 'right' : column.align });
    x += column.width;
  });
  return y + 18;
};

const TERMS = [
  '1. Condition of Goods: All jewellery pieces are delivered in good condition. Customers should inspect the product at the time of delivery.',
  '2. Product Composition: Jewellery composition, metal purity, stone details, weight, and specifications are as stated in the product description and accompanying certificate.',
  '3. Certification: Eligible solitaire diamonds are supplied with the applicable laboratory certificate confirming authenticity and specifications.',
  '4. Delivery and Payment: Jewellery is delivered only after receipt of full payment. The customer should verify the package contents and condition upon delivery.',
  '5. Quality Assurance: Bruce & Walsh Luxury Private Limited is committed to authentic jewellery, high craftsmanship standards, quality control, and attention to detail.',
  '6. Buyback Policy: Buyback eligibility and value are subject to the prevailing company policy, product condition, original certificate, original invoice, and applicable time limits.',
  '7. Limitation of Liability: The company is not liable for indirect, incidental, or consequential damages arising from use or inability to use the purchased jewellery.',
];

const drawLegalAndSignatures = (document, order, profile, startY) => {
  const taxWords = amountInWords(Number(order.tax || 0));
  box(document, PAGE.left, startY, PAGE.width, 34);
  text(document, `Tax Amount (in words): ${taxWords}`, PAGE.left + 5, startY + 5, { width: PAGE.width - 10, size: 6.7, bold: true });
  text(document, `Company PAN: ${profile.pan}`, PAGE.left + 5, startY + 19, { width: PAGE.width - 10, size: 6.7 });
  let y = startY + 34;

  document.font('Helvetica').fontSize(6.2);
  const termsHeight = TERMS.reduce((sum, term) => sum + document.heightOfString(term, { width: PAGE.width - 12, lineGap: 0.3 }) + 2, 20);
  box(document, PAGE.left, y, PAGE.width, termsHeight);
  text(document, 'Terms & Conditions', PAGE.left + 5, y + 5, { width: PAGE.width - 10, size: 7, bold: true, color: MILK_CHOCOLATE });
  let termY = y + 17;
  for (const term of TERMS) {
    text(document, term, PAGE.left + 5, termY, { width: PAGE.width - 10, size: 6.2, lineGap: 0.3 });
    document.font('Helvetica').fontSize(6.2);
    termY += document.heightOfString(term, { width: PAGE.width - 10, lineGap: 0.3 }) + 2;
  }
  y += termsHeight;

  const signatureHeight = 56;
  const half = PAGE.width / 2;
  box(document, PAGE.left, y, half, signatureHeight);
  box(document, PAGE.left + half, y, half, signatureHeight);
  text(document, "Customer's Seal and Signature", PAGE.left + 5, y + 5, { width: half - 10, size: 6.7 });
  text(document, `For ${profile.companyName}`, PAGE.left + half + 5, y + 5, { width: half - 10, size: 6.7, bold: true });
  text(document, 'Authorized Signatory', PAGE.left + half + 5, y + signatureHeight - 14, { width: half - 10, size: 6.7, align: 'right' });
  y += signatureHeight;

  text(document, `SUBJECT TO ${profile.jurisdiction.toUpperCase()} JURISDICTION`, PAGE.left, y + 8, { width: PAGE.width, size: 6.5, bold: true, align: 'center' });
  text(document, 'This is a computer-generated invoice.', PAGE.left, y + 19, { width: PAGE.width, size: 6.3, align: 'center', color: MUTED });
  return y + 32;
};

const ensureSummarySpace = (document, order, startY, requiredHeight) => {
  if (startY + requiredHeight <= PAGE.bottom) return startY;
  return addContinuationPage(document, order);
};

const addPageNumbers = (document) => {
  const range = document.bufferedPageRange();
  for (let index = range.start; index < range.start + range.count; index += 1) {
    document.switchToPage(index);
    text(document, `Page ${index + 1} of ${range.count}`, PAGE.left, 805, { width: PAGE.width, size: 5.8, color: MUTED, align: 'right' });
  }
};

const generateInvoicePdf = async (order) => {
  const payment = await resolveInvoicePayment(order);
  const profile = invoiceProfile();
  return new Promise((resolve, reject) => {
    const document = new PDFDocument({
    size: 'A4',
    margins: { top: PAGE.top, right: PAGE.left, bottom: 24, left: PAGE.left },
    bufferPages: true,
    info: {
      Title: `Tax Invoice ${order.invoiceNumber || order.orderNumber}`,
      Author: profile.companyName,
      Subject: `Tax invoice for order ${order.orderNumber}`,
    },
  });
  const chunks = [];
  document.on('data', (chunk) => chunks.push(chunk));
  document.on('end', () => resolve(Buffer.concat(chunks)));
  document.on('error', reject);

  let y = drawTitle(document);
  y = drawSellerAndMeta(document, order, profile, y);
  y = drawBuyerAndPayment(document, order, payment, y);
  y = drawItems(document, order, y);

  const totalsRows = 5
    + (Number(order.discount) > 0 ? 1 : 0)
    + (Number(order.shippingCharge) > 0 ? 1 : 0)
    + (Number(order.insuranceCharge) > 0 ? 1 : 0)
    + (Number(order.roundOff) !== 0 ? 1 : 0);
  const summaryRows = taxSummary(order).length;
  y = ensureSummarySpace(document, order, y, totalsRows * 17 + 38 + 50 + summaryRows * 17);
  y = drawTotals(document, order, y);
  y = drawAmountWords(document, order, y);
  y = drawTaxSummary(document, order, y);

  document.font('Helvetica').fontSize(6.2);
  const legalHeight = 34
    + TERMS.reduce((sum, term) => sum + document.heightOfString(term, { width: PAGE.width - 12, lineGap: 0.3 }) + 2, 20)
    + 56 + 32;
  y = ensureSummarySpace(document, order, y, legalHeight);
  drawLegalAndSignatures(document, order, profile, y);
  addPageNumbers(document);
  document.end();
  });
};

const createAndUploadInvoice = async (order) => {
  const invoiceNumber = order.invoiceNumber || `INV-${order.orderNumber}`;
  order.invoiceNumber = invoiceNumber;
  const pdfBuffer = await generateInvoicePdf(order);
  const uploaded = await uploadBuffer(
    { buffer: pdfBuffer, mimetype: 'application/pdf' },
    {
      folder: `${process.env.CLOUDINARY_FOLDER || 'bruce-walsh-luxury'}/invoices`,
      resourceType: 'raw',
      uploadOptions: { public_id: invoiceNumber, overwrite: true, invalidate: true },
    },
  );
  order.invoiceUrl = uploaded.url;
  if (!order.metadata) order.metadata = new Map();
  if (typeof order.metadata.set === 'function') {
    order.metadata.set('invoiceTemplateVersion', INVOICE_TEMPLATE_VERSION);
  } else {
    order.metadata.invoiceTemplateVersion = INVOICE_TEMPLATE_VERSION;
  }
  await order.save();
  return { invoiceNumber, invoiceUrl: uploaded.url, pdfBuffer };
};

const sendInvoiceEmail = async ({ user, order, invoice }) => {
  await getMailTransport().sendMail({
    from: `"${process.env.SMTP_FROM_NAME || 'Bruce & Walsh Luxury'}" <${process.env.SMTP_FROM_EMAIL}>`,
    to: user.email,
    subject: `Your Bruce & Walsh Luxury order ${order.orderNumber}`,
    text: `Thank you for your order ${order.orderNumber}. Your invoice ${invoice.invoiceNumber} is attached and is also available at ${invoice.invoiceUrl}`,
    html: `<p>Hello ${String(user.firstName || 'Customer').replace(/[&<>'"]/g, '')},</p><p>Thank you for your order <strong>${order.orderNumber}</strong>.</p><p>Your tax invoice is attached.</p>`,
    attachments: [{ filename: `${invoice.invoiceNumber}.pdf`, content: invoice.pdfBuffer, contentType: 'application/pdf' }],
  });
};

module.exports = {
  INVOICE_TEMPLATE_VERSION,
  amountInWords,
  generateInvoicePdf,
  createAndUploadInvoice,
  sendInvoiceEmail,
};
