import { Op } from 'sequelize';
import { ParkingSession } from '../models/index.js';
import sequelize from '../config/db.js';
import { voidActiveSession } from '../services/session.service.js';
import { recordIncident } from '../services/incident.service.js';

/**
 * Job dọn PHIÊN TREO ở cổng vào.
 *
 * Vấn đề: check-in tại quầy tạo phiên + chiếm chỗ NGAY, nhưng xe chỉ thật sự vào bãi khi
 * qua cổng tòa. Nếu khâu giữa hỏng (không chụp/nhập được ảnh, khách đổi ý, nhân viên nhập
 * nhầm rồi bỏ đó) thì phiên nằm lại vĩnh viễn: chỗ bị giữ, biển số bị khoá.
 * Nhân viên có nút "Hủy phiên" để tự gỡ, nhưng không thể trông chờ họ luôn nhớ bấm.
 *
 * Job này là LƯỚI AN TOÀN: phiên còn ở 'checked_in' quá lâu ⇒ coi như xe không vào ⇒ hủy,
 * trả chỗ, mở khoá biển số, ghi sự cố để truy vết.
 *
 * CHỈ đụng 'checked_in'. Xe đã qua cổng (in_building trở đi) là xe THẬT trong bãi —
 * tự động hủy phiên của nó là xoá mất một lượt gửi có thật, tuyệt đối không được làm.
 */

// Chạy mỗi 5 phút — phiên treo không cấp bách như đơn pending nên không cần quét mỗi phút.
const INTERVAL_MS = 5 * 60 * 1000;

/**
 * Ngưỡng bỏ cuộc: 60 phút kể từ giờ check-in. Để rộng có chủ đích — bãi nhiều tầng, khách
 * có thể loay hoay khá lâu từ quầy tới cổng. Hủy nhầm phiên của xe đang trên đường vào thì
 * khách tới cổng gặp QR chết, khó chịu hơn nhiều so với việc giữ chỗ thừa thêm nửa tiếng.
 */
const STUCK_AFTER_MINUTES = 60;

let timer = null;

/** Một lượt quét — gọi trực tiếp được trong test. */
export const runSessionMaintenance = async () => {
  const cutoff = new Date(Date.now() - STUCK_AFTER_MINUTES * 60 * 1000);

  const stuck = await ParkingSession.findAll({
    where: {
      status: 'active',
      gate_stage: 'checked_in', // chưa từng qua cổng tòa
      time_in: { [Op.lt]: cutoff },
    },
    attributes: ['session_id', 'plate_number', 'slot_id'],
  });

  let cancelled = 0;
  for (const row of stuck) {
    try {
      // Đọc lại trong transaction: voidActiveSession tự khoá hàng + guard theo status nên
      // an toàn khi chạy trùng nhịp với nhân viên đang bấm "Hủy phiên" trên giao diện.
      // eslint-disable-next-line no-await-in-loop
      const done = await sequelize.transaction(async (transaction) => {
        const session = await ParkingSession.findByPk(row.session_id, { transaction });
        if (!session || session.status !== 'active' || session.gate_stage !== 'checked_in') {
          return false;
        }
        return voidActiveSession(session, transaction);
      });
      if (!done) continue;
      cancelled += 1;

      // eslint-disable-next-line no-await-in-loop
      await recordIncident({
        type: 'wrong_info',
        description:
          `Hệ thống tự hủy phiên treo — biển ${row.plate_number} đã check-in quá `
          + `${STUCK_AFTER_MINUTES} phút nhưng chưa qua cổng vào bãi.`,
        sessionId: row.session_id,
        slotId: row.slot_id,
      });
    } catch (err) {
      console.error(`[session-maintenance] hủy phiên #${row.session_id} lỗi:`, err.message);
    }
  }

  if (cancelled) {
    console.log(`[session-maintenance] đã hủy ${cancelled} phiên treo ở cổng vào`);
  }
  return { cancelled };
};

export const startSessionMaintenanceJob = () => {
  if (timer) return timer;
  const tick = () =>
    runSessionMaintenance().catch((err) =>
      console.error('[session-maintenance] tick failed:', err.message),
    );
  tick();
  timer = setInterval(tick, INTERVAL_MS);
  if (typeof timer.unref === 'function') timer.unref();
  return timer;
};

export const stopSessionMaintenanceJob = () => {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
};
