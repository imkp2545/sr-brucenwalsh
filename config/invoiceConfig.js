const path = require('path');

const environmentValue = (name, fallback = '') => {
  const value = process.env[name];
  return value === undefined || value === null || String(value).trim() === ''
    ? fallback
    : String(value).trim();
};

const invoiceProfile = () => ({
  companyName: environmentValue('INVOICE_COMPANY_NAME', 'Bruce and Walsh Luxury Private Limited'),
  addressLines: [
    environmentValue('INVOICE_ADDRESS_LINE1', '5th Floor, 64/B Bansilal Building, Jagannath Shankarsheth Marg'),
    environmentValue('INVOICE_ADDRESS_LINE2', 'Opera House, Girgaon, Mumbai - 400004'),
  ].filter(Boolean),
  gstin: environmentValue('INVOICE_GSTIN', '27AAJCB8267G1ZB'),
  stateName: environmentValue('INVOICE_STATE_NAME', 'Maharashtra'),
  stateCode: environmentValue('INVOICE_STATE_CODE', '27'),
  email: environmentValue('INVOICE_EMAIL', 'brucenwalsh@gmail.com'),
  phone: environmentValue('INVOICE_PHONE', '9833899977'),
  cin: environmentValue('INVOICE_CIN', 'U19200MH2021PTC359722'),
  udyamNumber: environmentValue('INVOICE_UDYAM_NUMBER', 'UDHYAM-MH-19-0293625'),
  pan: environmentValue('INVOICE_PAN', 'AAJCB8267G'),
  bank: {
    accountName: environmentValue('INVOICE_BANK_ACCOUNT_NAME', 'Bruce & Walsh Luxury Private Limited'),
    bankName: environmentValue('INVOICE_BANK_NAME', 'HDFC Bank Ltd'),
    accountNumber: environmentValue('INVOICE_BANK_ACCOUNT_NUMBER', '50200108603820'),
    branch: environmentValue('INVOICE_BANK_BRANCH', 'Chowpatty Branch'),
    ifsc: environmentValue('INVOICE_BANK_IFSC', 'HDFC0001201'),
  },
  termsOfDelivery: environmentValue('INVOICE_TERMS_OF_DELIVERY', 'Delivery after receipt of full payment'),
  jurisdiction: environmentValue('INVOICE_JURISDICTION', 'Mumbai'),
  logoPath: environmentValue(
    'INVOICE_LOGO_PATH',
    path.join(__dirname, '..', 'assets', 'invoice-logo.png'),
  ),
});

module.exports = { invoiceProfile };
