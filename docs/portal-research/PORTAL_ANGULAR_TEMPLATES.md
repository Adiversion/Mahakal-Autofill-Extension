# Shri Mahakaleshwar Portal — Angular 19 Template & API Research Reference

- **Source URL:** `https://www.shrimahakaleshwar.mp.gov.in/services/`
- **Bundle Snapshot:** `main-IM23ICKI.js` (`1.26 MB`, Angular 19.2.18 AOT + Bootstrap 5.3.3)
- **HTML Entry Snapshot:** `portal-index.html`

> This directory is for technical research and selector verification only. It is excluded from the Chrome extension zip by `scripts/build-zip.py`.

## 1. Booking Services Matrix

| Service | Route | Max Persons | Photo Required | Availability API | Encryption |
|---|---|---:|---|---|---|
| Sheeghra Darshan | `/services/slot-booking?type=sheeghra-darshan` → `/services/sheeghra-darshan` | 6 | No | `GET /general_darshan_slots?date=YYYY/MM/DD` | Plain JSON |
| Tatkal Bhasma Aarti | `/services/bhasmaarti` | 5 | Yes (`.photo-upload-box` hidden `input[type=file]`) | `GET /bhasmarti_limit_check?start_date=...&end_date=...` | Encrypted `{payload,iv,tag}` |
| Advance Bhasma Aarti | `/services/advance-bhasmaarti` → `/services/bhasmaarti-request` | 5 | Yes | `GET /bhasmarti_general_limit_check?start_date=...&end_date=...` | Plain JSON |
| Sandhya Aarti | `/services/sandhya-aarti` | 5 | Yes | `POST /check_aarti_quota` (`sandhya_aarti`) | Encrypted `{payload,iv,tag}` |
| Shayan Aarti | `/services/shayan-aarti` | 5 | Yes | `POST /check_aarti_quota` (`shayan_aarti`) | Encrypted `{payload,iv,tag}` |
| Dharmshala Stay | `/services/dharmshala-slot-booking` → `/services/dharmshala-booking` | 6 | No | Room availability endpoints | Mixed |

## 2. Discovered Angular Routes

- `/**`
- `/aarti-booking`
- `/account-history`
- `/advance-bhasmaarti`
- `/advance-bhasmaarti-request`
- `/annakshetra-donation`
- `/bhasmaarti`
- `/bhasmarti-request-success/:id`
- `/darshan-payment/:id`
- `/dharmshala-booking`
- `/dharmshala-payment/:id`
- `/dharmshala-slot-booking`
- `/donation`
- `/help`
- `/kiosk`
- `/login`
- `/page-contact`
- `/payment-status`
- `/pujan-booking`
- `/pujan-payment/:id`
- `/sandhya-aarti`
- `/shayan-aarti`
- `/sheeghra-darshan`
- `/slot-booking`
- `/success`
- `/verify-atithi-niwas-booking/:id`
- `/verify-donation-receipt/:id`

## 3. Discovered Component Selectors

- `<app-aarti-booking>`
- `<app-account-history>`
- `<app-advance-bhasmaarti>`
- `<app-annakshetra-donation>`
- `<app-bhasmaarti-request>`
- `<app-bhasmarti-request-success>`
- `<app-booking-success>`
- `<app-darshan-payment>`
- `<app-dharmshala-booking>`
- `<app-dharmshala-payment>`
- `<app-dharmshala-slot-booking>`
- `<app-donation>`
- `<app-footer-one>`
- `<app-general-bhasmaarti-booking>`
- `<app-home>`
- `<app-login>`
- `<app-multi-date-select-calendar>`
- `<app-multi-month-calendar>`
- `<app-navbar>`
- `<app-page-contact>`
- `<app-page-help>`
- `<app-payment-loader>`
- `<app-payment-status>`
- `<app-photo-capture>`
- `<app-pujan-booking>`
- `<app-pujan-booking-payment>`
- `<app-root>`
- `<app-sandhya-aarti>`
- `<app-scroll-to-top>`
- `<app-shayan-aarti>`
- `<app-sheeghra-darshan>`
- `<app-slot-booking>`
- `<app-verify-atithi-niwas>`
- `<app-verify-donation-receipt>`

## 4. Discovered Public API Endpoints

### Base URLs
- `https://prod-api.mahakal.brainabove.net`
- `https://prod-api.mahakal.brainabove.net/public/api/v1`
- `https://www.brainabove.io`
- `https://www.facebook.com/shreemahakaleshwarujjain/`
- `https://www.instagram.com/shrimahakaleshwarjyotirlingam`
- `https://www.shrimahakaleshwar.mp.gov.in`
- `https://www.shrimahakaleshwar.mp.gov.in/pujan-booking`
- `https://www.shrimahakaleshwar.mp.gov.in/services/dharmshala-slot-booking`
- `https://x.com/ujjainmahakal?lang=en`

### GET (`getPublicDataFromServer`)
- `/annakshetra_date_availability?annakshetra_meal_type_id=${t}&donation_date=${e}`
- `/annakshetra_meal_types`
- `/available_rooms?dharmshala_id=${t}&from_date=${this.selectedDate}&to_date=${this.checkoutDate}&no_of_days=${a}`
- `/bhasmarti_general_limit_check?start_date=${i}&end_date=${a}`
- `/bhasmarti_general_limit_check?start_date=${t}&end_date=${t}`
- `/bhasmarti_request_detail?request_id=${t}`
- `/cities?state_id=`
- `/countries`
- `/dharmashala_list`
- `/dharmshala_booking_detail/`
- `/donation_purposes`
- `/general_darshan_slots?date=${t}`
- `/generate_donation_receipt/`
- `/id_proof_types`
- `/panchang`
- `/payment_gateways`
- `/payment_types`
- `/pujan_bookings/`
- `/pujas`
- `/relations`
- `/restricted_dates`
- `/states`
- `/states?country_id=`
- `/visitors/`

### POST (`postPublicDataToServer`)
- `/aarti_bookings`
- `/add_image`
- `/advance_bhasmarti_bookings/v2`
- `/bhasmarti_bookings/v2`
- `/check_aarti_quota`
- `/dharmshala_booking/v2`
- `/donations/v2`
- `/login_with_password`
- `/make_payment`
- `/pujan_bookings/v2`
- `/send_otp`
- `/verify_otp_and_login`
- `/verify_payment`
- `/visitor_payment`
- `/visitors/v2`

## 5. Key Compiled Angular Template & Logic Excerpts

### Sandhya Aarti Quota Check
```js
darshan_type_slug:"sandhya_aarti",date_of_visit:this.currentDateFormatted.split("/").reverse().join("-"),no_of_persons:t};this.apiService.postPublicDataToServer("/check_aarti_quota",e).subscribe(i=>qi(this,null,function*(){try{let a=yield this.encryptionService.decryptResponse(i);this.quotaAvailable=a.success,a.success?this.quotaMessage=a.message||"Quota available for requested number of persons":this.quotaMessage=a.message||"Quota not available for requested number of persons"}catch(a){console.error("Error decrypting quota response:",a),this.quotaAvailable=!1,this.quotaMessage="Unable to check quota. Please try again."}}),i=>{console.error("Error checking quota:",i),this.quotaAvailable=!1,this.quotaMessage=i.error.error[0]
```

### Shayan Aarti Quota Check
```js
darshan_type_slug:"shayan_aarti",date_of_visit:this.currentDateFormatted.split("/").reverse().join("-"),no_of_persons:t};this.apiService.postPublicDataToServer("/check_aarti_quota",e).subscribe(i=>qi(this,null,function*(){try{let a=yield this.encryptionService.decryptResponse(i);this.quotaAvailable=a.success,a.success?this.quotaMessage=a.message||"Quota available for requested number of persons":this.quotaMessage=a.message||"Quota not available for requested number of persons"}catch(a){console.error("Error decrypting quota response:",a),this.quotaAvailable=!1,this.quotaMessage="Unable to check quota. Please try again."}}),i=>{console.error("Error checking quota:",i),this.quotaAvailable=!1,this.quotaMessage=i.error.error[0]
```

### Sandhya/Shayan Alert Template
```js
e.quotaAvailable?"alert-success":"alert-danger")("ngStyle",e.quotaAvailable?Gt(4,wD):Gt(5,SD)),_(2),w("ngClass",e.quotaAvailable?"fa-check-circle":"fa-times-circle"),_(),Le(" ",e.quotaMessage," ")}}function OD(n,t){if(n&1&&(c(0,"option",36),h(1),d()),n&2){let e=t.$implicit;w("value",e),_(),Ie(e)}}function ED(n,t){n&1&&(c(0,"div",28),h(1," Number of persons is required "),d())}function ND(n,t){n&1&&(c(0,"div",28),h(1," Name is required "),d())}function TD(n,t){if(n&1&&(c(0,"div",54),z(1,"img",55),d()),n&2){let e,i=F().$implicit;_(),w("src",(e
```

### Tatkal Bhasma Aarti Limit Check
```js
bhasmarti_limit_check?start_date=${t}&end_date=${t}`;this.apiService.getPublicDataFromServer(e).subscribe(i=>qi(this,null,function*(){try{let a=yield this.encryptionService.decryptResponse(i);if(a.success&&a.data&&a.data.length>0){this.bhasmarti_limits=a.data[0];let o=a.data[0];if(o.is_restricted){this.appComponent.showMessageAlert("This date is restricted for booking.","error"),this.form.get("date_of_visit")?.setValue("");return}if(!o.limit_available){this.appComponent.showMessageAlert("Booking slots are full for this date. Please select another date.","error"),this.form.get("date_of_visit")?.setValue("");return}this.appComponent.showMessageAlert("Booking slots are availabl
```

### Tatkal Bhasma Aarti Closed Notice Template
```js
Tatkal Bhasmaarti Booking for ",i.getDayAfterTomorrowDate()," will be open on ",i.getTomorrowDate()," at 8 AM. "),_(),w("ngIf",i.bhasmarti_limits.limit_available&&!i.bhasmarti_limits.is_restricted),_(),w("top",!1))},dependencies:[ot,mn,Ct,Xn,Nt,Tt,sn,Dn,ti,ni,qn,ei,bn,Pn,ln,An,In,Ra,La],styles:['@charset "UTF-8";.photo-upload-box[_ngcontent-%COMP%], .id-proof-section[_ngcontent
```

### Advance Bhasma Aarti Calendar API
```js
bhasmarti_general_limit_check?start_date=${i}&end_date=${a}`).subscribe(o=>{this.allRestrictedDates=o.data||[],this.processAvailabilityData(o.data),this.disableAllDates=!1},o=>{console.error("Error fetching restricted dates:",o),this.allRestrictedDates=[]})}processAvailabilityData(t){this.restrictedDates=[],this.restrictedDatesWithInfo=[],t.forEach(e=>{if(!e.limit_available||e.is_restricted){this.restrictedDates.push(e.date);let i="";e.is_restricted?i="Date is restricted":e.limit_available||(i="Booking quota full"),this.res
```

### Sheeghra Darshan Slots API
```js
general_darshan_slots?date=${t}`).subscribe(e=>{this.Time=(e?.data||[]).filter(i=>i.status==="Active"),console.log("Available slots for",t,"=>",this.Time)},e=>{console.error("Error fetching slots:",e),this.Time=[]})}onContinue(){if(!this.selectedDate){alert("Please select a date.");return}if(this.bookingForm.get("darshanType")?.value==="sheeghra-darshan"&&!this.selectedSlot){alert("Please select a time slot to continue.");return}let t=this.bookingForm.get("darshanTyp
```

### ID Proof Number Validation Reset
```js
updateIdProofNumberValidation(t,e){let i=t.get("id_proof_number");if(i?.clearValidators(),i?.setValue(""),i?.updateValueAndValidity(),e&&e!=="0"&&e!==0){let a=this.proofValidation.getIdProofNumberValidators(e);i?.setValidators(a),i?.updateValueAndValidity()}}saveData(){let t=this.form.getRawValue();t.date_of_visit=(0,Iv.default)(this.date_of_visit).format("YYYY-MM-DD"),t.mobile_no=this.mobile_no,t.no_of_persons=this.no_of_persons,t.darshan_type_id=4,this.formMode=="Add"&&(this.appComponent.showLoader(),this.apiService.postPublicDataToServer("/advance_bhasmarti_bookings/v2",t).su
```

## 6. Deep Aarti Rush Analysis (Tatkal Bhasma, Sandhya & Shayan Aarti)

| Attribute | Tatkal Bhasma Aarti (`fm`) | Sandhya Aarti (`_m`) | Shayan Aarti (`vm`) |
|---|---|---|---|
| **Route** | `/services/bhasmaarti` (`canActivate:[na]`) | `/services/sandhya-aarti` (`canActivate:[na]`) | `/services/shayan-aarti` (`canActivate:[na]`) |
| **Window (Local Clock)** | `>= 08:00` (for tomorrow; no close check on client) | `12:00 – 18:30` (same-day) | `16:00 – 22:00` (same-day) |
| **Client Timer?** | No — `setAvailableDateAndCheck()` runs once in `ngOnInit()`; full reload at 8:00 AM required | No — `checkBookingTime()` runs once in `ngOnInit()`; full reload at 12:00 PM required | No — `checkBookingTime()` runs once in `ngOnInit()`; full reload at 4:00 PM required |
| **Quota Endpoint** | `GET /bhasmarti_limit_check?start_date=TMRW&end_date=TMRW` (AES-256-GCM decrypted response) | `POST /check_aarti_quota` (`sandhya_aarti`, today, `no_of_persons`, AES-GCM decrypted; re-called on every `no_of_persons` change) | `POST /check_aarti_quota` (`shayan_aarti`, today, `no_of_persons`, AES-GCM decrypted; re-called on every `no_of_persons` change) |
| **Loader on Quota API?** | **No** (`.global-loader-overlay` NOT shown; `bhasmarti_limits` starts as `{}`) | **No** (`quotaMessage` starts `""`) | **No** (`quotaMessage` starts `""`) |
| **Global Toast Classes** | `.global-alert.alert-success` / `.global-alert.alert-error` (4s auto-hide) | Same | Same |
| **Max Persons** | 5 (`[ngValue]="1..5"`) | 5 (`[value]="1..5"`) | 5 (`[value]="1..5"`) |
| **Async Selects** | `GET /relations`, `GET /id_proof_types` | `GET /id_proof_types` | `GET /id_proof_types` |
| **Form Validators** | `full_name` (`required`), `relationship_id` (default `0`, `required` — Angular treats `0` as valid!), `id_proof_type_id` (`proofTypeValidator`), `id_proof_number`, `image_url` (`required`) | `full_name` (`required`, `minLength(2)`, **`/^[A-Za-z\s]+$/`**), `age` (`1..120`, digits), `gender`, `id_proof_type_id`, `id_proof_number`, `image_url` | Identical to Sandhya Aarti |
| **Anti-Autofill** | None | `appScrambleTarget` (`Wc`) randomizes `name`/`id` to `visitorName_xxxxx`, `visitorAge_xxxxx`, `idProofNum_xxxxx` | Same (`appScrambleTarget`) |
| **Photo Upload Quirk** | `POST /add_image` has **no `.subscribe()` error callback** & `appComponent.loader` is a non-ref-counted boolean | Same | Same |
| **Continue Button** | **Direct submit** → AES-GCM encrypt → `POST /bhasmarti_bookings/v2` → `receipt_url` or `/darshan-payment/:id` | **Review screen** (`showDetails=true`, `.box_round.darshan_dtl`) → **"Pay"** → `POST /visitors/v2` (`darshan_type_id: 21`) → `e_pass_url` or `/darshan-payment/:id` | **Review screen** (`showDetails=true`, `.box_round.darshan_dtl`) → **"Pay"** → `POST /visitors/v2` (`darshan_type_id: 20`) → `e_pass_url` or `/darshan-payment/:id` |
| **Portal jQuery Quirk** | `portal-index.html` loads jQuery 3.7.1 globally; extension must NOT call `jQuery.trigger('change')` on Angular 19 pages or quota/row handlers fire twice | Same | Same |
| **Login Redirect** | Unauthenticated visits redirect to `/services/login?returnUrl=%2Fbhasmaarti`; auth token stored in `localStorage.authToken` | Redirects to `/services/login?returnUrl=%2Fsandhya-aarti` | Redirects to `/services/login?returnUrl=%2Fshayan-aarti` |

### Exact Live `ProofValidationService` (`Wc` in `chunk-5TUGH7WL.js`) & Live API Shapes
- **Aadhaar (`id=1`)**: strips whitespace, requires `/^\d{12}$/` and rejects 12 repeated digits (`/^(\d)\1{11}$/`). Formatted live as `XXXX XXXX XXXX` (max 14 chars).
- **Passport (`id=2`)**: uppercase alphanumeric max 8 chars, requires `/^[A-PR-WYa-pr-wy]{1,2}[0-9]{6,7}$/` (excludes `Q`, `X`, `Z`).
- **Live `/check_aarti_quota` HTTP 400 shape**: `{"success":false,"status_code":400,"error":[{"message":"Slot not available for the selected date"}]}` (rendered directly in `.alert-danger`).
- **Live `/relations` (10 items)**: `Father(1)`, `Mother(2)`, `Son(3)`, `Daughter(4)`, `Husband(5)`, `Wife(6)`, `Brother(7)`, `Sister(8)`, `Self(9)`, `Friends(10)`.
- **Live `/id_proof_types` (2 items)**: `Aadhaar Card(1)`, `Passport(2)`.
- **Live `/countries` (1 item)**: `India(1)`.
- **Live `/restricted_dates` slugs**: `garbh_grha_darshan`, `general_bhasmaarti`, `sandhya_aarti`, `shayan_aarti`, `sheegra_darshan`.



