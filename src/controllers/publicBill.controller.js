const BillShareLink = require('../models/BillShareLink');
const Bill = require('../models/Bill');
const Customer = require('../models/Customer');
const AppError = require('../utils/AppError');
const logger = require('../utils/logger');

/**
 * Sanitize bill data for public display (no PII leakage)
 * Maps backend field names to web app expected field names
 */
const sanitizeBillForPublic = (bill, customer, shopName = null) => {
  return {
    billNo: bill.billNo,
    billDate: bill.date || bill.createdAt, // Map 'date' to 'billDate' for web compatibility
    date: bill.date || bill.createdAt, // Keep both for backward compatibility
    customerName: customer?.name || 'Customer',
    customerPhone: customer?.phone || null, // Add customer phone for WhatsApp
    shopName: shopName || 'ProfitHooks', // Shop/business name
    items: bill.items.map(item => ({
      name: item.name,
      qty: item.qty,
      rate: item.price, // Map 'price' to 'rate' for web compatibility
      price: item.price, // Keep both
      amount: item.total, // Map 'total' to 'amount' for web compatibility
      total: item.total, // Keep both
    })),
    subTotal: bill.subTotal,
    discount: bill.discount || 0,
    tax: bill.tax || 0,
    grandTotal: bill.grandTotal,
    paidAmount: bill.paidAmount || 0,
    pendingAmount: bill.grandTotal - (bill.paidAmount || 0),
    status: bill.status === 'unpaid' ? 'pending' : bill.status, // Map 'unpaid' to 'pending'
    dueDate: bill.dueDate || null,
    notes: bill.notes || null,
  };
};

/**
 * Render HTML bill viewer
 */
const renderBillHtml = (billData) => {
  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
    }).format(amount);
  };

  const formatDate = (date) => {
    if (!date) return 'N/A';
    try {
      const d = new Date(date);
      if (isNaN(d.getTime())) return 'N/A';
      
      // Use simple formatting without timezone to avoid RangeError
      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const day = d.getDate();
      const month = months[d.getMonth()];
      const year = d.getFullYear();
      return `${day} ${month} ${year}`;
    } catch (error) {
      return 'N/A';
    }
  };

  const statusColor = {
    paid: '#22C55E',
    pending: '#F59E0B',
    cancelled: '#EF4444',
  }[billData.status] || '#6B7280';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Bill ${billData.billNo}</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      background: #F6F7F9;
      color: #111827;
      line-height: 1.6;
      padding: 16px;
    }
    .container {
      max-width: 600px;
      margin: 0 auto;
      background: #FFFFFF;
      border-radius: 12px;
      padding: 24px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
    }
    .header {
      text-align: center;
      margin-bottom: 24px;
      padding-bottom: 16px;
      border-bottom: 1px solid #E5E7EB;
    }
    .bill-no {
      font-size: 24px;
      font-weight: 700;
      color: #111827;
      margin-bottom: 8px;
    }
    .date {
      font-size: 14px;
      color: #6B7280;
    }
    .customer {
      margin-bottom: 24px;
      padding: 16px;
      background: #F9FAFB;
      border-radius: 8px;
    }
    .customer-name {
      font-size: 18px;
      font-weight: 600;
      color: #111827;
    }
    .section-title {
      font-size: 16px;
      font-weight: 600;
      color: #111827;
      margin: 24px 0 12px 0;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 24px;
    }
    th {
      text-align: left;
      padding: 12px 8px;
      font-size: 12px;
      font-weight: 600;
      color: #6B7280;
      text-transform: uppercase;
      border-bottom: 1px solid #E5E7EB;
    }
    td {
      padding: 12px 8px;
      border-bottom: 1px solid #F3F4F6;
    }
    .item-name {
      font-weight: 500;
      color: #111827;
    }
    .item-qty, .item-price, .item-total {
      text-align: right;
      color: #374151;
    }
    .totals {
      margin-top: 16px;
      padding-top: 16px;
      border-top: 2px solid #E5E7EB;
    }
    .total-row {
      display: flex;
      justify-content: space-between;
      padding: 8px 0;
      font-size: 14px;
    }
    .total-row.grand {
      font-size: 18px;
      font-weight: 700;
      color: #111827;
      margin-top: 8px;
      padding-top: 16px;
      border-top: 1px solid #E5E7EB;
    }
    .status-badge {
      display: inline-block;
      padding: 4px 12px;
      border-radius: 12px;
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
      background: ${statusColor}20;
      color: ${statusColor};
    }
    .info-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 16px;
      margin-top: 24px;
    }
    .info-item {
      padding: 12px;
      background: #F9FAFB;
      border-radius: 8px;
    }
    .info-label {
      font-size: 12px;
      color: #6B7280;
      margin-bottom: 4px;
    }
    .info-value {
      font-size: 16px;
      font-weight: 600;
      color: #111827;
    }
    .notes {
      margin-top: 24px;
      padding: 16px;
      background: #F9FAFB;
      border-radius: 8px;
      font-size: 14px;
      color: #374151;
    }
    .footer {
      margin-top: 32px;
      padding-top: 16px;
      border-top: 1px solid #E5E7EB;
      text-align: center;
      font-size: 12px;
      color: #9CA3AF;
    }
    @media (max-width: 600px) {
      .container {
        padding: 16px;
      }
      .info-grid {
        grid-template-columns: 1fr;
      }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="bill-no">${escapeHtml(billData.billNo)}</div>
      <div class="date">${formatDate(billData.date)}</div>
    </div>

    <div class="customer">
      <div class="customer-name">${escapeHtml(billData.customerName)}</div>
    </div>

    <div class="section-title">Items</div>
    <table>
      <thead>
        <tr>
          <th>Item</th>
          <th class="item-qty">Qty</th>
          <th class="item-price">Price</th>
          <th class="item-total">Total</th>
        </tr>
      </thead>
      <tbody>
        ${billData.items.map(item => `
          <tr>
            <td class="item-name">${escapeHtml(item.name)}</td>
            <td class="item-qty">${item.qty}</td>
            <td class="item-price">${formatCurrency(item.price)}</td>
            <td class="item-total">${formatCurrency(item.total)}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>

    <div class="totals">
      <div class="total-row">
        <span>Subtotal</span>
        <span>${formatCurrency(billData.subTotal)}</span>
      </div>
      ${billData.discount > 0 ? `
      <div class="total-row">
        <span>Discount</span>
        <span>-${formatCurrency(billData.discount)}</span>
      </div>
      ` : ''}
      ${billData.tax > 0 ? `
      <div class="total-row">
        <span>Tax</span>
        <span>${formatCurrency(billData.tax)}</span>
      </div>
      ` : ''}
      <div class="total-row grand">
        <span>Total</span>
        <span>${formatCurrency(billData.grandTotal)}</span>
      </div>
    </div>

    <div class="info-grid">
      <div class="info-item">
        <div class="info-label">Status</div>
        <div class="info-value">
          <span class="status-badge">${escapeHtml(billData.status)}</span>
        </div>
      </div>
      <div class="info-item">
        <div class="info-label">Paid</div>
        <div class="info-value">${formatCurrency(billData.paidAmount)}</div>
      </div>
      <div class="info-item">
        <div class="info-label">Pending</div>
        <div class="info-value">${formatCurrency(billData.pendingAmount)}</div>
      </div>
      ${billData.dueDate ? `
      <div class="info-item">
        <div class="info-label">Due Date</div>
        <div class="info-value">${formatDate(billData.dueDate)}</div>
      </div>
      ` : ''}
    </div>

    ${billData.notes ? `
    <div class="notes">
      <strong>Notes:</strong><br>
      ${escapeHtml(billData.notes)}
    </div>
    ` : ''}

    <div class="footer">
      Shared via Profit Hooks
    </div>
  </div>
</body>
</html>`;
};

/**
 * Escape HTML to prevent XSS
 */
const escapeHtml = (text) => {
  if (!text) return '';
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  };
  return String(text).replace(/[&<>"']/g, m => map[m]);
};

/**
 * Get public bill by token (HTML)
 * GET /public/b/:token
 */
exports.getPublicBill = async (req, res, next) => {
  try {
    const {token} = req.params;

    // Validate token format (hex, at least 40 chars)
    if (!token || !/^[a-f0-9]{40,}$/i.test(token)) {
      return res.status(404).send(`
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Link Not Found</title>
          <style>
            body {
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
              background: #F6F7F9;
              display: flex;
              align-items: center;
              justify-content: center;
              min-height: 100vh;
              margin: 0;
              padding: 16px;
            }
            .container {
              text-align: center;
              background: #FFFFFF;
              padding: 32px;
              border-radius: 12px;
              box-shadow: 0 1px 3px rgba(0,0,0,0.1);
            }
            h1 { color: #111827; margin-bottom: 8px; }
            p { color: #6B7280; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>Link Not Found</h1>
            <p>This link is invalid or has expired.</p>
          </div>
        </body>
        </html>
      `);
    }

    // Find active share link
    const shareLink = await BillShareLink.findOne({
      token,
      status: 'active',
    });

    if (!shareLink) {
      return res.status(404).send(`
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Link Expired</title>
          <style>
            body {
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
              background: #F6F7F9;
              display: flex;
              align-items: center;
              justify-content: center;
              min-height: 100vh;
              margin: 0;
              padding: 16px;
            }
            .container {
              text-align: center;
              background: #FFFFFF;
              padding: 32px;
              border-radius: 12px;
              box-shadow: 0 1px 3px rgba(0,0,0,0.1);
            }
            h1 { color: #111827; margin-bottom: 8px; }
            p { color: #6B7280; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>Link Expired or Revoked</h1>
            <p>This share link has been revoked or is no longer available.</p>
          </div>
        </body>
        </html>
      `);
    }

    // Load bill with customer
    const bill = await Bill.findById(shareLink.billId);
    if (!bill) {
      logger.error('[PublicBill] Bill not found for share link', {
        token: token.substring(0, 8) + '...',
        billId: shareLink.billId.toString(),
      });
      return res.status(404).send(`
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Bill Not Found</title>
          <style>
            body {
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
              background: #F6F7F9;
              display: flex;
              align-items: center;
              justify-content: center;
              min-height: 100vh;
              margin: 0;
              padding: 16px;
            }
            .container {
              text-align: center;
              background: #FFFFFF;
              padding: 32px;
              border-radius: 12px;
              box-shadow: 0 1px 3px rgba(0,0,0,0.1);
            }
            h1 { color: #111827; margin-bottom: 8px; }
            p { color: #6B7280; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>Bill Not Found</h1>
            <p>The bill associated with this link could not be found.</p>
          </div>
        </body>
        </html>
      `);
    }

    const customer = await Customer.findById(bill.customerId);

    // Update access metrics
    shareLink.lastAccessAt = new Date();
    shareLink.accessCount += 1;
    await shareLink.save();

    // Sanitize and render
    const billData = sanitizeBillForPublic(bill, customer);
    const html = renderBillHtml(billData);

    // Set no-cache headers
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    res.status(200).send(html);
  } catch (error) {
    logger.error('[PublicBill] Get public bill error', {
      requestId: req.requestId,
      error: error.message,
      stack: error.stack,
    });
    next(error);
  }
};

/**
 * Get public bill by token (JSON)
 * GET /public/b/:token.json
 */
exports.getPublicBillJson = async (req, res, next) => {
  try {
    const {token} = req.params;

    // Validate token format
    if (!token || !/^[a-f0-9]{40,}$/i.test(token)) {
      throw new AppError('Invalid token', 404, 'INVALID_TOKEN');
    }

    // Find active share link
    const shareLink = await BillShareLink.findOne({
      token,
      status: 'active',
    });

    if (!shareLink) {
      throw new AppError('Link expired or revoked', 404, 'LINK_EXPIRED');
    }

    // Load bill with customer
    const bill = await Bill.findById(shareLink.billId);
    if (!bill) {
      throw new AppError('Bill not found', 404, 'BILL_NOT_FOUND');
    }

    const customer = await Customer.findById(bill.customerId);

    // Get shop name from user (for display)
    const User = require('../models/User');
    const user = await User.findById(bill.userId).select('name shopName businessName');
    const shopName = user?.shopName || user?.businessName || user?.name || 'ProfitHooks';

    // Update access metrics
    shareLink.lastAccessAt = new Date();
    shareLink.accessCount += 1;
    await shareLink.save();

    // Sanitize and return
    const billData = sanitizeBillForPublic(bill, customer, shopName);

    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.status(200).json({
      success: true,
      data: billData,
    });
  } catch (error) {
    if (error instanceof AppError) {
      return next(error);
    }
    logger.error('[PublicBill] Get public bill JSON error', {
      requestId: req.requestId,
      error: error.message,
      stack: error.stack,
    });
    next(error);
  }
};
