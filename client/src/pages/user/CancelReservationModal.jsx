import React, { useState } from "react";
import { reservationsApi } from "../../api/axios"; // Đường dẫn import api của bạn
import { toast } from "react-hot-toast"; // Hoặc thư viện thông báo bạn đang dùng

export default function CancelReservationModal({
  isOpen,
  onClose,
  reservation,
  currentUser,
  onSuccess,
}) {
  const [loading, setLoading] = useState(false);
  const [bankInfo, setBankInfo] = useState({
    bankName: "",
    bankAccountNumber: "",
    bankAccountHolder: "",
  });

  // Kiểm tra xem User đã có STK chưa
  const hasBankInfo = Boolean(currentUser?.bankAccountNumber);
  // Giả sử reservation có trường isRefundable hoặc bạn tự check giờ cutoff
  const isRefundable = reservation?.isRefundable;

  const handleCancel = async (e) => {
    e.preventDefault();

    if (isRefundable && !hasBankInfo) {
      if (
        !bankInfo.bankName ||
        !bankInfo.bankAccountNumber ||
        !bankInfo.bankAccountHolder
      ) {
        toast.error(
          "Vui lòng điền đầy đủ thông tin ngân hàng để nhận hoàn tiền!",
        );
        return;
      }
    }

    try {
      setLoading(true);
      // Gửi request hủy, kèm bankInfo nếu có nhập mới
      await reservationsApi.cancel(
        reservation.id,
        isRefundable && !hasBankInfo ? bankInfo : {},
      );
      toast.success("Hủy đặt chỗ thành công!");
      onSuccess();
      onClose();
    } catch (error) {
      toast.error(error.response?.data?.message || "Có lỗi xảy ra khi hủy vé");
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen || !reservation) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
      <div className="bg-white rounded-lg p-6 w-full max-w-md">
        <h2 className="text-xl font-bold mb-4">Xác nhận hủy đặt chỗ</h2>
        <p className="mb-4 text-gray-600">
          Bạn có chắc chắn muốn hủy đặt chỗ cho xe biển số{" "}
          <strong>{reservation.plateNumber}</strong>?
        </p>

        {isRefundable && !hasBankInfo && (
          <div className="bg-blue-50 p-4 rounded-md mb-4 border border-blue-200">
            <h3 className="font-semibold text-blue-800 mb-2">
              Thông tin nhận hoàn tiền
            </h3>
            <p className="text-sm text-blue-600 mb-3">
              Bạn chưa có thông tin ngân hàng. Vui lòng cung cấp để hệ thống
              hoàn tiền.
            </p>

            <div className="space-y-3">
              <input
                type="text"
                placeholder="Tên ngân hàng (VD: Vietcombank)"
                className="w-full border rounded p-2 text-sm"
                value={bankInfo.bankName}
                onChange={(e) =>
                  setBankInfo({ ...bankInfo, bankName: e.target.value })
                }
                required
              />
              <input
                type="text"
                placeholder="Số tài khoản"
                className="w-full border rounded p-2 text-sm"
                value={bankInfo.bankAccountNumber}
                onChange={(e) =>
                  setBankInfo({
                    ...bankInfo,
                    bankAccountNumber: e.target.value,
                  })
                }
                required
              />
              <input
                type="text"
                placeholder="Tên chủ tài khoản"
                className="w-full border rounded p-2 text-sm"
                value={bankInfo.bankAccountHolder}
                onChange={(e) =>
                  setBankInfo({
                    ...bankInfo,
                    bankAccountHolder: e.target.value,
                  })
                }
                required
              />
            </div>
          </div>
        )}

        {isRefundable && hasBankInfo && (
          <p className="text-sm text-green-600 mb-4 bg-green-50 p-2 rounded">
            Tiền sẽ được hoàn về tài khoản{" "}
            <strong>
              {currentUser.bankName} - {currentUser.bankAccountNumber}
            </strong>{" "}
            của bạn.
          </p>
        )}

        <div className="flex justify-end gap-3 mt-6">
          <button
            onClick={onClose}
            className="px-4 py-2 border rounded text-gray-600 hover:bg-gray-100"
            disabled={loading}
          >
            Đóng
          </button>
          <button
            onClick={handleCancel}
            className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700"
            disabled={loading}
          >
            {loading ? "Đang xử lý..." : "Xác nhận hủy"}
          </button>
        </div>
      </div>
    </div>
  );
}
