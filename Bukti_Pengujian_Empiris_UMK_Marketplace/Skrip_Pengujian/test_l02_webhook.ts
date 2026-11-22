import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { startTestServer, stopTestServer, api, prisma, redactSecrets } from './harness/test_app';

const EVIDENCE_DIR = path.resolve(__dirname, '../../docs/retest-blocked/evidence');
const SERVER_KEY = process.env.MIDTRANS_SERVER_KEY!;

function appendLog(caseId: string, text: string) {
  if (!fs.existsSync(EVIDENCE_DIR)) {
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  }
  const filePath = path.join(EVIDENCE_DIR, `${caseId}.log`);
  fs.appendFileSync(filePath, redactSecrets(text) + '\n', 'utf8');
}

function initLog(caseId: string, title: string) {
  if (!fs.existsSync(EVIDENCE_DIR)) {
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  }
  const filePath = path.join(EVIDENCE_DIR, `${caseId}.log`);
  const header = [
    `================================================================================`,
    `TEST CASE EVIDENCE LOG: ${caseId} - ${title}`,
    `Business Rule: BR5: Webhook Midtrans settlement -> stok berkurang`,
    `Target: API / HTTP Level Validation`,
    `Database: Supabase umk-marketplace-testing (isolated testing DB: zojvqbaylpxqjygeqnpj)`,
    `Generated At: ${new Date().toISOString()}`,
    `================================================================================\n`
  ].join('\n');
  fs.writeFileSync(filePath, redactSecrets(header), 'utf8');
}

function makeSignature(orderId: string, statusCode: string, grossAmount: string): string {
  return crypto.createHash('sha512')
    .update(`${orderId}${statusCode}${grossAmount}${SERVER_KEY}`)
    .digest('hex');
}

// Helper: create full test data directly in DB (seller, buyer, product, order w/ MIDTRANS payment)
async function createL02TestFixture(runNum: number) {
  const sellerEmail = `20215120${runNum}@std.umk.ac.id`;
  const buyerEmail = `20215130${runNum}@std.umk.ac.id`;

  // Clean up previous data if exists
  await prisma.notification.deleteMany({ where: { user: { email: { in: [sellerEmail, buyerEmail] } } } });
  await prisma.orderItem.deleteMany({ where: { order: { buyer: { email: buyerEmail } } } });
  await prisma.payment.deleteMany({ where: { order: { buyer: { email: buyerEmail } } } });
  await prisma.orderFulfillment.deleteMany({ where: { order: { buyer: { email: buyerEmail } } } });
  await prisma.order.deleteMany({ where: { buyer: { email: buyerEmail } } });
  await prisma.product.deleteMany({ where: { seller: { email: sellerEmail } } });
  await prisma.user.deleteMany({ where: { email: { in: [sellerEmail, buyerEmail] } } });

  // Create seller
  const seller = await prisma.user.create({
    data: {
      name: `Seller L02 Run${runNum}`,
      email: sellerEmail,
      password_hash: '$2b$10$dummyhashnotusedfortestlogin000000000000000000000',
      phone_number: `08112345${runNum}01`,
      role: 'USER',
      status: 'ACTIVE',
    }
  });

  // Create buyer
  const buyer = await prisma.user.create({
    data: {
      name: `Buyer L02 Run${runNum}`,
      email: buyerEmail,
      password_hash: '$2b$10$dummyhashnotusedfortestlogin000000000000000000000',
      phone_number: `08112345${runNum}02`,
      role: 'USER',
      status: 'ACTIVE',
    }
  });

  // Create category (reuse if exists)
  let category = await prisma.category.findFirst({ where: { name: 'Test Category L02' } });
  if (!category) {
    category = await prisma.category.create({ data: { name: 'Test Category L02' } });
  }

  // Create product with known stock
  const INITIAL_STOCK = 10;
  const PRICE = 50000;
  const product = await prisma.product.create({
    data: {
      title: `L02 Test Product Run${runNum}`,
      description: 'Test product for webhook testing',
      price: PRICE,
      stock: INITIAL_STOCK,
      seller_id: seller.id,
      category_id: category.id,
      status: 'PUBLISHED',
    }
  });

  // Create order with MIDTRANS payment
  const ORDER_QTY = 2;
  const grossAmount = PRICE * ORDER_QTY + 2000; // 102000
  const orderCode = `ORD-TEST-L02-${runNum}-${Date.now()}`;

  const order = await prisma.order.create({
    data: {
      buyer_id: buyer.id,
      order_code: orderCode,
      status: 'PENDING_PAYMENT',
      total_amount: grossAmount,
    }
  });

  // Create fulfillment
  const fulfillment = await prisma.orderFulfillment.create({
    data: {
      order_id: order.id,
      seller_id: seller.id,
      status: 'AGREED',
      handover_location: 'Gedung A UMK',
      handover_date: new Date(),
      handover_time: '10:00',
    }
  });

  // Create order items
  await prisma.orderItem.create({
    data: {
      order_id: order.id,
      product_id: product.id,
      product_name_snapshot: product.title,
      price_snapshot: PRICE,
      quantity: ORDER_QTY,
      subtotal: PRICE * ORDER_QTY,
      fulfillment_id: fulfillment.id,
    }
  });

  // Create payment
  await prisma.payment.create({
    data: {
      order_id: order.id,
      payment_method: 'MIDTRANS',
      amount: grossAmount,
      status: 'PENDING',
    }
  });

  return { seller, buyer, product, order, orderCode, grossAmount, INITIAL_STOCK, ORDER_QTY };
}

export async function runL02(): Promise<{ pass: boolean; details: string }> {
  console.log('\n======================================================');
  console.log('STARTING RETEST: L02 (Webhook Midtrans + Stock Decrement)');
  console.log('======================================================\n');

  // SAFETY ASSERTION: Verify testing database connection before execution
  const activeDbUrl = process.env.DATABASE_URL || '';
  if (!activeDbUrl.includes('zojvqbaylpxqjygeqnpj') || activeDbUrl.includes('jlgmvjndbdatotbyvixs')) {
    console.error('CRITICAL SAFETY ERROR: DATABASE_URL does NOT point to Supabase testing project (zojvqbaylpxqjygeqnpj)!');
    console.error('Aborting immediately to protect Production database.');
    process.exit(1);
  }
  console.log('[SAFETY CHECK PASSED] Confirmed connected to isolated testing DB: umk-marketplace-testing (zojvqbaylpxqjygeqnpj)\n');

  initLog('L02', 'Webhook Midtrans settlement -> stok berkurang');
  let allPass = true;

  await startTestServer();

  for (let run = 1; run <= 3; run++) {
    appendLog('L02', `\n${'='.repeat(60)}\n>>> RUN ${run}/3 <<<\n${'='.repeat(60)}`);

    const fixture = await createL02TestFixture(run);
    const { orderCode, grossAmount, INITIAL_STOCK, ORDER_QTY, product } = fixture;

    // ----- SUB-TEST A1: Valid settlement webhook -> order PAID, stock decremented -----
    {
      appendLog('L02', `\n--- SUB-TEST A1: Valid Settlement Webhook ---`);

      const stockBefore = (await prisma.product.findUnique({ where: { id: product.id } }))!.stock;
      appendLog('L02', `[DB STATE BEFORE] Product stock: ${stockBefore}`);

      const validSig = makeSignature(orderCode, '200', grossAmount.toFixed(2));
      const webhookPayload = {
        order_id: orderCode,
        status_code: '200',
        gross_amount: grossAmount.toFixed(2),
        signature_key: validSig,
        transaction_status: 'settlement',
      };

      appendLog('L02', `--- [HTTP REQUEST] POST /api/payments/midtrans/notification ---`);
      appendLog('L02', `Payload: ${JSON.stringify({ ...webhookPayload, signature_key: '[REDACTED_SHA512]' }, null, 2)}`);

      const res = await api('/payments/midtrans/notification', 'POST', webhookPayload);
      appendLog('L02', `--- [HTTP RESPONSE] Status: ${res.status} ---`);
      appendLog('L02', `Response Body: ${JSON.stringify(res.data, null, 2)}`);

      // Check DB state
      const orderAfter = await prisma.order.findUnique({ where: { id: fixture.order.id }, include: { payment: true } });
      const stockAfter = (await prisma.product.findUnique({ where: { id: product.id } }))!.stock;
      const expectedStock = INITIAL_STOCK - ORDER_QTY;

      appendLog('L02', `[DB STATE AFTER] Order status: ${orderAfter?.status}, Payment status: ${orderAfter?.payment?.status}, Product stock: ${stockAfter}, Expected stock: ${expectedStock}`);

      const a1Pass = res.status === 200 &&
        res.data.success === true &&
        orderAfter?.status === 'READY_FOR_HANDOVER' &&
        orderAfter?.payment?.status === 'PAID' &&
        stockAfter === expectedStock;

      appendLog('L02', `[RESULT A1] ${a1Pass ? 'PASS' : 'FAIL'}`);
      console.log(`[L02] Run ${run} Sub-A1 (Valid Settlement): ${a1Pass ? 'PASS' : 'FAIL'}`);
      if (!a1Pass) allPass = false;
    }

    // ----- SUB-TEST A2: Duplicate webhook (idempotency) -> stock unchanged -----
    {
      appendLog('L02', `\n--- SUB-TEST A2: Duplicate Webhook (Idempotency) ---`);

      const stockBefore = (await prisma.product.findUnique({ where: { id: product.id } }))!.stock;
      appendLog('L02', `[DB STATE BEFORE] Product stock: ${stockBefore}`);

      const validSig = makeSignature(orderCode, '200', grossAmount.toFixed(2));
      const webhookPayload = {
        order_id: orderCode,
        status_code: '200',
        gross_amount: grossAmount.toFixed(2),
        signature_key: validSig,
        transaction_status: 'settlement',
      };

      appendLog('L02', `--- [HTTP REQUEST] POST /api/payments/midtrans/notification (DUPLICATE) ---`);
      const res = await api('/payments/midtrans/notification', 'POST', webhookPayload);
      appendLog('L02', `--- [HTTP RESPONSE] Status: ${res.status} ---`);
      appendLog('L02', `Response Body: ${JSON.stringify(res.data, null, 2)}`);

      const stockAfter = (await prisma.product.findUnique({ where: { id: product.id } }))!.stock;
      appendLog('L02', `[DB STATE AFTER] Product stock: ${stockAfter} (expected same as before: ${stockBefore})`);

      const a2Pass = res.status === 200 && stockAfter === stockBefore;

      appendLog('L02', `[RESULT A2] ${a2Pass ? 'PASS' : 'FAIL'} - Stock unchanged (idempotent): ${stockAfter === stockBefore}`);
      console.log(`[L02] Run ${run} Sub-A2 (Idempotency): ${a2Pass ? 'PASS' : 'FAIL'}`);
      if (!a2Pass) allPass = false;
    }

    // ----- SUB-TEST A3: Invalid signature -> rejected, stock unchanged -----
    {
      appendLog('L02', `\n--- SUB-TEST A3: Invalid Signature Webhook ---`);

      // Create a new fresh order for this sub-test
      const fixture2 = await createL02TestFixture(run + 10);
      const stockBefore = (await prisma.product.findUnique({ where: { id: fixture2.product.id } }))!.stock;
      appendLog('L02', `[DB STATE BEFORE] Product stock (new order): ${stockBefore}`);

      const badSig = 'invalid_signature_0000000000000000000000000000000000';
      const webhookPayload = {
        order_id: fixture2.orderCode,
        status_code: '200',
        gross_amount: fixture2.grossAmount.toFixed(2),
        signature_key: badSig,
        transaction_status: 'settlement',
      };

      appendLog('L02', `--- [HTTP REQUEST] POST /api/payments/midtrans/notification (BAD SIGNATURE) ---`);
      appendLog('L02', `Payload: ${JSON.stringify({ ...webhookPayload, signature_key: '[INVALID_SIG]' }, null, 2)}`);

      const res = await api('/payments/midtrans/notification', 'POST', webhookPayload);
      appendLog('L02', `--- [HTTP RESPONSE] Status: ${res.status} ---`);
      appendLog('L02', `Response Body: ${JSON.stringify(res.data, null, 2)}`);

      const orderAfter = await prisma.order.findUnique({ where: { id: fixture2.order.id }, include: { payment: true } });
      const stockAfter = (await prisma.product.findUnique({ where: { id: fixture2.product.id } }))!.stock;

      appendLog('L02', `[DB STATE AFTER] Order status: ${orderAfter?.status}, Payment status: ${orderAfter?.payment?.status}, Product stock: ${stockAfter}`);

      // Controller catches error but returns 200 to Midtrans (see payment.controller.ts line 26)
      // The important assertion: order/payment NOT changed, stock NOT changed
      const a3Pass = orderAfter?.status === 'PENDING_PAYMENT' &&
        orderAfter?.payment?.status === 'PENDING' &&
        stockAfter === stockBefore;

      appendLog('L02', `[RESULT A3] ${a3Pass ? 'PASS' : 'FAIL'} - Invalid sig rejected, DB unchanged`);
      console.log(`[L02] Run ${run} Sub-A3 (Invalid Signature): ${a3Pass ? 'PASS' : 'FAIL'}`);
      if (!a3Pass) allPass = false;
    }
  }

  await stopTestServer();
  await prisma.$disconnect();

  console.log(`\n======================================================`);
  console.log(`COMPLETED RETEST: L02 - Overall: ${allPass ? 'PASS' : 'FAIL'}`);
  console.log(`======================================================\n`);

  return { pass: allPass, details: `L02 Part A (automated webhook): ${allPass ? 'PASS' : 'FAIL'}` };
}

if (require.main === module) {
  runL02().catch(err => {
    console.error('Fatal error during L02 retest:', err);
    process.exit(1);
  });
}
