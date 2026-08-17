import React, { useEffect, useState } from "react";
import { adminRefundApi } from "../../api/adminRefundApi";
import { toast } from "react-hot-toast";
import {
  RotateCw,
  Search,
  Trash2,
  Banknote,
  CheckCircle,
  Clock,
  User,
  Mail,
  Info,
  CreditCard,
  Send,
  AlertCircle,
  SlidersHorizontal,
} from "lucide-react";
import PageHeader from "../../components/ui/PageHeader";
import Card from "../../components/ui/Card";
import Button from "../../components/ui/Button";
import { inputClass } from "../../components/ui/Input";

const STATUS_BADGE = {
  pending: "bg-amber-50 text-amber-700 ring-1 ring-amber-600/25",
  processing: "bg-blue-50 text-blue-700 ring-1 ring-blue-600/25",
  refunded: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-600/25",
  expired: "bg-rose-50 text-rose-700 ring-1 ring-rose-600/25",
};

const STATUS_LABEL = {
  pending: "Chờ xử lý",
  processing: "Đang xử lý",
  refunded: "Đã hoàn tiền",
  expired: "Hết hạn",
};

export default function RefundsPage() {
  const [refunds, setRefunds] = useState([]);
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState("");

  // States cho Complete Modal
  const [isCompleteModalOpen, setIsCompleteModalOpen] = useState(false);
  const [selectedRefund, setSelectedRefund] = useState(null);

  const fetchRefunds = async () => {
    try {
      setLoading(true);
      const params = {};
      if (statusFilter) {
        params.status = statusFilter;
      }

      const res = await adminRefundApi.list(params);
      const responseData = res.data?.data || res.data;
      const itemsArray = responseData?.items || responseData;

      if (Array.isArray(itemsArray)) {
        setRefunds(itemsArray);
      } else {
        setRefunds([]);
      }
    } catch (error) {
      toast.error("Lỗi khi tải danh sách hoàn tiền");
      setRefunds([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRefunds();
  }, [statusFilter]);

  // Handle: Nhắc nhở
  const handleRemind = async (id) => {
    try {
      await adminRefundApi.remind(id);
      toast.success("Đã gửi email nhắc nhở cập nhật STK");
    } catch (error) {
      toast.error(error.response?.data?.message || "Lỗi khi gửi email");
    }
  };

  // Handle: Đổi trạng thái sang Đang xử lý
  const handleProcess = async (id) => {
    try {
      await adminRefundApi.process(id);
      toast.success("Đã chuyển sang trạng thái đang xử lý");
      fetchRefunds();
    } catch (error) {
      toast.error("Lỗi khi cập nhật trạng thái");
    }
  };

  // Handle: Mở modal hoàn tất và truyền toàn bộ data của record
  const openCompleteModal = (refundRecord) => {
    setSelectedRefund(refundRecord);
    setIsCompleteModalOpen(true);
  };

  // Handle: Submit Hoàn tất (loại bỏ phần ghi chú theo yêu cầu người dùng)
  const handleComplete = async () => {
    try {
      await adminRefundApi.complete(
        selectedRefund.refund_id,
        "Đã chuyển khoản hoàn tất",
      );
      toast.success("Hoàn tất chuyển khoản thành công!");
      setIsCompleteModalOpen(false);
      fetchRefunds();
    } catch (error) {
      toast.error(error.response?.data?.message || "Lỗi khi hoàn tất");
    }
  };

  const totalRefunds = refunds.length;
  const pendingCount = refunds.filter(
    (r) => r.status === "pending" || r.status === "processing",
  ).length;
  const refundedCount = refunds.filter((r) => r.status === "refunded").length;

  const headerActions = (
    <Button
      variant="secondary"
      size="sm"
      onClick={fetchRefunds}
      loading={loading}
      className="flex items-center gap-2 border border-slate-200 hover:bg-slate-50 shadow-sm transition-all duration-150 cursor-pointer"
    >
      <RotateCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
      Làm mới
    </Button>
  );

  return (
    <div className="space-y-6">
      {/* Tiêu đề & Nút làm mới */}
      <PageHeader
        title="Quản lý hoàn tiền"
        description="Theo dõi và thực hiện hoàn trả số tiền đặt chỗ hoặc vé tháng do người dùng hủy/hết hạn."
        actions={headerActions}
      />

      {/* Thẻ thống kê tổng quan */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white p-6 rounded-xl border border-slate-200/80 shadow-sm flex items-center gap-4">
          <div className="p-3 bg-blue-50 text-blue-600 rounded-lg">
            <Banknote size={24} />
          </div>
          <div>
            <p className="text-sm font-medium text-slate-500">
              Tổng yêu cầu (Bộ lọc)
            </p>
            <h3 className="text-2xl font-bold text-slate-800">
              {totalRefunds}
            </h3>
          </div>
        </div>

        <div className="bg-white p-6 rounded-xl border border-slate-200/80 shadow-sm flex items-center gap-4">
          <div className="p-3 bg-amber-50 text-amber-600 rounded-lg">
            <Clock size={24} />
          </div>
          <div>
            <p className="text-sm font-medium text-slate-500">
              Chờ xử lý / Đang xử lý
            </p>
            <h3 className="text-2xl font-bold text-slate-800">
              {pendingCount}
            </h3>
          </div>
        </div>

        <div className="bg-white p-6 rounded-xl border border-slate-200/80 shadow-sm flex items-center gap-4">
          <div className="p-3 bg-emerald-50 text-emerald-600 rounded-lg">
            <CheckCircle size={24} />
          </div>
          <div>
            <p className="text-sm font-medium text-slate-500">
              Đã hoàn tất chuyển khoản
            </p>
            <h3 className="text-2xl font-bold text-slate-800">
              {refundedCount}
            </h3>
          </div>
        </div>
      </div>

      {/* Bộ lọc thiết kế dạng Card sang trọng */}
      <Card className="bg-white border border-slate-200/80 shadow-sm p-5 relative overflow-visible max-w-md">
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
            <SlidersHorizontal size={14} className="text-slate-400" /> Trạng
            thái hoàn tiền
          </span>
          <div className="relative">
            <select
              className={`${inputClass} w-full pr-10 appearance-none bg-white border border-slate-200 hover:border-slate-350 focus:border-brand transition-all`}
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="">Tất cả trạng thái</option>
              <option value="pending">Chờ xử lý</option>
              <option value="processing">Đang xử lý</option>
              <option value="refunded">Đã hoàn</option>
              <option value="expired">Hết hạn</option>
            </select>
            <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2.5 text-slate-450">
              <svg
                className="fill-current h-4 w-4"
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 20 20"
              >
                <path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z" />
              </svg>
            </div>
          </div>
        </div>
      </Card>

      {/* Bảng dữ liệu với thiết kế phẳng hiện đại */}
      <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-100 text-sm">
            <thead className="bg-slate-50/80 text-left text-xs font-bold text-slate-500 uppercase tracking-wider border-b border-slate-100">
              <tr>
                <th className="px-6 py-4 font-semibold whitespace-nowrap">
                  Khách hàng
                </th>
                <th className="px-6 py-4 font-semibold whitespace-nowrap">
                  Số tiền hoàn
                </th>
                <th className="px-6 py-4 font-semibold">Tài khoản ngân hàng</th>
                <th className="px-6 py-4 font-semibold whitespace-nowrap">
                  Trạng thái
                </th>
                <th className="px-6 py-4 font-semibold whitespace-nowrap">
                  Thao tác
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {loading ? (
                <tr>
                  <td
                    colSpan="5"
                    className="px-6 py-12 text-center text-slate-400"
                  >
                    <div className="inline-block animate-spin rounded-full h-6 w-6 border-2 border-slate-300 border-t-brand mb-2" />
                    <p className="text-xs">Đang tải danh sách hoàn tiền...</p>
                  </td>
                </tr>
              ) : refunds.length === 0 ? (
                <tr>
                  <td
                    colSpan="5"
                    className="px-6 py-12 text-center text-slate-400"
                  >
                    Không có dữ liệu hoàn tiền nào.
                  </td>
                </tr>
              ) : (
                refunds.map((item) => {
                  const hasBankInfo = Boolean(item.user?.bank_account_number);

                  return (
                    <tr
                      key={item.refund_id}
                      className="hover:bg-slate-50/60 transition-colors"
                    >
                      {/* Khách hàng */}
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center gap-2.5">
                          <div className="p-2 bg-slate-100 rounded-lg text-slate-500">
                            <User className="h-4 w-4" />
                          </div>
                          <div>
                            <p className="font-semibold text-slate-800">
                              {item.user?.full_name}
                            </p>
                            <p className="text-xs text-slate-450 flex items-center gap-1">
                              <Mail className="h-3 w-3" /> {item.user?.email}
                            </p>
                          </div>
                        </div>
                      </td>

                      {/* Số tiền hoàn */}
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className="font-bold text-slate-900 text-sm">
                          {Number(item.amount).toLocaleString("vi-VN")} đ
                        </span>
                      </td>

                      {/* Tài khoản ngân hàng */}
                      <td className="px-6 py-4">
                        {hasBankInfo ? (
                          <div className="space-y-0.5 text-xs text-slate-700 bg-slate-50 p-2.5 rounded-lg border border-slate-100">
                            <p className="font-bold text-slate-800 text-xs">
                              {item.user.bank_name}
                            </p>
                            <p className="font-mono text-blue-700 font-bold">
                              {item.user.bank_account_number}
                            </p>
                            <p className="text-[10px] text-slate-400 uppercase tracking-wider">
                              Chủ TK: {item.user.bank_account_holder}
                            </p>
                          </div>
                        ) : (
                          <span className="inline-flex items-center gap-1 bg-amber-50 text-amber-700 text-xs px-2.5 py-0.5 rounded font-semibold ring-1 ring-amber-600/20">
                            <AlertCircle className="h-3.5 w-3.5" /> Chưa có STK
                          </span>
                        )}
                      </td>

                      {/* Trạng thái */}
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span
                          className={`px-2.5 py-1 rounded-full text-xs font-bold ${STATUS_BADGE[item.status] || "bg-slate-100 text-slate-600"}`}
                        >
                          {STATUS_LABEL[item.status] ||
                            item.status.toUpperCase()}
                        </span>
                      </td>

                      {/* Thao tác */}
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex gap-2">
                          {item.status === "pending" && !hasBankInfo && (
                            <Button
                              onClick={() => handleRemind(item.refund_id)}
                              variant="secondary"
                              size="xs"
                              className="bg-amber-500 hover:bg-amber-600 text-white font-semibold transition py-1 px-2.5 rounded-lg text-xs"
                            >
                              <Send className="h-3.5 w-3.5 mr-1" /> Nhắc STK
                            </Button>
                          )}

                          {item.status === "pending" && hasBankInfo && (
                            <Button
                              onClick={() => handleProcess(item.refund_id)}
                              className="brand-gradient text-white border-0 font-semibold shadow-xs hover:opacity-90 transition py-1 px-2.5 rounded-lg text-xs cursor-pointer"
                            >
                              Tiếp nhận
                            </Button>
                          )}

                          {item.status === "processing" && (
                            <Button
                              onClick={() => openCompleteModal(item)}
                              className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold shadow-xs transition py-1 px-2.5 rounded-lg text-xs cursor-pointer border-0"
                            >
                              Hoàn tất
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal Hoàn tất chuyển khoản */}
      {isCompleteModalOpen && selectedRefund && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs">
          <div className="bg-white rounded-2xl p-6 w-[480px] max-w-full shadow-2xl border border-slate-100 space-y-4">
            <h2 className="text-xl font-bold text-slate-900">
              Xác nhận đã chuyển khoản
            </h2>

            {/* Box thông tin chuyển khoản */}
            <div className="bg-blue-50/50 p-4 rounded-xl border border-blue-100 text-xs space-y-2">
              <h3 className="font-bold text-blue-800 flex items-center gap-1.5">
                <CreditCard className="h-4 w-4" /> Thông tin nhận tiền của khách
                hàng
              </h3>
              <div className="divide-y divide-blue-100/50 pt-1">
                <div className="py-2 flex justify-between">
                  <span className="text-slate-500 font-medium">
                    Khách hàng:
                  </span>
                  <span className="font-semibold text-slate-800">
                    {selectedRefund.user?.full_name}
                  </span>
                </div>
                <div className="py-2 flex justify-between items-center">
                  <span className="text-slate-500 font-medium">
                    Số tiền hoàn:
                  </span>
                  <span className="font-bold text-rose-600 text-sm">
                    {Number(selectedRefund.amount).toLocaleString("vi-VN")} đ
                  </span>
                </div>
                <div className="py-2 flex justify-between">
                  <span className="text-slate-500 font-medium">Ngân hàng:</span>
                  <span className="font-semibold text-slate-800">
                    {selectedRefund.user?.bank_name}
                  </span>
                </div>
                <div className="py-2 flex justify-between items-center">
                  <span className="text-slate-500 font-medium">
                    Số tài khoản:
                  </span>
                  <span className="font-mono font-bold text-blue-700 text-sm">
                    {selectedRefund.user?.bank_account_number}
                  </span>
                </div>
                <div className="py-2 flex justify-between">
                  <span className="text-slate-500 font-medium">
                    Chủ tài khoản:
                  </span>
                  <span className="font-semibold text-slate-850 uppercase">
                    {selectedRefund.user?.bank_account_holder}
                  </span>
                </div>
              </div>
            </div>

            <p className="text-xs text-slate-500 bg-slate-50 p-3 rounded-lg border border-slate-200">
              Vui lòng thực hiện chuyển khoản bằng ứng dụng ngân hàng theo thông
              tin trên. Sau khi chuyển khoản thành công, nhấn{" "}
              <b>"Lưu xác nhận"</b> để hoàn tất quy trình.
            </p>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
              <Button
                variant="secondary"
                onClick={() => setIsCompleteModalOpen(false)}
                className="cursor-pointer"
              >
                Hủy bỏ
              </Button>
              <Button
                onClick={handleComplete}
                className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold border-0 cursor-pointer"
              >
                Lưu xác nhận
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
