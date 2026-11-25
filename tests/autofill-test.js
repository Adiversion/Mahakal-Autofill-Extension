// Automated Playwright E2E test for Mahakal Darshan Autofill v1.1.0
// Verifies:
// 1. Multi-row Bhasma Aarti table + cascading async State->District dropdown + Gotra + file uploads + OTP/CAPTCHA untouched
// 2. Flat indexed form (no <tr> wrappers) + custom ARIA role="combobox" dropdown
// 3. FILL_MOBILE_ONLY on OTP screen (OTP stays untouched)
const fs = require('fs');
const path = require('path');
const { chromium } = require('D:\\ReturnPilot-GST-Assistant\\node_modules\\playwright');

const ROOT = path.resolve(__dirname, '..');
const CONTENT_SCRIPT = fs.readFileSync(path.join(ROOT, 'content', 'mahakal-autofill.js'), 'utf8');

const TINY_IMG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const MOCK_BHASMA_AARTI_HTML = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Shri Mahakaleshwar Bhasma Aarti Booking</title></head>
<body>
  <form id="bhasmaForm">
    <section>
      <label for="txtMobile">Mobile Number *</label>
      <input id="txtMobile" name="mobile_no" type="tel" />
      <label for="txtOtp">Enter OTP *</label>
      <input id="txtOtp" name="otp_code" type="text" value="" />
      <label for="txtEmail">Email ID</label>
      <input id="txtEmail" name="email_id" type="email" />
      <label for="txtGotra">Gotra</label>
      <input id="txtGotra" name="gotra" type="text" />
      <label for="txtAddress">Address</label>
      <input id="txtAddress" name="address" type="text" />
      <label for="ddlState">State</label>
      <select id="ddlState" name="state">
        <option value="">--Select--</option>
        <option value="MP">Madhya Pradesh</option>
        <option value="MH">Maharashtra</option>
      </select>
      <label for="ddlDistrict">District / City</label>
      <select id="ddlDistrict" name="district">
        <option value="">--Select State First--</option>
      </select>
      <label for="txtPin">Pin Code</label>
      <input id="txtPin" name="pincode" type="text" />
    </section>
    <table>
      <thead>
        <tr>
          <th>Devotee Name</th><th>DOB</th><th>Age</th><th>Gender</th>
          <th>ID Proof Type</th><th>Aadhaar / ID No</th><th>Devotee Photo</th><th>ID Proof Upload</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td><input name="devotee_name_0" type="text" /></td>
          <td><input name="dob_0" type="date" /></td>
          <td><input name="age_0" type="number" /></td>
          <td><select name="gender_0"><option value="">Select</option><option value="M">Male</option><option value="F">Female</option></select></td>
          <td><select name="id_type_0"><option value="">Select</option><option value="UID">Aadhar</option><option value="PP">Passport</option></select></td>
          <td><input name="id_no_0" type="text" /></td>
          <td><input name="devotee_photo_0" type="file" accept="image/*" /></td>
          <td><input name="id_proof_file_0" type="file" accept="image/*" /></td>
        </tr>
        <tr>
          <td><input name="devotee_name_1" type="text" /></td>
          <td><input name="dob_1" type="date" /></td>
          <td><input name="age_1" type="number" /></td>
          <td><select name="gender_1"><option value="">Select</option><option value="M">Male</option><option value="F">Female</option></select></td>
          <td><select name="id_type_1"><option value="">Select</option><option value="UID">Aadhar</option><option value="PP">Passport</option></select></td>
          <td><input name="id_no_1" type="text" /></td>
          <td><input name="devotee_photo_1" type="file" accept="image/*" /></td>
          <td><input name="id_proof_file_1" type="file" accept="image/*" /></td>
        </tr>
      </tbody>
    </table>
    <label for="txtCaptcha">Security Captcha *</label>
    <input id="txtCaptcha" name="captcha" type="text" value="" />
  </form>
  <script>
    // Simulate async AJAX District population 220ms after State changes
    document.getElementById('ddlState').addEventListener('change', (e) => {
      if (e.target.value === 'MP') {
        setTimeout(() => {
          document.getElementById('ddlDistrict').innerHTML =
            '<option value="">Select</option><option value="UJN">Ujjain</option><option value="IND">Indore</option>';
        }, 220);
      }
    });
  </script>
</body>
</html>`;

const MOCK_FLAT_COMBOBOX_HTML = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Shighra Darshan Flat Form</title></head>
<body>
  <form id="flatForm">
    <input id="name_0" name="devotee_name_0" placeholder="Devotee Name" />
    <input id="age_0" name="age_0" placeholder="Age" />
    <div id="gender_0" role="combobox" aria-label="Gender" tabindex="0">Select Gender</div>
    <ul id="gender_menu" role="listbox" style="display:none">
      <li role="option" data-v="Male">Male</li>
      <li role="option" data-v="Female">Female</li>
    </ul>

    <input id="name_1" name="devotee_name_1" placeholder="Devotee Name" />
    <input id="age_1" name="age_1" placeholder="Age" />
  </form>
  <script>
    const cb = document.getElementById('gender_0');
    const menu = document.getElementById('gender_menu');
    cb.addEventListener('click', () => { menu.style.display = 'block'; });
    menu.querySelectorAll('[role="option"]').forEach((opt) => {
      opt.addEventListener('click', () => {
        cb.textContent = opt.dataset.v;
        cb.dataset.selected = opt.dataset.v;
        menu.style.display = 'none';
      });
    });
  </script>
</body>
</html>`;

async function injectMockRuntime(page) {
  await page.evaluate(() => {
    window.__listeners = [];
    window.chrome = {
      runtime: {
        onMessage: { addListener: (fn) => window.__listeners.push(fn) },
        sendMessage: (_msg, cb) => cb && cb({ ok: true }),
      },
    };
  });
  await page.addScriptTag({ content: CONTENT_SCRIPT });
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const assert = (cond, msg, ctx) => {
      if (!cond) throw new Error('ASSERTION FAILED: ' + msg + (ctx ? ' | ' + JSON.stringify(ctx) : ''));
    };

    // TEST 1: Multi-row Bhasma Aarti + Cascading State->District AJAX + Gotra + Files + Safety
    const p1 = await browser.newPage();
    await p1.setContent(MOCK_BHASMA_AARTI_HTML);
    await injectMockRuntime(p1);

    const r1 = await p1.evaluate(async (img) => {
      return new Promise((resolve) => {
        window.__listeners[0](
          {
            action: 'FILL_BOOKING_FORM',
            bookingMode: 'bhasma_aarti',
            contact: {
              mobile: '9876543210',
              email: 'sharma@example.com',
              address: '12 Mahakal Marg',
              city: 'Ujjain',
              state: 'Madhya Pradesh',
              pincode: '456001',
              country: 'India',
              gotra: 'Kashyap',
            },
            devotees: [
              {
                name: 'Rajesh Kumar Sharma',
                dob: '1990-05-14',
                age: '36',
                gender: 'Male',
                idType: 'Aadhaar Card',
                idNumber: '234567890123',
                photo: { name: 'rajesh.jpg', type: 'image/png', dataUrl: img },
                idScan: { name: 'rajesh-aadhaar.jpg', type: 'image/png', dataUrl: img },
              },
              {
                name: 'Priya Sharma',
                dob: '1993-08-22',
                age: '33',
                gender: 'Female',
                idType: 'Passport',
                idNumber: 'P9876543',
                photo: { name: 'priya.jpg', type: 'image/png', dataUrl: img },
                idScan: null,
              },
            ],
          },
          {},
          resolve
        );
      });
    }, TINY_IMG);

    const v1 = await p1.evaluate(() => ({
      mobile: document.querySelector('#txtMobile').value,
      otp: document.querySelector('#txtOtp').value,
      captcha: document.querySelector('#txtCaptcha').value,
      email: document.querySelector('#txtEmail').value,
      gotra: document.querySelector('#txtGotra').value,
      state: document.querySelector('#ddlState').value,
      district: document.querySelector('#ddlDistrict').value,
      pin: document.querySelector('#txtPin').value,
      name0: document.querySelector('[name="devotee_name_0"]').value,
      gender0: document.querySelector('[name="gender_0"]').value,
      idType0: document.querySelector('[name="id_type_0"]').value,
      photoFiles0: document.querySelector('[name="devotee_photo_0"]').files.length,
      idFiles0: document.querySelector('[name="id_proof_file_0"]').files.length,
      name1: document.querySelector('[name="devotee_name_1"]').value,
      gender1: document.querySelector('[name="gender_1"]').value,
    }));

    assert(r1.ok && r1.filledDevotees === 2, 'Test 1 expected 2 devotees', r1);
    assert(v1.state === 'MP' && v1.district === 'UJN', 'Cascading State->District AJAX wait failed', v1);
    assert(v1.gotra === 'Kashyap' && v1.pin === '456001', 'Gotra/PIN failed', v1);
    assert(v1.photoFiles0 === 1 && v1.idFiles0 === 1, 'File attachments failed', v1);
    assert(v1.otp === '' && v1.captcha === '', 'OTP/CAPTCHA modified!', v1);
    console.log('TEST_1_PASS: Multi-row Bhasma Aarti + Cascading State->District + Gotra + Files + Safety');

    // TEST 2: Flat indexed multi-devotee inputs + Custom ARIA combobox dropdown
    const p2 = await browser.newPage();
    await p2.setContent(MOCK_FLAT_COMBOBOX_HTML);
    await injectMockRuntime(p2);

    const r2 = await p2.evaluate(async () => {
      return new Promise((resolve) => {
        window.__listeners[0](
          {
            action: 'FILL_BOOKING_FORM',
            devotees: [
              { name: 'Amit Verma', age: '41', gender: 'Male' },
              { name: 'Neha Verma', age: '38', gender: 'Female' },
            ],
          },
          {},
          resolve
        );
      });
    });
    const v2 = await p2.evaluate(() => ({
      n0: document.getElementById('name_0').value,
      a0: document.getElementById('age_0').value,
      g0: document.getElementById('gender_0').dataset.selected,
      n1: document.getElementById('name_1').value,
      a1: document.getElementById('age_1').value,
    }));
    assert(r2.ok && v2.n0 === 'Amit Verma' && v2.g0 === 'Male' && v2.n1 === 'Neha Verma' && v2.a1 === '38', 'Flat indexed + combobox failed', v2);
    console.log('TEST_2_PASS: Flat indexed inputs + custom ARIA combobox dropdown');

    // TEST 3: FILL_MOBILE_ONLY on OTP screen
    const p3 = await browser.newPage();
    await p3.setContent('<input name="mobile_no" type="tel" /><input name="otp_code" type="text" />');
    await injectMockRuntime(p3);
    const r3 = await p3.evaluate(() => new Promise((resolve) => {
      window.__listeners[0]({ action: 'FILL_MOBILE_ONLY', contact: { mobile: '9123456789' } }, {}, resolve);
    }));
    const v3 = await p3.evaluate(() => ({
      mob: document.querySelector('[name="mobile_no"]').value,
      otp: document.querySelector('[name="otp_code"]').value,
    }));
    assert(r3.ok && v3.mob === '9123456789' && v3.otp === '', 'FILL_MOBILE_ONLY failed', v3);
    console.log('TEST_3_PASS: FILL_MOBILE_ONLY filled mobile & kept OTP untouched');

    // TEST 4: Exact Shri Mahakaleshwar Sheeghra Darshan Slot Screen (Number of Persons -> dynamic Angular visitor rows + Slot card click)
    const p4 = await browser.newPage();
    await p4.setContent(`<!DOCTYPE html>
      <html><body>
        <h3>Select any 1 Slot: Dated 10 Dec, 2026 *</h3>
        <div class="form-group">
          <label for="noOfPersons">Number of Persons</label>
          <input id="noOfPersons" name="no_of_persons" type="number" value="1" />
        </div>
        <div class="slots">
          <div class="slot-card" id="slot23">
            <div>2481 AVAILABLE</div>
            <div>Slot 06:00 AM To 07:00 AM</div>
            <div>1 Person · ₹250</div>
          </div>
          <div class="slot-card" id="slot24">
            <div>2487 AVAILABLE</div>
            <div>Slot 07:00 AM To 08:00 AM</div>
            <div>1 Person · ₹250</div>
          </div>
        </div>
        <div id="visitorsContainer"></div>
        <script>
          function renderVisitors(n) {
            const box = document.getElementById('visitorsContainer');
            box.innerHTML = '';
            for (let i = 0; i < n; i++) {
              const row = document.createElement('div');
              row.className = 'devotee-row';
              row.innerHTML = '<input name="devotee_name_' + i + '" placeholder="Full Name" />' +
                              '<input name="age_' + i + '" placeholder="Age" />' +
                              '<select name="gender_' + i + '"><option value="">Select</option><option value="Male">Male</option><option value="Female">Female</option></select>';
              box.appendChild(row);
            }
          }
          renderVisitors(1);
          document.getElementById('noOfPersons').addEventListener('change', (e) => {
            renderVisitors(parseInt(e.target.value, 10) || 1);
          });
          document.querySelectorAll('.slot-card').forEach((card) => {
            card.addEventListener('click', () => { window.__clickedSlot = card.id; });
          });
        </script>
      </body></html>`);
    await injectMockRuntime(p4);
    const r4 = await p4.evaluate(() => new Promise((resolve) => {
      window.__listeners[0](
        {
          action: 'FILL_BOOKING_FORM',
          bookingMode: 'sheeghra_darshan',
          personCount: 2,
          preferredSlot: '07:00 AM To 08:00 AM',
          devotees: [
            { name: 'Ramesh Joshi', age: '52', gender: 'Male' },
            { name: 'Sunita Joshi', age: '48', gender: 'Female' },
          ],
        },
        {},
        resolve
      );
    }));
    const v4 = await p4.evaluate(() => ({
      persons: document.getElementById('noOfPersons').value,
      clickedSlot: window.__clickedSlot,
      n0: document.querySelector('[name="devotee_name_0"]')?.value,
      n1: document.querySelector('[name="devotee_name_1"]')?.value,
      g1: document.querySelector('[name="gender_1"]')?.value,
    }));
    assert(r4.ok && r4.personsSet && v4.persons === '2', 'Number of Persons was not set first!', v4);
    assert(v4.clickedSlot === 'slot24', 'Preferred available slot card was not clicked!', v4);
    assert(v4.n0 === 'Ramesh Joshi' && v4.n1 === 'Sunita Joshi' && v4.g1 === 'Female', 'Dynamic generated visitor rows were not filled!', v4);
    console.log('TEST_4_PASS: Sheeghra Darshan set Persons=2 first -> clicked Slot 07:00 AM -> filled 2 dynamic visitor rows!');

    // TEST 5: Exact Angular Material "Add Visitors Details" form (Screenshot 2: Name, Age, mat-select Gender, mat-select ID Proof Type, ID Proof Number)
    const p5 = await browser.newPage();
    await p5.setContent(`<!DOCTYPE html>
      <html><body>
        <form>
          <h4>Add Visitors Details</h4>
          <div formarrayname="visitors_basic_details">
            <div class="row">
              <mat-form-field><mat-label>Name *</mat-label><input matInput type="text" id="mi0" /></mat-form-field>
              <mat-form-field><mat-label>Age *</mat-label><input matInput type="number" id="mi1" /></mat-form-field>
              <mat-form-field><mat-label id="lblG0">Gender *</mat-label><mat-select id="msG0" role="combobox" aria-labelledby="lblG0">Select</mat-select></mat-form-field>
              <mat-form-field><mat-label id="lblI0">ID Proof Type *</mat-label><mat-select id="msI0" role="combobox" aria-labelledby="lblI0">Select</mat-select></mat-form-field>
              <mat-form-field><mat-label>ID Proof Number *</mat-label><input matInput type="text" id="mi2" /></mat-form-field>
            </div>
            <div class="row">
              <mat-form-field><mat-label>Name *</mat-label><input matInput type="text" id="mi3" /></mat-form-field>
              <mat-form-field><mat-label>Age *</mat-label><input matInput type="number" id="mi4" /></mat-form-field>
              <mat-form-field><mat-label id="lblG1">Gender *</mat-label><mat-select id="msG1" role="combobox" aria-labelledby="lblG1">Select</mat-select></mat-form-field>
              <mat-form-field><mat-label id="lblI1">ID Proof Type *</mat-label><mat-select id="msI1" role="combobox" aria-labelledby="lblI1">Select</mat-select></mat-form-field>
              <mat-form-field><mat-label>ID Proof Number *</mat-label><input matInput type="text" id="mi5" /></mat-form-field>
            </div>
          </div>
          <div id="overlay" class="cdk-overlay-container"></div>
        </form>
        <script>
          const overlay = document.getElementById('overlay');
          function attachMatSelect(id, opts) {
            const el = document.getElementById(id);
            el.addEventListener('click', () => {
              overlay.innerHTML = opts.map(o => '<mat-option role="option">' + o + '</mat-option>').join('');
              overlay.querySelectorAll('mat-option').forEach(opt => {
                opt.addEventListener('click', () => {
                  el.textContent = opt.textContent;
                  el.dataset.val = opt.textContent;
                  overlay.innerHTML = '';
                });
              });
            });
          }
          attachMatSelect('msG0', ['Male', 'Female', 'Other']);
          attachMatSelect('msG1', ['Male', 'Female', 'Other']);
          attachMatSelect('msI0', ['Aadhaar Card', 'Passport']);
          attachMatSelect('msI1', ['Aadhaar Card', 'Passport']);
        </script>
      </body></html>`);
    await injectMockRuntime(p5);
    const r5 = await p5.evaluate(() => new Promise((resolve) => {
      window.__listeners[0](
        {
          action: 'FILL_BOOKING_FORM',
          bookingMode: 'sheeghra_darshan',
          devotees: [
            { name: 'Anadi Yagnik', age: '31', gender: 'Male', idType: 'Aadhaar Card', idNumber: '987654321012' },
            { name: 'Meera Yagnik', age: '29', gender: 'Female', idType: 'Passport', idNumber: 'Z1234567' },
          ],
        },
        {},
        resolve
      );
    }));
    const v5 = await p5.evaluate(() => ({
      n0: document.getElementById('mi0').value,
      a0: document.getElementById('mi1').value,
      g0: document.getElementById('msG0').dataset.val,
      it0: document.getElementById('msI0').dataset.val,
      id0: document.getElementById('mi2').value,
      n1: document.getElementById('mi3').value,
      a1: document.getElementById('mi4').value,
      g1: document.getElementById('msG1').dataset.val,
      it1: document.getElementById('msI1').dataset.val,
      id1: document.getElementById('mi5').value,
    }));
    assert(r5.ok && v5.n0 === 'Anadi Yagnik' && v5.g0 === 'Male' && v5.it0 === 'Aadhaar Card' && v5.id0 === '987654321012', 'Mat row 1 failed', v5);
    assert(v5.n1 === 'Meera Yagnik' && v5.g1 === 'Female' && v5.it1 === 'Passport' && v5.id1 === 'Z1234567', 'Mat row 2 failed', v5);
    console.log('TEST_5_PASS: Exact Angular Material Add Visitors Details (2 rows, mat-select Gender & ID Proof Type) filled 100%!');

    // TEST 6: Exact Angular 19 AOT /services/sheeghra-darshan DOM (id="" and name="" on all 3 rows, plain div wrappers)
    const p6 = await browser.newPage();
    await p6.setContent(`<!DOCTYPE html>
      <html><body>
        <form>
          ${[0, 1, 2].map(() => `
            <div>
              <div><label>Name *</label><input type="text" /></div>
              <div><label>Age *</label><input type="number" /></div>
              <div><label>Gender *</label><select><option value="">Select</option><option value="Male">Male</option><option value="Female">Female</option></select></div>
              <div><label>ID Proof Type *</label><select><option value="">Select</option><option value="1">Aadhaar Card</option><option value="2">Passport</option></select></div>
              <div><label>ID Proof Number *</label><input type="text" /></div>
            </div>
          `).join('')}
        </form>
      </body></html>`);
    await injectMockRuntime(p6);
    const r6 = await p6.evaluate(() => new Promise((resolve) => {
      window.__listeners[0](
        {
          action: 'FILL_BOOKING_FORM',
          bookingMode: 'sheeghra_darshan',
          devotees: [
            { name: 'Devotee One', age: '30', gender: 'Male', idType: 'Aadhaar Card', idNumber: '111122223333' },
            { name: 'Devotee Two', age: '28', gender: 'Female', idType: 'Passport', idNumber: 'P2222222' },
            { name: 'Devotee Three', age: '60', gender: 'Male', idType: 'Aadhaar Card', idNumber: '444455556666' },
          ],
        },
        {},
        resolve
      );
    }));
    const v6 = await p6.evaluate(() => {
      const texts = Array.from(document.querySelectorAll('input[type="text"]')).map((x) => x.value);
      const ages = Array.from(document.querySelectorAll('input[type="number"]')).map((x) => x.value);
      const sels = Array.from(document.querySelectorAll('select')).map((x) => x.value);
      return { texts, ages, sels };
    });
    assert(r6.ok && r6.filledDevotees === 3, 'Expected 3 nameless AOT rows filled', r6);
    assert(
      v6.texts.join('|') === 'Devotee One|111122223333|Devotee Two|P2222222|Devotee Three|444455556666' &&
      v6.ages.join('|') === '30|28|60' &&
      v6.sels.join('|') === 'Male|1|Female|2|Male|1',
      'Nameless AOT 3-row fill mismatch',
      v6
    );
    console.log('TEST_6_PASS: Angular 19 AOT nameless/id-less 3-person Sheeghra Darshan form filled 100%!');

    // TEST 7: Exact Tatkal / Advance Bhasma Aarti DOM from main-IM23ICKI.js
    // (hidden full_name .visitor_row + select[no_of_persons] with Angular [ngValue] + 2 visible .visitor_row with hidden file input inside .photo-upload-box + relationship_id [ngValue] + id_proof_type_id clearing id_proof_number on change)
    const p7 = await browser.newPage();
    await p7.setContent(`<!DOCTYPE html>
      <html><body>
        <form>
          <div class="visitor_row" style="display:none">
            <div class="form-field"><input formcontrolname="full_name" type="text" /><label>Name</label></div>
          </div>
          <div class="form-field">
            <label>Number of Persons</label>
            <select id="selPersons" formcontrolname="no_of_persons">
              <option value="0: 1">1</option>
              <option value="1: 2">2</option>
              <option value="2: 3">3</option>
            </select>
          </div>
          <div id="bhasmaRows"></div>
        </form>
        <script>
          function renderBhasma(n) {
            const box = document.getElementById('bhasmaRows');
            box.innerHTML = '';
            for (let i = 0; i < n; i++) {
              const row = document.createElement('div');
              row.className = 'visitor_row';
              row.innerHTML =
                '<div class="form-field"><input type="text" /><label>Name *</label></div>' +
                '<div class="photo-upload-box"><label class="btn"><input type="file" hidden accept="image/*" /></label></div>' +
                '<div class="form-field"><label>Relation *</label><select><option value="">Select</option><option value="1: 9">Self</option><option value="2: 6">Wife</option></select></div>' +
                '<div class="form-field"><label>ID Proof Type *</label><select class="idtype"><option value="0">Select</option><option value="1">Aadhaar Card</option><option value="2">Passport</option></select></div>' +
                '<div class="form-field"><input class="idnum" type="text" /><label>ID Proof Number *</label></div>';
              // Simulate real Angular updateIdProofNumberValidation clearing id_proof_number when id_proof_type_id changes!
              row.querySelector('.idtype').addEventListener('change', () => {
                row.querySelector('.idnum').value = '';
              });
              box.appendChild(row);
            }
          }
          renderBhasma(1);
          document.getElementById('selPersons').addEventListener('change', (e) => {
            const n = parseInt(e.target.selectedOptions[0].textContent, 10) || 1;
            renderBhasma(n);
          });
        </script>
      </body></html>`);
    await injectMockRuntime(p7);
    const r7 = await p7.evaluate((img) => new Promise((resolve) => {
      window.__listeners[0](
        {
          action: 'FILL_BOOKING_FORM',
          bookingMode: 'bhasma_aarti',
          personCount: 2,
          devotees: [
            { name: 'Vikram Tiwari', relation: 'Self', idType: 'Aadhaar Card', idNumber: '555566667777', photo: { name: 'v.jpg', type: 'image/png', dataUrl: img } },
            { name: 'Kavita Tiwari', relation: 'Wife', idType: 'Passport', idNumber: 'K7654321', photo: { name: 'k.jpg', type: 'image/png', dataUrl: img } },
          ],
        },
        {},
        resolve
      );
    }), TINY_IMG);
    const v7 = await p7.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('#bhasmaRows .visitor_row'));
      return {
        personsText: document.getElementById('selPersons').selectedOptions[0].textContent,
        rowCount: rows.length,
        r0: {
          name: rows[0]?.querySelector('input[type="text"]')?.value,
          photo: rows[0]?.querySelector('input[type="file"]')?.files.length,
          rel: rows[0]?.querySelectorAll('select')[0]?.value,
          idType: rows[0]?.querySelectorAll('select')[1]?.value,
          idNum: rows[0]?.querySelector('.idnum')?.value,
        },
        r1: {
          name: rows[1]?.querySelector('input[type="text"]')?.value,
          photo: rows[1]?.querySelector('input[type="file"]')?.files.length,
          rel: rows[1]?.querySelectorAll('select')[0]?.value,
          idType: rows[1]?.querySelectorAll('select')[1]?.value,
          idNum: rows[1]?.querySelector('.idnum')?.value,
        },
      };
    });
    assert(r7.ok && v7.personsText === '2' && v7.rowCount === 2, 'Bhasma persons/rows failed', v7);
    assert(v7.r0.name === 'Vikram Tiwari' && v7.r0.photo === 1 && v7.r0.rel === '1: 9' && v7.r0.idType === '1' && v7.r0.idNum === '555566667777', 'Bhasma row 0 failed', v7);
    assert(v7.r1.name === 'Kavita Tiwari' && v7.r1.photo === 1 && v7.r1.rel === '2: 6' && v7.r1.idType === '2' && v7.r1.idNum === 'K7654321', 'Bhasma row 1 failed', v7);
    console.log('TEST_7_PASS: Exact Tatkal/Advance Bhasma Aarti (no_of_persons [ngValue] + hidden photo input + Relation + ID Type->ID Number clear-safe) filled 100%!');
  } finally {
    await browser.close();
  }
})();
