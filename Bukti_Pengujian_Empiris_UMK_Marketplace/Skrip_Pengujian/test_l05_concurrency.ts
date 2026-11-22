import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { createRequire } from 'module';
const require2 = createRequire(path.resolve(__dirname, '../../backend/package.json'));
const jwt = require2('jsonwebtoken');
import { startTestServer, stopTestServer, api, prisma, redactSecrets } from './harness/test_app';

const EVIDENCE_DIR = path.resolve(__dirname, '../../docs/retest-blocked/evidence');
const JWT_SECRET = process.env.JWT_ACCESS_SECRET!;
const ITERATIONS = 50;

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
    `Business Rule: BR6: Konfirmasi serah terima serentak tidak boleh mengurangi stok ganda`,
    `Target: API / HTTP Level Concurrency Validation`,
    `Database: Supabase umk-marketplace-testing (isolated testing DB: zojvqbaylpxqjygeqnpj)`,
    `Iterations: ${ITERATIONS}`,
    `Generated At: ${new Date().toISOString()}`,
    `================================================================================\n`
  ].join('\n');
  fs.writeFileSync(filePath, redactSecrets(header), 'utf8');
}

function generateToken(userId: string, role: string): string {
  return jwt.sign({ userId, role }, JWT_SECRET, { expiresIn: '1d' });
}

export async function runL05(): Promise<{ pass: boolean; details: string }> {
  console.log('\n======================================================');
  console.log(`STARTING RETEST: L05 (Concurrency - ${ITERATIONS} iterations)`);
  console.log('======================================================\n');

  // SAFETY ASSERTION: Verify testing database connection before execution
  const activeDbUrl = process.env.DATABASE_URL || '';
  if (!activeDbUrl.includes('zojvqbaylpxqjygeqnpj') || activeDbUrl.includes('jlgmvjndbdatotbyvixs')) {
    console.error('CRITICAL SAFETY ERROR: DATABASE_URL does NOT point to Supabase testing project (zojvqbaylpxqjygeqnpj)!');
    console.error('Aborting immediately to protect Production database.');
    process.exit(1);
  }
  console.log('[SAFETY CHECK PASSED] Confirmed connected to isolated testing DB: umk-marketplace-testing (zojvqbaylpxqjygeqnpj)\n');

  initLog('L05', 'Konfirmasi serah terima serentak (race condition)');

  await startTestServer();

  let passCount = 0;
  let failCount = 0;
  const failures: string[] = [];

  // Create shared category
  let category = await prisma.category.findFirst({ where: { name: 'Test Category L05' } });
  if (!category) {
    category = await prisma.category.create({ data: { name: 'Test Category L05' } });
  }

  for (let i = 1; i <= ITERATIONS; i++) {
    const iterLabel = `Iter ${i}/${ITERATIONS}`;

    // --- Create fresh buyer, seller, product, COD order per iteration ---
    const sellerEmail = `20215200${String(i).padStart(3, '0')}@std.umk.ac.id`;
    const buyerEmail = `20215300${String(i).padStart(3, '0')}@std.umk.ac.id`;

    // Clean up
    await prisma.notification.deleteMany({ where: { user: { email: { in: [sellerEmail, buyerEmail] } } } });
    await prisma.orderItem.deleteMany({ where: { order: { buyer: { email: buyerEmail } } } });
    await prisma.payment.deleteMany({ where: { order: { buyer: { email: buyerEmail } } } });
    await prisma.orderFulfillment.deleteMany({ where: { order: { buyer: { email: buyerEmail } } } });
    await prisma.order.deleteMany({ where: { buyer: { email: buyerEmail } } });
    await prisma.product.deleteMany({ where: { seller: { email: sellerEmail } } });
    await prisma.user.deleteMany({ where: { email: { in: [sellerEmail, buyerEmail] } } });

    const seller = await prisma.user.create({
      data: {
        name: `Seller L05 Iter${i}`,
        email: sellerEmail,
        password_hash: '$2b$10$dummyhashnotusedfortestlogin000000000000000000000',
        phone_number: `0811000${String(i).padStart(4, '0')}`,
        role: 'USER',
        status: 'ACTIVE',
      }
    });

    const buyer = await prisma.user.create({
      data: {
        name: `Buyer L05 Iter${i}`,
        email: buyerEmail,
        password_hash: '$2b$10$dummyhashnotusedfortestlogin000000000000000000000',
        phone_number: `0812000${String(i).padStart(4, '0')}`,
        role: 'USER',
        status: 'ACTIVE',
      }
    });

    const INITIAL_STOCK = 5;
    const ORDER_QTY = 1;
    const PRICE = 25000;
    const grossAmount = PRICE * ORDER_QTY + 2000;

    const product = await prisma.product.create({
      data: {
        title: `L05 Concurrency Product Iter${i}`,
        description: 'Test product for concurrency testing',
        price: PRICE,
        stock: INITIAL_STOCK,
        seller_id: seller.id,
        category_id: category!.id,
        status: 'PUBLISHED',
      }
    });

    const orderCode = `ORD-L05-${i}-${Date.now()}`;

    // COD order: status is READY_FOR_COD
    const order = await prisma.order.create({
      data: {
        buyer_id: buyer.id,
        order_code: orderCode,
        status: 'READY_FOR_COD',
        total_amount: grossAmount,
      }
    });

    // Fulfillment in AGREED status (ready for confirm)
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

    // COD payment PENDING
    await prisma.payment.create({
      data: {
        order_id: order.id,
        payment_method: 'COD',
        amount: grossAmount,
        status: 'PENDING',
      }
    });

    // Generate JWTs
    const buyerToken = generateToken(buyer.id, 'USER');
    const sellerToken = generateToken(seller.id, 'USER');

    const stockBefore = (await prisma.product.findUnique({ where: { id: product.id } }))!.stock;

    // --- Fire both confirmations concurrently ---
    const confirmBuyerUrl = `/orders/${order.id}/fulfillments/${fulfillment.id}/confirm-buyer`;
    const confirmSellerUrl = `/orders/${order.id}/fulfillments/${fulfillment.id}/confirm-seller`;

    const [buyerRes, sellerRes] = await Promise.all([
      api(confirmBuyerUrl, 'POST', {}, buyerToken),
      api(confirmSellerUrl, 'POST', {}, sellerToken),
    ]);

    // --- Verify DB state ---
    const productAfter = await prisma.product.findUnique({ where: { id: product.id } });
    const orderAfter = await prisma.order.findUnique({ where: { id: order.id }, include: { payment: true, fulfillments: true } });
    const stockAfter = productAfter!.stock;
    const expectedStock = INITIAL_STOCK - ORDER_QTY;

    const fulfillmentAfter = orderAfter?.fulfillments?.[0];

    const stockCorrect = stockAfter === expectedStock;
    const fulfillmentCompleted = fulfillmentAfter?.status === 'COMPLETED';
    const orderCompleted = orderAfter?.status === 'COMPLETED';
    const paymentPaid = orderAfter?.payment?.status === 'PAID';

    const iterPass = stockCorrect && fulfillmentCompleted && orderCompleted && paymentPaid;

    if (iterPass) {
      passCount++;
    } else {
      failCount++;
      const failMsg = `[${iterLabel}] FAIL: stock=${stockAfter} (expected ${expectedStock}), fulfillment=${fulfillmentAfter?.status}, order=${orderAfter?.status}, payment=${orderAfter?.payment?.status}, buyerHTTP=${buyerRes.status}, sellerHTTP=${sellerRes.status}`;
      failures.push(failMsg);
    }

    // Log every 10th iteration + first + last + failures
    if (i === 1 || i === ITERATIONS || i % 10 === 0 || !iterPass) {
      appendLog('L05', `[${iterLabel}] ${iterPass ? 'PASS' : 'FAIL'} | stockBefore=${stockBefore}, stockAfter=${stockAfter}, expected=${expectedStock} | fulfillment=${fulfillmentAfter?.status} | order=${orderAfter?.status} | payment=${orderAfter?.payment?.status} | buyerHTTP=${buyerRes.status} sellerHTTP=${sellerRes.status}`);
    }

    if (i % 10 === 0) {
      console.log(`[L05] Progress: ${i}/${ITERATIONS} (pass=${passCount}, fail=${failCount})`);
    }
  }

  // Summary
  const overallPass = failCount === 0;
  const summary = [
    `\n${'='.repeat(60)}`,
    `SUMMARY: L05 Concurrency Test`,
    `${'='.repeat(60)}`,
    `Total iterations: ${ITERATIONS}`,
    `PASS: ${passCount}`,
    `FAIL: ${failCount}`,
    `Overall: ${overallPass ? 'PASS' : 'FAIL'}`,
    ``,
    ...(failures.length > 0 ? ['FAILURES:', ...failures] : ['No failures.']),
    `${'='.repeat(60)}`
  ].join('\n');

  appendLog('L05', summary);
  console.log(summary);

  await stopTestServer();
  await prisma.$disconnect();

  return { pass: overallPass, details: `L05: ${passCount}/${ITERATIONS} pass, ${failCount} fail` };
}

if (require.main === module) {
  runL05().catch(err => {
    console.error('Fatal error during L05 retest:', err);
    process.exit(1);
  });
}
