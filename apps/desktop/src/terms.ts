// Phải khớp với TERMS_VERSION trong src-tauri/src/terms.rs.
export const TERMS_VERSION = "2026-11-19";

// BẢN NHÁP: cần luật sư xem trước khi phát hành.
export const TERMS_SECTIONS: { title: string; body: string }[] = [
  {
    title: "1. Điều khoản sử dụng",
    body:
      "Bywina Browser cung cấp công cụ duyệt web. Bạn chịu trách nhiệm về cách sử dụng, nội dung bạn xem và tải về. " +
      "Không sử dụng phần mềm để vi phạm pháp luật. Phần mềm được cung cấp 'nguyên trạng', không có bảo đảm.",
  },
  {
    title: "2. Chính sách quyền riêng tư",
    body:
      "Lịch sử, dấu trang, cài đặt, phiên làm việc và danh sách tải xuống được lưu trên máy bạn (cơ sở dữ liệu cục bộ). " +
      "Ứng dụng không gửi dữ liệu duyệt web lên máy chủ của chúng tôi. Trang web bạn mở vẫn có thể thu thập dữ liệu theo chính sách của họ. " +
      "Chế độ riêng tư chỉ ngừng ghi lịch sử; cookie vẫn được lưu.",
  },
  {
    title: "3. Hạn chế đã biết",
    body:
      "Trang http không mã hóa bị chặn (trừ localhost). Cookie chưa được cô lập giữa các hồ sơ. " +
      "Chặn quảng cáo hiện chỉ áp dụng cho cửa sổ bật lên, với danh sách tối thiểu.",
  },
  {
    title: "4. Cập nhật",
    body:
      "Điều khoản có thể được cập nhật. Khi có phiên bản mới, bạn sẽ được yêu cầu chấp nhận lại trước khi tiếp tục sử dụng.",
  },
];
