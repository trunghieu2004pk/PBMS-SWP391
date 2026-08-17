import { auth } from "./auth.js";
import { rbac, ROLES } from "./rbac.js";

export const managerWrite = [auth, rbac(ROLES.MANAGER)];
export const managerOnly = [auth, rbac(ROLES.MANAGER)];
export const staffOnly = [auth, rbac(ROLES.STAFF)];
export const userOnly = [auth, rbac(ROLES.USER)];
export const authenticated = [auth];
export const adminOnly = [auth, rbac(ROLES.ADMIN)];
export const staffOrManager = [auth, rbac(ROLES.STAFF, ROLES.MANAGER)];
export const managerOrAdmin = [auth, rbac(ROLES.MANAGER, ROLES.ADMIN)];

// Sự cố dồn hết về Admin (chốt của nhóm): Manager chỉ còn lo dữ liệu gốc — tầng, khu, chỗ đỗ,
// bảng giá, cấu hình. Staff vẫn báo và xem sự cố của chính mình, Admin là nơi xử lý cuối.
export const staffOrAdmin = [auth, rbac(ROLES.STAFF, ROLES.ADMIN)];

// Thêm quyền cho phép Staff, Manager hoặc Admin được xem ảnh sự cố
export const staffOrManagerOrAdmin = [
  auth,
  rbac(ROLES.STAFF, ROLES.MANAGER, ROLES.ADMIN),
];
