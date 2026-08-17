import { useState, useRef, useEffect } from 'react';
import Field from './ui/Field';
import { inputClass } from './ui/Input';
import { removeVietnameseTones } from '../lib/validate';
import { searchVietnamBanks } from '../lib/vietnamBanks';

/**
 * 3 ô tài khoản nhận hoàn tiền trong modal HỦY có hoàn tiền (đặt chỗ đã trả phí / vé tháng).
 * Tự động format & sanitize mượt theo yêu cầu:
 * 1. Tên Ngân Hàng: Autocomplete từ danh sách ngân hàng Việt Nam tĩnh (Local Static Dictionary).
 *    Gõ "Vi..." -> Màn hình thả xuống gợi ý Vietcombank, VietinBank, VIB,...
 *    Nếu gõ tên không có trong danh sách -> Báo đỏ "Tên ngân hàng không tồn tại trong hệ thống ngân hàng Việt Nam".
 * 2. Số Tài Khoản: Chỉ nhận số (0-9), lọc ký tự khác khi gõ/paste, 6-19 chữ số.
 * 3. Tên Chủ Tài Khoản: Tự xóa dấu tiếng Việt, chuyển IN HOA, lọc số & ký tự đặc biệt (chỉ giữ A-Z và khoảng trắng), 2-50 ký tự.
 */
export default function RefundBankFields({ form, errors = {}, onChange, disabled }) {
  const [showBankSuggestions, setShowBankSuggestions] = useState(false);
  const bankInputRef = useRef(null);
  const containerRef = useRef(null);

  const bankSuggestions = searchVietnamBanks(form.bankName, 8);

  const handleBankNameChange = (e) => {
    const raw = e.target.value;
    // Chuyển HOA, không cho phép chữ số (0-9) & ký tự đặc biệt
    const sanitized = raw
      .toUpperCase()
      .replace(/[^A-ZÀÁÂÃÈÉÊÌÍÒÓÔÕÙÚÝĂĐĨŨƠƯẠ-Ỹ\s]/gu, '');
    onChange({ bankName: sanitized });
    setShowBankSuggestions(true);
  };

  const handleSelectBank = (bank) => {
    onChange({ bankName: bank.shortName });
    setShowBankSuggestions(false);
  };

  const handleAccountNumberChange = (e) => {
    const raw = e.target.value;
    // Lọc bỏ tất cả ký tự không phải số, giới hạn tối đa 19 chữ số
    const sanitized = raw.replace(/\D/g, '').slice(0, 19);
    onChange({ bankAccountNumber: sanitized });
  };

  const handleAccountHolderChange = (e) => {
    const raw = e.target.value;
    // Xóa dấu tiếng Việt, chuyển HOA, lọc số và ký tự đặc biệt (chỉ giữ A-Z và khoảng trắng)
    const sanitized = removeVietnameseTones(raw)
      .toUpperCase()
      .replace(/[^A-Z\s]/g, '');
    onChange({ bankAccountHolder: sanitized });
  };

  // Đóng dropdown khi click bên ngoài
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setShowBankSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className="space-y-3 rounded-lg border border-slate-200 bg-white px-4 py-3">
      <p className="text-sm font-medium text-slate-700">Tài khoản nhận tiền hoàn</p>

      <div ref={containerRef} className="relative">
        <Field
          label="Tên ngân hàng"
          error={errors.bankName}
          hint="Gõ tên viết tắt hoặc chọn từ gợi ý danh sách ngân hàng Việt Nam (VD: VIETCOMBANK, BIDV, TCB)"
          required
        >
          <input
            ref={bankInputRef}
            className={inputClass}
            value={form.bankName}
            onChange={handleBankNameChange}
            onFocus={() => setShowBankSuggestions(true)}
            placeholder="Gõ tên ngân hàng (VD: Vietcombank, VCB, MB...)"
            maxLength={50}
            autoComplete="off"
            disabled={disabled}
          />
        </Field>

        {/* Màn hình gợi ý thả xuống (Autocomplete Suggestions) */}
        {showBankSuggestions && bankSuggestions.length > 0 && !disabled && (
          <div className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-md border border-slate-200 bg-white py-1 shadow-lg">
            <div className="px-3 py-1 text-[11px] font-semibold tracking-wider text-slate-400 uppercase border-b border-slate-100">
              Gợi ý ngân hàng Việt Nam
            </div>
            {bankSuggestions.map((bank) => (
              <button
                key={bank.code}
                type="button"
                className="flex w-full flex-col items-start px-3 py-1.5 text-left hover:bg-slate-100 focus:bg-slate-100 focus:outline-none transition-colors"
                onMouseDown={(e) => {
                  e.preventDefault(); // Tránh làm mất focus input trước khi select
                  handleSelectBank(bank);
                }}
              >
                <div className="flex items-center gap-2 text-sm font-medium text-slate-800">
                  <span>{bank.shortName}</span>
                  <span className="rounded bg-slate-100 px-1 py-0.5 text-[10px] font-mono text-slate-500">{bank.code}</span>
                </div>
                <span className="text-xs text-slate-500 truncate max-w-full">{bank.name}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <Field label="Số tài khoản" error={errors.bankAccountNumber} hint="Gồm 6 đến 19 chữ số" required>
        <input
          className={inputClass}
          value={form.bankAccountNumber}
          inputMode="numeric"
          onChange={handleAccountNumberChange}
          placeholder="VD: 0123456789"
          maxLength={19}
          autoComplete="off"
          disabled={disabled}
        />
      </Field>

      <Field
        label="Tên chủ tài khoản"
        error={errors.bankAccountHolder}
        hint="Chữ cái không dấu, từ 2 đến 50 ký tự (ví dụ: NGUYEN VAN A)"
        required
      >
        <input
          className={inputClass}
          value={form.bankAccountHolder}
          onChange={handleAccountHolderChange}
          placeholder="VD: NGUYEN VAN A"
          maxLength={50}
          autoComplete="off"
          disabled={disabled}
        />
      </Field>
    </div>
  );
}


