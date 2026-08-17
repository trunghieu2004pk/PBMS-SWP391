// Các góc ảnh hiện trạng — nhãn + hướng dẫn chụp, dùng chung cho booth và màn đối chiếu.
// Phải khớp ENUM `kind` ở server/src/models/sessionPhoto.model.js.

export const PHOTO_KIND_LABELS = {
  front: 'Đầu xe',
  left: 'Bên trái',
  rear: 'Đuôi xe',
  right: 'Bên phải',
  driver: 'Người lái',
};

// Gợi ý đặt máy cho từng góc — staff mới vào ca không phải đoán.
export const PHOTO_KIND_HINTS = {
  front: 'Lấy trọn đầu xe, thấy rõ biển số trước',
  left: 'Lấy trọn sườn trái, thấy cả gương chiếu hậu trái',
  rear: 'Lấy trọn đuôi xe, thấy rõ biển số sau',
  right: 'Lấy trọn sườn phải, thấy cả gương chiếu hậu phải',
  driver: 'Người lái nhìn thẳng vào camera, thấy rõ mặt',
};

export const kindLabel = (kind) => PHOTO_KIND_LABELS[kind] || kind;

// Thứ tự chụp cố định: đi vòng quanh xe rồi mới tới người lái.
// Ép thứ tự để staff không nhảy cóc rồi quên mất góc nào đã chụp.
export const KIND_ORDER = ['front', 'left', 'rear', 'right', 'driver'];

export const sortKinds = (kinds = []) =>
  [...kinds].sort((a, b) => KIND_ORDER.indexOf(a) - KIND_ORDER.indexOf(b));

export const PHASE_LABEL = { entry: 'lúc VÀO', exit: 'lúc RA' };
