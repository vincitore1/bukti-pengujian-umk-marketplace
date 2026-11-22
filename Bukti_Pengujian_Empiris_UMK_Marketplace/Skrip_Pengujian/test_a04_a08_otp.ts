import fs from 'fs';
import path from 'path';
import { startTestServer, stopTestServer, api, prisma, redactSecrets } from './harness/test_app';
import { clearCapturedEmails, getCapturedEmailsFor, getLatestOtpFor } from './harness/mock_mailer';

const EVIDENCE_DIR = path.resolve(__dirname, '../../docs/retest-blocked/evidence');

// Target test student account (User's institutional email)
const TEST_EMAIL = '202351149@std.umk.ac.id';
const TEST_NIM = '202351149';

interface TestCaseResult {
  id: string;
  name: string;
  runs: Array<{
    run: number;
    pass: boolean;
    details: string;
    log: string;
  }>;
  overallStatus: 'PASS' | 'FAIL';
}

function appendLog(caseId: string, text: string) {
  if (!fs.existsSync(EVIDENCE_DIR)) {
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  }
  const filePath = path.join(EVIDENCE_DIR, `${caseId}.log`);
  fs.appendFileSync(filePath, redactSecrets(text) + '\n', 'utf8');
}

function initLog(caseId: string, title: string, businessRule: string) {
  if (!fs.existsSync(EVIDENCE_DIR)) {
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  }
  const filePath = path.join(EVIDENCE_DIR, `${caseId}.log`);
  const header = [
    `================================================================================`,
    `TEST CASE EVIDENCE LOG: ${caseId} - ${title}`,
    `Business Rule: ${businessRule}`,
    `Target: API / HTTP Level Validation`,
    `Test Account: ${TEST_EMAIL}`,
    `Database: Supabase umk-marketplace-testing (isolated testing DB: zojvqbaylpxqjygeqnpj)`,
    `Generated At: ${new Date().toISOString()}`,
    `================================================================================\n`
  ].join('\n');
  fs.writeFileSync(filePath, redactSecrets(header), 'utf8');
}

async function cleanupTestUser(email: string) {
  await prisma.user.deleteMany({ where: { email } });
  await prisma.otp.deleteMany({ where: { email } });
  clearCapturedEmails();
}

export async function runA04toA08(): Promise<Record<string, TestCaseResult>> {
  const results: Record<string, TestCaseResult> = {};

  console.log('\n======================================================');
  console.log('STARTING RETEST: A04 - A08 (OTP Authentication Suite)');
  console.log(`Target Email: ${TEST_EMAIL}`);
  console.log('Execution Mode: Sequential (Isolated Clean State per Run)');
  console.log('======================================================\n');

  // SAFETY ASSERTION: Verify testing database connection before execution
  const activeDbUrl = process.env.DATABASE_URL || '';
  if (!activeDbUrl.includes('zojvqbaylpxqjygeqnpj') || activeDbUrl.includes('jlgmvjndbdatotbyvixs')) {
    console.error('CRITICAL SAFETY ERROR: DATABASE_URL does NOT point to Supabase testing project (zojvqbaylpxqjygeqnpj)!');
    console.error('Aborting immediately to protect Production database.');
    process.exit(1);
  }
  console.log('[SAFETY CHECK PASSED] Confirmed connected to isolated testing DB: umk-marketplace-testing (zojvqbaylpxqjygeqnpj)\n');

  await startTestServer();

  // Helper to register fresh user
  async function registerUser(email: string, nim: string, caseLogId: string) {
    const registerBody = {
      name: `Mahasiswa Test ${nim}`,
      email,
      phone_number: `081234567${nim.slice(-3)}`,
      password: 'Password123!',
      password_confirmation: 'Password123!'
    };

    appendLog(caseLogId, `\n--- [HTTP REQUEST] POST /api/auth/register ---`);
    appendLog(caseLogId, `Timestamp: ${new Date().toISOString()}`);
    appendLog(caseLogId, `Payload: ${JSON.stringify(registerBody, null, 2)}`);

    const res = await api('/auth/register', 'POST', registerBody);

    appendLog(caseLogId, `--- [HTTP RESPONSE] Status: ${res.status} ---`);
    appendLog(caseLogId, `Timestamp: ${new Date().toISOString()}`);
    appendLog(caseLogId, `Response Body: ${JSON.stringify(res.data, null, 2)}`);

    return res;
  }

  // -------------------------------------------------------------
  // A04: Registrasi dengan OTP valid -> Akun ACTIVE
  // -------------------------------------------------------------
  {
    const id = 'A04';
    initLog(id, 'Verifikasi OTP valid', 'BR1: Autentikasi Mahasiswa & Verifikasi Email');
    results[id] = { id, name: 'Verifikasi OTP valid', runs: [], overallStatus: 'PASS' };

    for (let run = 1; run <= 3; run++) {
      console.log(`\n>>> [${id}] RUN ${run}/3 - User: ${TEST_EMAIL} <<<`);
      appendLog(id, `\n>>> RUN ${run}/3 - User: ${TEST_EMAIL} <<<`);

      // 1. Fresh independent state cleanup
      await cleanupTestUser(TEST_EMAIL);

      // 2. Register
      const regRes = await registerUser(TEST_EMAIL, TEST_NIM, id);
      const userBefore = await prisma.user.findUnique({ where: { email: TEST_EMAIL } });
      const otpRecordBefore = await prisma.otp.findUnique({ where: { email: TEST_EMAIL } });

      appendLog(id, `[DB STATE BEFORE VERIFY] User Status: ${userBefore?.status}, OTP Exists: ${!!otpRecordBefore}, Attempts: ${otpRecordBefore?.attempts}`);

      // 3. Capture OTP
      const capturedOtp = getLatestOtpFor(TEST_EMAIL);
      appendLog(id, `[CAPTURED OTP STATE] OTP available for verification: ${Boolean(capturedOtp)}`);

      if (!capturedOtp) {
        throw new Error(`Failed to capture OTP for ${TEST_EMAIL}`);
      }

      // 4. Verify OTP
      const verifyBody = { email: TEST_EMAIL, otp: capturedOtp };
      appendLog(id, `\n--- [HTTP REQUEST] POST /api/auth/verify-otp ---`);
      appendLog(id, `Timestamp: ${new Date().toISOString()}`);
      appendLog(id, `Payload: ${JSON.stringify(verifyBody, null, 2)}`);

      const verifyRes = await api('/auth/verify-otp', 'POST', verifyBody);
      appendLog(id, `--- [HTTP RESPONSE] Status: ${verifyRes.status} ---`);
      appendLog(id, `Timestamp: ${new Date().toISOString()}`);
      appendLog(id, `Response Body: ${JSON.stringify(verifyRes.data, null, 2)}`);

      // 5. DB State After
      const userAfter = await prisma.user.findUnique({ where: { email: TEST_EMAIL } });
      const otpRecordAfter = await prisma.otp.findUnique({ where: { email: TEST_EMAIL } });
      appendLog(id, `[DB STATE AFTER VERIFY] User Status: ${userAfter?.status}, OTP Exists: ${!!otpRecordAfter}`);

      const pass = verifyRes.status === 200 &&
        verifyRes.data.success === true &&
        userAfter?.status === 'ACTIVE' &&
        otpRecordAfter === null;

      results[id].runs.push({
        run,
        pass,
        details: `HTTP ${verifyRes.status}, User status: ${userAfter?.status}, OTP deleted: ${otpRecordAfter === null}`,
        log: `Run ${run}: ${pass ? 'PASS' : 'FAIL'}`
      });

      if (!pass) results[id].overallStatus = 'FAIL';
      console.log(`[${id}] Run ${run}/3: ${pass ? 'PASS' : 'FAIL'} (User Status: ${userAfter?.status})`);

      // 6. Cleanup after run to prepare clean slate for next iteration
      await cleanupTestUser(TEST_EMAIL);
    }
  }

  // -------------------------------------------------------------
  // A05: Registrasi dengan OTP salah -> Ditolak (HTTP 400, attempt++)
  // -------------------------------------------------------------
  {
    const id = 'A05';
    initLog(id, 'Verifikasi OTP salah', 'BR1: Autentikasi Mahasiswa & Verifikasi Email');
    results[id] = { id, name: 'Verifikasi OTP salah', runs: [], overallStatus: 'PASS' };

    for (let run = 1; run <= 3; run++) {
      console.log(`\n>>> [${id}] RUN ${run}/3 - User: ${TEST_EMAIL} <<<`);
      appendLog(id, `\n>>> RUN ${run}/3 - User: ${TEST_EMAIL} <<<`);

      // 1. Fresh independent state cleanup
      await cleanupTestUser(TEST_EMAIL);

      // 2. Register
      await registerUser(TEST_EMAIL, TEST_NIM, id);
      const userBefore = await prisma.user.findUnique({ where: { email: TEST_EMAIL } });
      const otpRecordBefore = await prisma.otp.findUnique({ where: { email: TEST_EMAIL } });
      appendLog(id, `[DB STATE BEFORE VERIFY] User Status: ${userBefore?.status}, Attempts: ${otpRecordBefore?.attempts}`);

      // 3. Submit wrong OTP
      const wrongOtp = '999999';
      const verifyBody = { email: TEST_EMAIL, otp: wrongOtp };
      appendLog(id, `\n--- [HTTP REQUEST] POST /api/auth/verify-otp (WRONG OTP) ---`);
      appendLog(id, `Timestamp: ${new Date().toISOString()}`);
      appendLog(id, `Payload: ${JSON.stringify(verifyBody, null, 2)}`);

      const verifyRes = await api('/auth/verify-otp', 'POST', verifyBody);
      appendLog(id, `--- [HTTP RESPONSE] Status: ${verifyRes.status} ---`);
      appendLog(id, `Timestamp: ${new Date().toISOString()}`);
      appendLog(id, `Response Body: ${JSON.stringify(verifyRes.data, null, 2)}`);

      // 4. DB State After
      const userAfter = await prisma.user.findUnique({ where: { email: TEST_EMAIL } });
      const otpRecordAfter = await prisma.otp.findUnique({ where: { email: TEST_EMAIL } });
      appendLog(id, `[DB STATE AFTER VERIFY] User Status: ${userAfter?.status}, Attempts: ${otpRecordAfter?.attempts}`);

      const pass = verifyRes.status === 400 &&
        verifyRes.data.success === false &&
        userAfter?.status === 'PENDING_VERIFICATION' &&
        otpRecordAfter !== null &&
        otpRecordAfter.attempts === (otpRecordBefore?.attempts || 0) + 1;

      results[id].runs.push({
        run,
        pass,
        details: `HTTP ${verifyRes.status}, Message: "${verifyRes.data.message}", Attempts: ${otpRecordAfter?.attempts}, User status: ${userAfter?.status}`,
        log: `Run ${run}: ${pass ? 'PASS' : 'FAIL'}`
      });

      if (!pass) results[id].overallStatus = 'FAIL';
      console.log(`[${id}] Run ${run}/3: ${pass ? 'PASS' : 'FAIL'} (Attempts: ${otpRecordAfter?.attempts})`);

      // 5. Cleanup after run
      await cleanupTestUser(TEST_EMAIL);
    }
  }

  // -------------------------------------------------------------
  // A06: Verifikasi OTP kedaluwarsa -> Ditolak (HTTP 400, expired)
  // -------------------------------------------------------------
  {
    const id = 'A06';
    initLog(id, 'Verifikasi OTP kedaluwarsa', 'BR1: Autentikasi Mahasiswa & Verifikasi Email');
    results[id] = { id, name: 'Verifikasi OTP kedaluwarsa', runs: [], overallStatus: 'PASS' };

    for (let run = 1; run <= 3; run++) {
      console.log(`\n>>> [${id}] RUN ${run}/3 - User: ${TEST_EMAIL} <<<`);
      appendLog(id, `\n>>> RUN ${run}/3 - User: ${TEST_EMAIL} <<<`);

      // 1. Fresh independent state cleanup
      await cleanupTestUser(TEST_EMAIL);

      // 2. Register
      await registerUser(TEST_EMAIL, TEST_NIM, id);
      const capturedOtp = getLatestOtpFor(TEST_EMAIL);

      // 3. Force expires_at to 60 seconds in the past to simulate expiration
      const expiredDate = new Date(Date.now() - 60000);
      await prisma.otp.update({
        where: { email: TEST_EMAIL },
        data: { expires_at: expiredDate }
      });
      appendLog(id, `[DB OVERRIDE SETUP] Forced expires_at to past: ${expiredDate.toISOString()}`);

      const userBefore = await prisma.user.findUnique({ where: { email: TEST_EMAIL } });
      appendLog(id, `[DB STATE BEFORE VERIFY] User Status: ${userBefore?.status}`);

      // 4. Submit OTP
      const verifyBody = { email: TEST_EMAIL, otp: capturedOtp };
      appendLog(id, `\n--- [HTTP REQUEST] POST /api/auth/verify-otp (EXPIRED OTP) ---`);
      appendLog(id, `Timestamp: ${new Date().toISOString()}`);
      appendLog(id, `Payload: ${JSON.stringify(verifyBody, null, 2)}`);

      const verifyRes = await api('/auth/verify-otp', 'POST', verifyBody);
      appendLog(id, `--- [HTTP RESPONSE] Status: ${verifyRes.status} ---`);
      appendLog(id, `Timestamp: ${new Date().toISOString()}`);
      appendLog(id, `Response Body: ${JSON.stringify(verifyRes.data, null, 2)}`);

      // 5. DB State After
      const userAfter = await prisma.user.findUnique({ where: { email: TEST_EMAIL } });
      appendLog(id, `[DB STATE AFTER VERIFY] User Status: ${userAfter?.status}`);

      const isExpiredMessage = verifyRes.data.message && verifyRes.data.message.toLowerCase().includes('expired');
      const pass = verifyRes.status === 400 &&
        verifyRes.data.success === false &&
        isExpiredMessage &&
        userAfter?.status === 'PENDING_VERIFICATION';

      results[id].runs.push({
        run,
        pass,
        details: `HTTP ${verifyRes.status}, Message: "${verifyRes.data.message}", User status: ${userAfter?.status}`,
        log: `Run ${run}: ${pass ? 'PASS' : 'FAIL'}`
      });

      if (!pass) results[id].overallStatus = 'FAIL';
      console.log(`[${id}] Run ${run}/3: ${pass ? 'PASS' : 'FAIL'} (Expired Message Verified)`);

      // 6. Cleanup after run
      await cleanupTestUser(TEST_EMAIL);
    }
  }

  // -------------------------------------------------------------
  // A07: Kirim ulang OTP setelah jeda (>60 detik) -> OTP baru terkirim & verifikasi berhasil
  // -------------------------------------------------------------
  {
    const id = 'A07';
    initLog(id, 'Kirim ulang OTP setelah cooldown', 'BR1: Autentikasi Mahasiswa & Verifikasi Email');
    results[id] = { id, name: 'Kirim ulang OTP setelah cooldown', runs: [], overallStatus: 'PASS' };

    for (let run = 1; run <= 3; run++) {
      console.log(`\n>>> [${id}] RUN ${run}/3 - User: ${TEST_EMAIL} <<<`);
      appendLog(id, `\n>>> RUN ${run}/3 - User: ${TEST_EMAIL} <<<`);

      // 1. Fresh independent state cleanup
      await cleanupTestUser(TEST_EMAIL);

      // 2. Register initial
      await registerUser(TEST_EMAIL, TEST_NIM, id);
      const initialOtp = getLatestOtpFor(TEST_EMAIL);
      appendLog(id, `[INITIAL OTP] First OTP Captured: ${Boolean(initialOtp)}, Total Emails: ${getCapturedEmailsFor(TEST_EMAIL).length}`);

      // 3. NATURALLY WAIT FOR COOLDOWN EXPIRY (>60s)
      console.log(`[${id} Run ${run}/3] Menunggu 62 detik agar masa cooldown 60 detik kedaluwarsa secara alami...`);
      appendLog(id, `[NATURAL COOLDOWN WAIT] Starting 62-second wait at ${new Date().toISOString()}`);

      for (let sec = 62; sec > 0; sec -= 10) {
        process.stdout.write(`  Waktu tunggu tersisa: ${sec}s...\r`);
        await new Promise(r => setTimeout(r, Math.min(sec, 10) * 1000));
      }
      console.log(`  Cooldown selesai (>60 detik berlalu). Mengirim permintaan resend OTP...`);
      appendLog(id, `[NATURAL COOLDOWN WAIT FINISHED] Wait ended at ${new Date().toISOString()}`);

      // 4. Request Resend OTP
      const resendBody = { email: TEST_EMAIL };
      appendLog(id, `\n--- [HTTP REQUEST] POST /api/auth/resend-otp ---`);
      appendLog(id, `Timestamp: ${new Date().toISOString()}`);
      appendLog(id, `Payload: ${JSON.stringify(resendBody, null, 2)}`);

      const resendRes = await api('/auth/resend-otp', 'POST', resendBody);
      appendLog(id, `--- [HTTP RESPONSE] Status: ${resendRes.status} ---`);
      appendLog(id, `Timestamp: ${new Date().toISOString()}`);
      appendLog(id, `Response Body: ${JSON.stringify(resendRes.data, null, 2)}`);

      const emailList = getCapturedEmailsFor(TEST_EMAIL);
      appendLog(id, `[MAILER STATUS] Total Emails Captured: ${emailList.length}`);

      const newOtp = getLatestOtpFor(TEST_EMAIL);
      appendLog(id, `[NEW OTP STATE] Second OTP Captured: ${Boolean(newOtp)}`);

      // 5. Verify using NEW OTP
      const verifyBody = { email: TEST_EMAIL, otp: newOtp };
      appendLog(id, `\n--- [HTTP REQUEST] POST /api/auth/verify-otp (with newly resent OTP) ---`);
      appendLog(id, `Timestamp: ${new Date().toISOString()}`);
      appendLog(id, `Payload: ${JSON.stringify(verifyBody, null, 2)}`);

      const verifyRes = await api('/auth/verify-otp', 'POST', verifyBody);
      appendLog(id, `--- [HTTP RESPONSE] Status: ${verifyRes.status} ---`);
      appendLog(id, `Timestamp: ${new Date().toISOString()}`);
      appendLog(id, `Response Body: ${JSON.stringify(verifyRes.data, null, 2)}`);

      // 6. DB State After
      const userAfter = await prisma.user.findUnique({ where: { email: TEST_EMAIL } });
      const otpAfter = await prisma.otp.findUnique({ where: { email: TEST_EMAIL } });
      appendLog(id, `[DB STATE AFTER VERIFY] User Status: ${userAfter?.status}, OTP Exists: ${!!otpAfter}`);

      const pass = resendRes.status === 200 &&
        emailList.length >= 2 &&
        verifyRes.status === 200 &&
        userAfter?.status === 'ACTIVE' &&
        otpAfter === null;

      results[id].runs.push({
        run,
        pass,
        details: `Resend HTTP ${resendRes.status}, Total emails: ${emailList.length}, Verify HTTP ${verifyRes.status}, User status: ${userAfter?.status}`,
        log: `Run ${run}: ${pass ? 'PASS' : 'FAIL'}`
      });

      if (!pass) results[id].overallStatus = 'FAIL';
      console.log(`[${id}] Run ${run}/3: ${pass ? 'PASS' : 'FAIL'} (Resent OTP Verified & Account ACTIVE)`);

      // 7. Cleanup after run
      await cleanupTestUser(TEST_EMAIL);
    }
  }

  // -------------------------------------------------------------
  // A08: Kirim ulang OTP sebelum cooldown (<60 detik) -> Ditolak
  // -------------------------------------------------------------
  {
    const id = 'A08';
    initLog(id, 'Kirim ulang OTP dalam masa cooldown', 'BR1: Autentikasi Mahasiswa & Verifikasi Email');
    results[id] = { id, name: 'Kirim ulang OTP dalam masa cooldown', runs: [], overallStatus: 'PASS' };

    for (let run = 1; run <= 3; run++) {
      console.log(`\n>>> [${id}] RUN ${run}/3 - User: ${TEST_EMAIL} <<<`);
      appendLog(id, `\n>>> RUN ${run}/3 - User: ${TEST_EMAIL} <<<`);

      // 1. Fresh independent state cleanup
      await cleanupTestUser(TEST_EMAIL);

      // 2. Register initial
      await registerUser(TEST_EMAIL, TEST_NIM, id);
      const emailListBefore = getCapturedEmailsFor(TEST_EMAIL);
      appendLog(id, `[INITIAL STATE] Captured emails count: ${emailListBefore.length}`);

      // 3. Immediately call resend-otp (<1s elapsed, cooldown still active)
      const resendBody = { email: TEST_EMAIL };
      appendLog(id, `\n--- [HTTP REQUEST] POST /api/auth/resend-otp (IMMEDIATE RESEND) ---`);
      appendLog(id, `Timestamp: ${new Date().toISOString()}`);
      appendLog(id, `Payload: ${JSON.stringify(resendBody, null, 2)}`);

      const resendRes = await api('/auth/resend-otp', 'POST', resendBody);
      appendLog(id, `--- [HTTP RESPONSE] Status: ${resendRes.status} ---`);
      appendLog(id, `Timestamp: ${new Date().toISOString()}`);
      appendLog(id, `Response Body: ${JSON.stringify(resendRes.data, null, 2)}`);

      const emailListAfter = getCapturedEmailsFor(TEST_EMAIL);
      appendLog(id, `[MAILER STATUS] Captured emails count after immediate resend: ${emailListAfter.length}`);

      const userAfter = await prisma.user.findUnique({ where: { email: TEST_EMAIL } });
      appendLog(id, `[DB STATE AFTER] User Status: ${userAfter?.status}`);

      const hasCooldownMessage = resendRes.data.message && resendRes.data.message.toLowerCase().includes('wait');
      const pass = resendRes.status === 400 &&
        resendRes.data.success === false &&
        hasCooldownMessage &&
        emailListAfter.length === 1 &&
        userAfter?.status === 'PENDING_VERIFICATION';

      results[id].runs.push({
        run,
        pass,
        details: `HTTP ${resendRes.status}, Message: "${resendRes.data.message}", Emails sent: ${emailListAfter.length}`,
        log: `Run ${run}: ${pass ? 'PASS' : 'FAIL'}`
      });

      if (!pass) results[id].overallStatus = 'FAIL';
      console.log(`[${id}] Run ${run}/3: ${pass ? 'PASS' : 'FAIL'} (Cooldown Rejection Verified)`);

      // 4. Cleanup after run
      await cleanupTestUser(TEST_EMAIL);
    }
  }

  await stopTestServer();
  await prisma.$disconnect();

  console.log('\n======================================================');
  console.log('COMPLETED RETEST: A04 - A08 (15 Executions Total)');
  console.log('======================================================\n');

  console.log('-----------------------------------------------------------------------------');
  console.log('NO | KASUS UJI                           | RUN 1 | RUN 2 | RUN 3 | HASIL AKHIR');
  console.log('-----------------------------------------------------------------------------');
  for (const key of ['A04', 'A05', 'A06', 'A07', 'A08']) {
    const item = results[key];
    const r1 = item.runs[0]?.pass ? 'PASS' : 'FAIL';
    const r2 = item.runs[1]?.pass ? 'PASS' : 'FAIL';
    const r3 = item.runs[2]?.pass ? 'PASS' : 'FAIL';
    const finalStatus = item.overallStatus;
    console.log(`${item.id.padEnd(3)}| ${item.name.padEnd(36)}| ${r1.padEnd(6)}| ${r2.padEnd(6)}| ${r3.padEnd(6)}| ${finalStatus}`);
  }
  console.log('-----------------------------------------------------------------------------\n');

  return results;
}

if (require.main === module) {
  runA04toA08().catch(err => {
    console.error('Fatal error during A04-A08 retest:', err);
    process.exit(1);
  });
}
