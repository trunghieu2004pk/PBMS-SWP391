# TÀI LIỆU TÓM TẮT CHỨC NĂNG CỦA VAI TRÒ QUẢN LÝ (MANAGER) — PBMS

Tài liệu này giải thích chi tiết các chức năng chính của vai trò **Quản lý (Manager)** trong hệ thống PBMS, các API Backend (BE) tương ứng được gọi từ Frontend (FE), và cơ chế xử lý logic nghiệp vụ (business logic) ở phía server.

---

## 1. TỔNG QUAN VAI TRÒ QUẢN LÝ (MANAGER)

Trong hệ thống PBMS, vai trò **Quản lý (Manager)** chịu trách nhiệm thiết lập và vận hành các cấu trúc dữ liệu cốt lõi (dữ liệu gốc - master data), cấu hình hệ thống, và xem các báo cáo tổng hợp. 

> **Phân chia trách nhiệm:** Manager chủ yếu lo dữ liệu nền tảng và vận hành bãi (tầng, khu, chỗ đỗ, bảng giá, cấu hình, báo cáo). Việc xử lý sự cố (incidents) và phê duyệt hoàn tiền (refunds) đã được tập trung cho vai trò **Admin**, nhằm giảm tải cho Manager và đồng bộ hóa quy trình phê duyệt tài chính.

---

## 2. CHI TIẾT CÁC CHỨC NĂNG, API VÀ LOGIC XỬ LÝ

Dưới đây là chi tiết các phân hệ chính hiển thị trên thanh điều hướng của Manager và hệ thống:

* **Loại xe**
* **Bảng giá**
* **Tầng**
* **Khu vực**
* **Chỗ đỗ**
* **Cổng**
* **Báo cáo**
* **Cấu hình**
* **Xác thực & Phân quyền**
* **Thanh toán**

---

### Phân hệ 1: Loại xe (Vehicle Types)
* **Trang FE tương ứng:** `client/src/pages/manager/VehicleTypesPage.jsx`
* **File API FE:** `client/src/api/masterData.js` (`vehicleTypesApi`)

#### Danh sách API sử dụng:
* **Lấy danh sách loại xe:** `GET /api/vehicle-types`
* **Xem chi tiết loại xe:** `GET /api/vehicle-types/:id`
* **Thêm mới loại xe:** `POST /api/vehicle-types`
  * *Payload:* `{ typeName: "Xe máy điện", typeCode: "EVBIKE", slotAreaM2: 3 }`
* **Cập nhật loại xe:** `PUT /api/vehicle-types/:id`
  * *Payload:* `{ typeName: "...", typeCode: "...", slotAreaM2: ... }`
* **Xóa loại xe:** `DELETE /api/vehicle-types/:id`

#### Cơ chế xử lý logic ở Backend:
1. **Chuẩn hóa mã loại xe:** Mã loại xe (`type_code`) luôn được chuẩn hóa thành **CHỮ HOA** (ví dụ: `CAR`, `BIKE`, `EVBIKE`) để nhất quán dữ liệu và tránh trùng lặp do phân biệt chữ hoa/thường.
2. **Kiểm tra khi sửa diện tích slot:** Khi sửa đổi diện tích chiếm dụng (`slot_area_m2`) của một loại xe, nếu diện tích này **tăng lên**, BE sẽ gọi hàm `assertVehicleTypeAreaFitsFloors` để kiểm tra xem việc tăng diện tích có làm cho các khu vực (Zone) hiện tại sử dụng loại xe đó bị vượt quá diện tích tối đa của tầng hầm hay không. Nếu có, BE sẽ ném lỗi `409 CONFLICT`.
3. **Ràng buộc an toàn khi xóa:** Trước khi xóa một loại xe, BE kiểm tra xem loại xe đó có đang được dùng bởi Khu vực (Zone) nào hoặc Bảng giá (Pricing Rule) nào không. Nếu có, BE sẽ ném lỗi cảnh báo chứ không để hệ thống trả về lỗi cơ sở dữ liệu thô (Foreign Key Constraint).

---

### Phân hệ 2: Bảng giá (Pricing Rules)
* **Trang FE tương ứng:** `client/src/pages/manager/PricingRulesPage.jsx`
* **File API FE:** `client/src/api/masterData.js` (`pricingRulesApi`)

#### Danh sách API sử dụng:
* **Lấy danh sách bảng giá:** `GET /api/pricing-rules?vehicleTypeId=...`
* **Xem chi tiết bảng giá:** `GET /api/pricing-rules/:id`
* **Thêm bảng giá:** `POST /api/pricing-rules`
  * *Payload:* `{ vehicleTypeId: 1, unit: "hour", baseRate: 10000, effectiveFrom: "2026-08-20T00:00:00Z", effectiveTo: null }`
* **Cập nhật bảng giá:** `PUT /api/pricing-rules/:id`
* **Xóa bảng giá:** `DELETE /api/pricing-rules/:id`

#### Cơ chế xử lý logic ở Backend:
1. **Chống đè khoảng hiệu lực (Periods Overlap):** Hệ thống không cho phép tồn tại hai bảng giá của cùng một loại xe có thời gian hiệu lực đè lên nhau. Logic kiểm tra giao nhau `periodsOverlap(a, b)` dùng mốc `Infinity` cho bảng giá vô hạn (`effective_to = null`).
2. **Xử lý giá trị vô hạn (`null`):** Khi cập nhật trường `effectiveTo`, BE kiểm tra tường minh giá trị gửi lên có phải `undefined` hay không để cho phép Manager xóa thời hạn đóng (chuyển sang bảng giá vô hiệu hạn) bằng cách gửi `effectiveTo: null`.

---

### Phân hệ 3: Tầng (Floors)
* **Trang FE tương ứng:** `client/src/pages/manager/FloorsPage.jsx`
* **File API FE:** `client/src/api/masterData.js` (`floorsApi`)

#### Danh sách API sử dụng:
* **Lấy danh sách tầng (kèm sức chứa):** `GET /api/floors`
* **Xem chi tiết tầng:** `GET /api/floors/:id`
* **Thêm tầng:** `POST /api/floors`
* **Cập nhật tầng:** `PUT /api/floors/:id`
* **Xóa tầng:** `DELETE /api/floors/:id`
* **Thiết lập nhanh tầng:** `POST /api/floors/setup` (Hỗ trợ cấu hình nhanh tầng, khu vực, chỗ đỗ và cổng)
* **Nhân bản tầng:** `POST /api/floors/:id/clone`

#### Cơ chế xử lý logic ở Backend:
1. **Ràng buộc cao độ (`floor_level`):** Mỗi cao độ số chỉ được phép có duy nhất một tầng (ví dụ: không thể tồn tại 2 tầng cùng ở cao độ `-1`).
2. **Diện tích giảm dần theo độ cao (Monotonic Area Check):** Khi tạo/sửa diện tích tầng (`area_m2`) hoặc cao độ (`floor_level`), BE chạy hàm `assertFloorAreaMonotonic` để kiểm tra độ nhất quán kiến trúc (diện tích các tầng thường nhỏ hơn hoặc bằng tầng phía dưới nó).
3. **Cơ chế Layout Mode (zoned vs single):**
   * *Layout single (Tầng chuyên dụng 1 loại xe):* Yêu cầu nhập loại xe. BE tự động tạo 1 khu mặc định (`Zone`) chiếm trọn diện tích tầng, số slot tối đa được tính bằng: `FLOOR_AREA / SLOT_AREA_OF_VEHICLE`.
   * *Layout zoned (Tầng phân khu):* Cho phép chia nhỏ tầng thành nhiều khu với các loại xe khác nhau.
4. **Logic Chuyển đổi Layout Mode:** 
   * Cho phép đổi từ `single` sang `zoned` (hệ thống tự động xóa khu mặc định cũ nếu chưa có slot thực tế nào được tạo).
   * Chỉ cho phép đổi từ `zoned` sang `single` khi tầng đó chỉ còn duy nhất 1 khu vực (Zone).
5. **Cơ chế thiết lập nhanh (`quickSetupFloor`):** Bọc trong 1 database **Transaction**. BE tự sinh mã khu vực, tự sinh các chỗ đỗ (bằng hàm `bulkGenerateSlots`), và sinh 2 cổng mặc định (`IN` và `OUT`) cho tầng đó nếu có cấu hình `auto: true`.
6. **Cơ chế nhân bản (`cloneFloor`):** Sao chép toàn bộ cấu trúc khu vực, cổng và tạo mới các parking slot ở trạng thái `available` sang một tầng mới trong 1 Transaction.

---

### Phân hệ 4: Khu vực (Zones)
* **Trang FE tương ứng:** `client/src/pages/manager/ZonesPage.jsx`
* **File API FE:** `client/src/api/masterData.js` (`zonesApi`)

#### Danh sách API sử dụng:
* **Lấy danh sách khu vực:** `GET /api/zones?floorId=...`
* **Xem chi tiết khu vực:** `GET /api/zones/:id`
* **Xem trước mã khu vực:** `GET /api/zones/next-code?floorId=...&vehicleTypeId=...`
* **Thêm khu vực:** `POST /api/zones`
* **Cập nhật khu vực:** `PUT /api/zones/:id`
* **Xóa khu vực:** `DELETE /api/zones/:id`

#### Cơ chế xử lý logic ở Backend:
1. **Quy ước đặt mã tự động (`zone_code`):** Mã khu vực được hệ thống tự động sinh theo quy tắc: `<MÃ_TẦNG>-<MÃ_LOẠI_XE>-<NN>` (ví dụ: `B1-CAR-01`). Manager không được tự nhập mã khu vực để đảm bảo tính đồng bộ.
2. **Giới hạn vé tháng (`monthlyPassCapacity`):** Sức chứa của vé tháng đăng ký tại một khu vực không được vượt quá tổng số chỗ đỗ (`total_slots`) của khu vực đó.
3. **Ràng buộc diện tích tầng:** Tổng diện tích chiếm dụng của tất cả các khu vực trên một tầng (`slotCount * slotArea`) không được vượt quá diện tích thực tế của tầng đó (`area_m2`).
4. **Đồng bộ mã con khi đổi thuộc tính:** Khi đổi loại xe hoặc chuyển khu vực sang tầng khác, mã khu vực sẽ thay đổi. BE sẽ bọc trong transaction để cập nhật lại thông tin khu vực và chạy hàm `resyncZoneSlotCodes` để **cập nhật lại toàn bộ mã chỗ đỗ con** của khu đó cho khớp với mã khu vực mới (ví dụ: đổi mã khu từ `B1-BIKE-01` sang `B1-EVBIKE-01` thì chỗ đỗ sẽ đổi từ `B1-BIKE-01-01` sang `B1-EVBIKE-01-01`).

---

### Phân hệ 5: Chỗ đỗ (Parking Slots)
* **Trang FE tương ứng:** `client/src/pages/manager/ParkingSlotsPage.jsx`
* **File API FE:** `client/src/api/masterData.js` (`parkingSlotsApi`)

#### Danh sách API sử dụng:
* **Lấy danh sách chỗ đỗ:** `GET /api/parking-slots?zoneId=...`
* **Xem chi tiết chỗ đỗ:** `GET /api/parking-slots/:id`
* **Xem trước mã chỗ đỗ kế tiếp:** `GET /api/parking-slots/next-code?zoneId=...`
* **Thêm 1 chỗ đỗ:** `POST /api/parking-slots`
* **Tạo nhanh nhiều chỗ đỗ (Bulk):** `POST /api/zones/:zoneId/slots/bulk`
  * *Payload:* `{ count: 20, distanceStart: 10, distanceStep: 2 }`
* **Cập nhật chỗ đỗ:** `PUT /api/parking-slots/:id`
* **Xóa chỗ đỗ:** `DELETE /api/parking-slots/:id`

#### Cơ chế xử lý logic ở Backend:
1. **Quy ước đặt mã tự động (`slot_code`):** Mã chỗ đỗ tự sinh theo công thức: `<MÃ_KHU>-<NN>` (ví dụ: `B1-CAR-01-05`).
2. **Cơ chế chuyển trạng thái thủ công (`validateStatusChange`):**
   * Manager chỉ được quyền chuyển trạng thái chỗ đỗ qua lại giữa các trạng thái thủ công: `available` (trống), `maintenance` (bảo trì), hoặc `locked` (khoá).
   * BE chặn tuyệt đối việc chuyển trạng thái thủ công đối với các chỗ đỗ đang có trạng thái hệ thống quản lý như `reserved` (đã đặt trước) hoặc `occupied` (đang có xe đỗ).
3. **Logic di chuyển chỗ sang khu vực khác:** Khi Manager di chuyển chỗ đỗ sang một khu vực mới, mã chỗ đỗ sẽ tự động cập nhật theo tiền tố của khu vực mới. Chức năng này bị chặn nếu chỗ đỗ đó đang có trạng thái `occupied` hoặc `reserved`.
4. **Cơ chế tự động hóa khoảng cách tới cổng khi tạo bulk:**
   * Khi tạo hàng loạt chỗ đỗ mới, Manager có thể nhập khoảng cách bắt đầu (`distanceStart`) và bước tăng khoảng cách (`distanceStep`).
   * Nếu không nhập, hệ thống sẽ tự động dò tìm vị trí đỗ xa nhất hiện tại của khu vực đó và cộng nối tiếp theo bước tăng khoảng cách để đảm bảo dữ liệu khoảng cách không bị bỏ trống.

---

### Phân hệ 6: Cổng (Gates)
* **Trang FE tương ứng:** `client/src/pages/manager/GatesPage.jsx`
* **File API FE:** `client/src/api/masterData.js` (`gatesApi`)

#### Danh sách API sử dụng:
* **Lấy danh sách cổng:** `GET /api/gates?floorId=...`
* **Xem chi tiết cổng:** `GET /api/gates/:id`
* **Thêm cổng:** `POST /api/gates`
  * *Payload:* `{ floorId: 1, direction: "in", label: "Cổng vào tầng hầm B1", isActive: true }`
* **Cập nhật cổng:** `PUT /api/gates/:id`
* **Xóa cổng:** `DELETE /api/gates/:id`

#### Cơ chế xử lý logic ở Backend:
1. **Ràng buộc hướng cổng (`assertSingleDirectionGate`):** Trong cùng một tầng (hoặc cấp tòa nhà - `floor_id = null`), hệ thống giới hạn chỉ được phép tồn tại **tối đa 1 cổng vào (IN) và 1 cổng ra (OUT)**.
2. **Quy ước đặt mã cổng tự động:** Mã cổng do hệ thống tự sinh theo quy chuẩn: `<MÃ_TẦNG>-<IN|OUT>` (ví dụ: `B1-IN`, `B1-OUT`). Nếu cổng cấp tòa nhà, mã sẽ là `BLD-IN` hoặc `BLD-OUT`.

---

### Phân hệ 7: Báo cáo (Reports)
* **Trang FE tương ứng:** `client/src/pages/manager/ReportsPage.jsx`
* **File API FE:** `client/src/api/reports.js` (`reportsApi`)

#### Danh sách API sử dụng:
* **Tải báo cáo lấp đầy hiện tại:** `GET /api/reports/occupancy?floorId=...`
* **Tải báo cáo tổng quan (doanh thu + lưu lượng):** `GET /api/reports/overview?from=...&to=...&floorId=...`

#### Cơ chế xử lý logic ở Backend:
1. **Truy vết doanh thu theo Tầng (Floor-based Revenue Tracking):** Do bảng `Payment` không có cột trực tiếp liên kết với Tầng (`floor_id`), BE áp dụng logic truy vết gián tiếp qua các nguồn liên quan:
   * **Doanh thu vãng lai:** `session_id` -> `slot` -> `zone` -> `floor_id`.
   * **Doanh thu đặt trước:** `reservation_id` -> `floor_id`.
   * **Doanh thu vé tháng:** `pass_id` -> `floor_id`.
   * Nhờ đó, báo cáo lọc theo tầng hiển thị chính xác doanh thu thực tế phát sinh tại tầng đó thay vì doanh thu toàn bãi.
2. **Đo lường lưu lượng thực tế (Traffic filtration):** Khi tính toán số lượt xe vào/ra (traffic), BE sẽ loại bỏ các phiên đỗ xe có trạng thái `exception` (phiên đỗ xe bị hủy do camera không chụp được ảnh biển số hoặc đơn đặt chỗ bị hủy) nhằm đưa ra thống kê lượt xe chuẩn xác.

---

### Phân hệ 8: Cấu hình (Settings)
* **Trang FE tương ứng:** `client/src/pages/manager/SettingsPage.jsx`
* **File API FE:** `client/src/api/settings.js` (`systemSettingsApi`)

#### Danh sách API sử dụng:
* **Lấy thông tin cấu hình:** `GET /api/settings/system`
* **Cập nhật cấu hình:** `PATCH /api/settings/system` (Nhận partial JSON để update các key mong muốn)

#### Cơ chế xử lý logic ở Backend:
1. **Lưu trữ dưới dạng JSON:** Toàn bộ cấu hình hệ thống được lưu trong bảng `Setting` tại dòng có `setting_id = 1`, dưới dạng một chuỗi JSON (`system_config`).
2. **Cơ chế lưu đè an toàn (Merge Patch):** Khi Manager gửi yêu cầu PATCH để cập nhật cấu hình, BE sẽ gộp (`merge`) các trường được thay đổi với các trường cũ trong DB chứ không ghi đè toàn bộ, tránh làm mất cấu hình của các tính năng khác (ví dụ: trọng số gợi ý bãi đỗ của AI, thông tin đặt xe...).
3. **Cơ chế bộ nhớ đệm (Caching):** Để tối ưu tốc độ đọc cấu hình khi xe vào/ra liên tục, BE sử dụng bộ nhớ đệm (`systemCache`). Khi có thay đổi từ API PATCH của Manager, BE sẽ ghi xuống DB và lập tức gọi `clearSettingsCache()` và `refreshSettingsCache()` để đồng bộ bộ nhớ đệm tức thì mà không cần khởi động lại Server.
4. **Các nhóm cấu hình chính điều chỉnh bởi Manager:**
   * **Phí dịch vụ:** Phí đặt chỗ trước (`booking_fee`), giá vé tháng mặc định (`monthly_pass_price`), phí mất thẻ (`lost_ticket_fee`), phí đỗ quá giờ/lố giờ (`overstay_fee`).
   * **Chính sách hủy đơn:** Thời hạn hủy đơn giữ chỗ trước giờ vào (`booking_refund_cutoff_hours`), phần trăm hoàn trả phí (`booking_refund_percent`), thời gian giữ đơn chưa thanh toán (`booking_pending_ttl_minutes`).
   * **Chính sách hoàn tiền vé tháng:** Quy định số ngày dùng thử, phần trăm hoàn tiền khi hủy vé tháng trước ngày chạy hoặc trong nửa thời hạn đầu của vé.
   * **Ảnh chụp camera (Bảo mật & Đối soát):** 
     * Bật/tắt bắt buộc chụp ảnh khi vào (`require_entry_photo`) / ra (`require_exit_photo`).
     * Cấu hình các góc chụp yêu cầu (trước, trái, sau, phải, người lái).
     * Thời gian lưu trữ ảnh chụp (`photo_retention_days`).
     * Ngưỡng kiểm tra trùng lặp ảnh (`photo_similarity_threshold` sử dụng thuật toán dHash) để chặn nhân viên tự chụp 1 vị trí nhiều lần.

---

### Phân hệ 9: Xác thực & Phân quyền (Authentication & Authorization)
* **Trang FE tương ứng:**
  * Đăng nhập: [`LoginPage.jsx`](file:///d:/swp_test/gui-xe/client/src/pages/LoginPage.jsx)
  * Đăng ký: [`RegisterPage.jsx`](file:///d:/swp_test/gui-xe/client/src/pages/RegisterPage.jsx)
  * Quên mật khẩu: [`ForgotPasswordPage.jsx`](file:///d:/swp_test/gui-xe/client/src/pages/ForgotPasswordPage.jsx)
  * Đặt lại mật khẩu: [`ResetPasswordPage.jsx`](file:///d:/swp_test/gui-xe/client/src/pages/ResetPasswordPage.jsx)
  * Trang hồ sơ: [`ProfilePage.jsx`](file:///d:/swp_test/gui-xe/client/src/pages/user/ProfilePage.jsx)
* **File API FE:** [`auth.js`](file:///d:/swp_test/gui-xe/client/src/api/auth.js)

#### Danh sách API sử dụng:
* **Đăng ký tài khoản (User):** `POST /api/auth/register`
* **Đăng nhập hệ thống (Local):** `POST /api/auth/login`
* **Đăng nhập qua Google (SSO):** `POST /api/auth/google`
* **Quên mật khẩu:** `POST /api/auth/forgot-password`
* **Đặt lại mật khẩu:** `POST /api/auth/reset-password`
* **Xác minh email qua link (GET):** `GET /api/auth/verify-email?token=...&email=...`
* **Xác minh email qua token (POST):** `POST /api/auth/verify-email`
* **Gửi lại email xác minh:** `POST /api/auth/resend-verification`
* **Xem thông tin cá nhân:** `GET /api/auth/me`
* **Cập nhật hồ sơ (họ tên, SĐT, STK ngân hàng hoàn tiền):** `PATCH /api/auth/me`

#### Cơ chế xử lý logic ở Backend:
1. **Bắt buộc xác minh email đối với tài khoản Local:** Khi người dùng đăng ký bằng tài khoản local, trạng thái mặc định là `email_verified = false`. Hệ thống sẽ sinh một token xác minh ngẫu nhiên, lưu hash SHA-256 kèm hạn sử dụng (mặc định 24h) vào DB, và gửi link qua email. Người dùng bắt buộc phải xác minh email trước khi đăng nhập. Nếu dịch vụ mail (SMTP) chưa cấu hình, API đăng ký sẽ trả lỗi `503 Service Unavailable` (`MAIL_NOT_CONFIGURED`) để tránh sinh tài khoản chết.
2. **Cơ chế đăng nhập Google (SSO):** Backend nhận `idToken` từ Frontend, sử dụng Google Auth Library để xác thực. Nếu email của tài khoản Google chưa tồn tại trong hệ thống, hệ thống sẽ tự động tạo tài khoản mới với username được sinh tự động (`deriveUsername`) và gán mặc định là đã xác minh email (`email_verified = true`).
3. **Phân quyền và Bảo mật:** 
   * **JWT Authentication:** Sau khi đăng nhập thành công, Server cấp token JWT (chứa thông tin `userId` và `roleName`) để client lưu trữ và gửi kèm trong header `Authorization: Bearer <token>` ở mỗi request sau.
   * **Bảo vệ Brute-force:** Áp dụng `authRateLimiter` lên các route xác thực quan trọng (đăng nhập, đăng ký, quên/đặt lại mật khẩu) để giới hạn tần suất gửi request từ một địa chỉ IP.
   * **Cập nhật thông tin ngân hàng:** Cho phép người dùng cập nhật thông tin tài khoản ngân hàng (`bankName`, `bankAccountNumber`, `bankAccountHolder`) phục vụ cho quy trình hoàn trả tiền khi hủy vé tháng hoặc hủy lịch đặt chỗ trước.

---

### Phân hệ 10: Thanh toán (Payments)
* **Trang FE tương ứng:**
  * Đặt chỗ & Thanh toán đặt trước: [`ReservePage.jsx`](file:///d:/swp_test/gui-xe/client/src/pages/user/ReservePage.jsx)
  * Đăng ký & Thanh toán vé tháng: [`BuyMonthlyPassPage.jsx`](file:///d:/swp_test/gui-xe/client/src/pages/user/BuyMonthlyPassPage.jsx)
  * Kết quả thanh toán đặt chỗ: [`PaymentSuccessPage.jsx`](file:///d:/swp_test/gui-xe/client/src/pages/user/PaymentSuccessPage.jsx) / [`PaymentFailedPage.jsx`](file:///d:/swp_test/gui-xe/client/src/pages/user/PaymentFailedPage.jsx)
  * Kết quả thanh toán vé tháng: [`PassPaymentSuccessPage.jsx`](file:///d:/swp_test/gui-xe/client/src/pages/user/PassPaymentSuccessPage.jsx) / [`PassPaymentFailedPage.jsx`](file:///d:/swp_test/gui-xe/client/src/pages/user/PassPaymentFailedPage.jsx)
  * Kiosk tự thanh toán checkout tại cổng: [`GateKioskPage.jsx`](file:///d:/swp_test/gui-xe/client/src/pages/kiosk/GateKioskPage.jsx)
* **File API FE:** [`payments.js`](file:///d:/swp_test/gui-xe/client/src/api/payments.js) (`paymentsApi`)

#### Danh sách API sử dụng:
* **Webhook nhận kết quả từ PayOS:** `POST /api/payments/webhook` (Không yêu cầu đăng nhập)
* **Xác minh giao dịch sau khi redirect:** `GET /api/payments/verify?orderCode=...`
* **Lấy chi tiết thông tin thanh toán:** `GET /api/payments/:id`

#### Cơ chế xử lý logic ở Backend:
1. **Tích hợp cổng thanh toán PayOS:**
   * Khi người dùng tạo yêu cầu thanh toán (đặt chỗ, mua vé tháng, hoặc checkout xe vãng lai), Backend gọi API PayOS để tạo link thanh toán (`createPayOSPaymentLink`) với mã đơn hàng duy nhất (`orderCode`).
   * Trạng thái thanh toán ban đầu là `pending` với phương thức `payos`.
2. **Cơ chế xác thực giao dịch hai lớp:**
   * **Lớp 1 (Webhook):** PayOS chủ động gọi về API `/webhook`. Backend xác minh chữ ký bảo mật từ PayOS (`verifyPayOSWebhook`), nếu hợp lệ và thanh toán thành công (`code: "00"` hoặc `status: "PAID"`), Backend sẽ cập nhật trạng thái đơn hàng thành `success`, đồng thời kích hoạt dịch vụ tương ứng (Xác nhận đặt chỗ, kích hoạt vé tháng, hoặc chốt phiên gửi xe).
   * **Lớp 2 (Redirect & Verify):** Khi người dùng hoàn tất thanh toán trên cổng PayOS và được chuyển hướng về website, Frontend sẽ gọi API `/verify` kèm `orderCode`. Server không tin vào tham số client gửi lên mà chủ động gọi API PayOS để kiểm tra trạng thái thực tế của đơn hàng, đảm bảo tính nhất quán dữ liệu (idempotency).
3. **Quy trình checkout chốt phiên và mở barie:**
   * **Thanh toán online (PayOS):** Sau khi xác nhận tiền đã về, hệ thống cập nhật `time_out` cho phiên đỗ xe, giải phóng chỗ đỗ (`releaseSlot`), cập nhật trạng thái session sang `completed`, tự động đóng các sự cố liên quan (như báo mất thẻ, đỗ quá giờ) và ra lệnh mở barie cho cổng ra.
   * **Thanh toán tiền mặt tại quầy (Cash):** Nhân viên kiểm tra và xác nhận thu tiền mặt. Hệ thống chuyển đổi đơn hàng `pending` hiện tại hoặc tạo mới bản ghi thanh toán với phương thức `cash`, chốt trạng thái phiên gửi xe thành công và mở cổng ngay lập tức mà không qua cổng trực tuyến PayOS.
   * **Ràng buộc an toàn khi checkout:** 
     * Hệ thống kiểm tra điều kiện ảnh chụp lúc ra đầy đủ (`assertPhotoComplete`) và kiểm tra tính hợp lệ của cổng ra (`assertAndRecordExitGate`). Nếu xe đỗ sai tầng hoặc đi sai cổng ra chuyên dụng của loại xe, hệ thống sẽ ghi sự cố `wrong_floor` và chặn không mở barie để đảm bảo an ninh.

---

## 3. TÓM TẮT MAPPING DỮ LIỆU CHÍNH (SCHEMA RELATIONSHIPS)

Sơ đồ liên kết thực thể (Entity Relation) liên quan trực tiếp đến cấu hình của Manager:

```
[Floor] (Tầng)
   |-- 1:N --> [Gate] (Cổng: Tối đa 1 IN, 1 OUT)
   |-- 1:N --> [Zone] (Khu vực)
                |-- 1:N --> [ParkingSlot] (Chỗ đỗ)
                             |-- 1:1 (Loại xe ghim vào Zone) --> [VehicleType]
                                                                      |-- 1:N --> [PricingRule] (Bảng giá)
```
